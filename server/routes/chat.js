// แชทกับ AI เลขา — หัวข้อการคุย + ข้อความ (ทุกอย่างผูกกับผู้ใช้ที่ login เท่านั้น ของใครของมัน)
const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth } = require('../auth');
const ai = require('../ai');
const { buildSystemPrompt, buildTools } = require('../secretary');
const { getMemoryContext } = require('../memory');

const router = express.Router();
router.use(requireAuth);

const MAX_MESSAGE_CHARS = 4000;
const HISTORY_LIMIT = 20;                    // ส่งข้อความล่าสุดกี่รายการให้โมเดล (คุมค่า token)
const BURST_MAX = 20;                        // ส่งได้กี่ข้อความต่อช่วง
const BURST_WINDOW_MS = 5 * 60 * 1000;       // ช่วง 5 นาที
const DEFAULT_DAILY_LIMIT = 200;             // เพดานข้อความ/วัน/คน (ค่าตั้งใน app_settings: chat_daily_limit)

const recentSends = new Map(); // userId -> [timestamp]
function burstExceeded(userId) {
  const now = Date.now();
  const list = (recentSends.get(userId) || []).filter((t) => now - t < BURST_WINDOW_MS);
  if (list.length >= BURST_MAX) { recentSends.set(userId, list); return true; }
  list.push(now);
  recentSends.set(userId, list);
  return false;
}

async function dailyLimit() {
  try {
    const r = await query("SELECT value FROM app_settings WHERE key = 'chat_daily_limit'");
    const n = Number(r.rows[0] && r.rows[0].value);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
  } catch { return DEFAULT_DAILY_LIMIT; }
}

// เช็คว่าหัวข้อนี้เป็นของผู้ใช้คนนี้จริง (ไม่ใช่ → ตอบเหมือนไม่มี เพื่อไม่บอกใบ้ว่ามีหัวข้อของคนอื่น)
async function ownConversation(id, userId) {
  const r = await query('SELECT id, title FROM conversations WHERE id = $1 AND user_id = $2', [id, userId]);
  return r.rows[0] || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/conversations', async (req, res) => {
  try {
    const r = await query(
      'SELECT id, title, last_message_at FROM conversations WHERE user_id = $1 ORDER BY last_message_at DESC LIMIT 30',
      [req.user.id]
    );
    res.json({ conversations: r.rows });
  } catch (err) {
    console.error('GET conversations error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

router.post('/conversations', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) || null : null;
    const r = await query(
      'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, last_message_at',
      [req.user.id, title]
    );
    res.json({ conversation: r.rows[0] });
  } catch (err) {
    console.error('POST conversations error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบหัวข้อนี้' });
    const conv = await ownConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'ไม่พบหัวข้อนี้' });
    const r = await query(
      'SELECT id, role, content, source, created_at FROM messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT 500',
      [conv.id]
    );
    res.json({ conversation: conv, messages: r.rows });
  } catch (err) {
    console.error('GET messages error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

router.post('/conversations/:id/messages', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบหัวข้อนี้' });
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const source = req.body?.source === 'voice' ? 'voice' : 'text';
    if (!content) return res.status(400).json({ error: 'พิมพ์ข้อความก่อนส่ง' });
    if (content.length > MAX_MESSAGE_CHARS) return res.status(400).json({ error: `ข้อความยาวเกิน ${MAX_MESSAGE_CHARS} ตัวอักษร` });

    const conv = await ownConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'ไม่พบหัวข้อนี้' });

    if (!ai.isConfigured()) {
      return res.status(503).json({ error: 'เลขายังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งค่าสมอง AI) แจ้งแอดมินด้วยนะครับ' });
    }
    if (burstExceeded(req.user.id)) {
      return res.status(429).json({ error: 'ส่งถี่เกินไป รอสักครู่แล้วลองใหม่' });
    }
    const today = await query(
      "SELECT count(*)::int AS n FROM messages WHERE user_id = $1 AND role = 'user' AND created_at > now() - interval '24 hours'",
      [req.user.id]
    );
    if (today.rows[0].n >= (await dailyLimit())) {
      return res.status(429).json({ error: 'วันนี้ใช้ครบโควตาข้อความแล้ว พรุ่งนี้ค่อยคุยกันใหม่นะครับ' });
    }

    // ข้อมูลผู้ใช้สดจากฐานข้อมูล (ชื่อเลขา/บุคลิก) + ประวัติการคุยล่าสุด + ความจำ
    const [u, hist, memoryContext] = await Promise.all([
      query("SELECT name, secretary_name, secretary_persona FROM users WHERE id = $1 AND status = 'active'", [req.user.id]),
      query(
        `SELECT role, content FROM (
           SELECT id, role, content FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT ${HISTORY_LIMIT}
         ) t ORDER BY id ASC`,
        [conv.id]
      ),
      getMemoryContext(req.user.id),
    ]);
    const user = u.rows[0];
    if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });

    const systemPrompt = buildSystemPrompt({
      secretaryName: user.secretary_name,
      persona: user.secretary_persona,
      userName: user.name,
      memoryContext,
    });
    const history = [...hist.rows.filter((m) => m.role !== 'system'), { role: 'user', content }];

    let result;
    try {
      result = await ai.runAgent({ systemPrompt, history, tools: buildTools(req.user.id, conv.id) });
    } catch (err) {
      console.error('AI error:', err.message);
      return res.status(502).json({ error: 'เลขาตอบไม่ได้ในตอนนี้ ลองส่งใหม่อีกครั้งนะครับ' });
    }

    // บันทึกข้อความผู้ใช้ + คำตอบเลขา พร้อมกันเป็นก้อนเดียว (ถ้า AI พัง จะไม่มีข้อความค้างครึ่งๆ กลางๆ ให้ส่งซ้ำซ้อน)
    await withTransaction(async (c) => {
      await c.query('INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, $3, $4, $5)', [conv.id, req.user.id, 'user', content, source]);
      await c.query('INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, $3, $4, $5)', [conv.id, req.user.id, 'assistant', result.text, 'text']);
      await c.query(
        'UPDATE conversations SET last_message_at = now(), title = COALESCE(title, $2) WHERE id = $1',
        [conv.id, content.slice(0, 50)]
      );
    });

    const savedMemories = result.executed
      .filter((e) => e.name === 'save_memory' && e.result && e.result.ok)
      .map((e) => ({ category: e.result.category, createdNewCategory: e.result.createdNewCategory }));
    res.json({ reply: result.text, savedMemories });
  } catch (err) {
    console.error('POST message error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
