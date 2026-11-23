// เจนภาพด้วย AI (Gemini ผ่าน Vertex — service account เดียวกับสมองเลขา)
// กติกา: (1) ต้องมีสิทธิ์ (แอดมินเปิดรายคน users.imagegen_enabled) (2) งบรวมของแพลตฟอร์มต่อเดือนต้องยังไม่หมด
//        (3) ใช้โควตาฟรีต่อเดือนก่อน เกินแล้วหักเครดิต (credit_ledger 'spend' ref 'imagegen') (4) เจนไม่สำเร็จ/ถูกกรอง = ไม่คิดเงิน
// ภาพเก็บในตาราง generated_images (ดูได้เฉพาะเจ้าของ) ล่าสุด 60 ภาพต่อคน ผู้ใช้กดบันทึกลงอัลบั้มถาวรได้
const { query, withTransaction } = require('./db');
const credits = require('./credits');
const aiLib = require('./ai');

const MODEL = process.env.IMAGEGEN_MODEL || 'gemini-3.1-flash-lite-image';
const LOCATION = process.env.IMAGEGEN_LOCATION || 'global';
const REQUEST_TIMEOUT_MS = 50000;
const MAX_PROMPT = 600;
const KEEP_PER_USER = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const monthNow = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);

class ImageGenError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status || 400; } }

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// เรียกโมเดลเจนภาพจริง — คืน { buf, mime } (ถ้าโมเดลไม่ส่งภาพ เช่นถูกกรองความปลอดภัย โยน ImageGenError)
async function realGenerate(prompt) {
  const projectId = aiLib.getVertexProjectId();
  const token = await aiLib.getAccessToken();
  const host = LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${LOCATION}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Vertex image error (${res.status})`);
    const data = await res.json();
    const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData && p.inlineData.data);
    if (!part) throw new ImageGenError('blocked', 'วาดภาพนี้ไม่ได้ (ระบบความปลอดภัยของ AI ไม่อนุญาต หรือคำสั่งไม่ชัด) ลองเปลี่ยนคำอธิบายแล้วขอใหม่ — ครั้งนี้ไม่คิดเงิน', 422);
    const buf = Buffer.from(part.inlineData.data, 'base64');
    const mime = sniffImage(buf);
    if (!mime) throw new Error('ไฟล์ภาพที่ได้ไม่ถูกต้อง');
    return { buf, mime };
  } finally { clearTimeout(timer); }
}
let genImpl = realGenerate;
function setGenerateForTests(fn) { genImpl = fn || realGenerate; }

const SETTING_KEYS = ['imagegen_free_per_month', 'imagegen_credits_per_image', 'imagegen_cost_thb_per_image', 'imagegen_monthly_budget_thb'];
async function loadStatus(userId) {
  const r = await query(
    `SELECT u.imagegen_enabled,
            COALESCE((SELECT balance FROM credit_balances WHERE user_id = u.id), 0) AS balance,
            (SELECT count(*)::int FROM imagegen_usage WHERE user_id = u.id AND month = $2 AND free_used) AS free_used,
            (SELECT COALESCE(sum(cost_thb), 0) FROM imagegen_usage WHERE month = $2) AS spent,
            (SELECT json_object_agg(key, value) FROM app_settings WHERE key = ANY($3)) AS settings
       FROM users u WHERE u.id = $1`,
    [userId, monthNow(), SETTING_KEYS]
  );
  const row = r.rows[0];
  if (!row) return { allowed: false };
  const cfg = row.settings || {};
  const num = (k, d) => { const n = Number(cfg[k]); return Number.isFinite(n) ? n : d; };
  const freeTotal = num('imagegen_free_per_month', 10); const budget = num('imagegen_monthly_budget_thb', 100);
  const budgetOk = budget > 0 && Number(row.spent) < budget;
  return {
    allowed: !!row.imagegen_enabled, available: !!row.imagegen_enabled && budgetOk, budgetOk,
    freeTotal, freeLeft: Math.max(0, freeTotal - Number(row.free_used)),
    creditsPerImage: num('imagegen_credits_per_image', 3), costThbPerImage: num('imagegen_cost_thb_per_image', 1),
    balance: Number(row.balance),
  };
}
async function status(userId) { const st = await loadStatus(userId); delete st.costThbPerImage; return st; }

async function monthSpentThb() {
  const r = await query('SELECT COALESCE(sum(cost_thb), 0) AS s, count(*)::int AS n FROM imagegen_usage WHERE month = $1', [monthNow()]);
  return { thb: Number(r.rows[0].s), images: r.rows[0].n };
}

// บันทึกภาพ + นับโควตา/หักเครดิตใน transaction เดียว (ล็อกแถวผู้ใช้ — ถูกต้องแม้ขอพร้อมกันหลายภาพ) ถ้าเครดิตไม่พอตอนนี้ = ไม่ส่งภาพ ไม่บันทึก
async function settle(userId, prompt, img, st) {
  const month = monthNow();
  return withTransaction(async (c) => {
    await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const used = (await c.query('SELECT count(*)::int AS n FROM imagegen_usage WHERE user_id = $1 AND month = $2 AND free_used', [userId, month])).rows[0].n;
    const free = used < st.freeTotal;
    let charged = 0;
    if (!free) {
      charged = st.creditsPerImage;
      if (charged > 0) {
        try { await credits.applyDeltaIn(c, userId, -charged, 'spend', 'imagegen', null, 'เจนภาพด้วย AI 1 ภาพ'); }
        catch (err) { if (err.code === 'INSUFFICIENT_CREDIT') throw new ImageGenError('no_credit', `โควตาเจนภาพฟรีเดือนนี้หมดแล้ว และเครดิตไม่พอ (ต้องใช้ ${charged} เครดิต)`, 402); throw err; }
      }
    }
    await c.query('INSERT INTO imagegen_usage (user_id, month, free_used, credits_charged, cost_thb) VALUES ($1, $2, $3, $4, $5)', [userId, month, free, charged, st.costThbPerImage]);
    const ins = await c.query('INSERT INTO generated_images (owner_id, prompt, mime, image) VALUES ($1, $2, $3, $4) RETURNING id', [userId, prompt, img.mime, img.buf]);
    await c.query('DELETE FROM generated_images WHERE owner_id = $1 AND id NOT IN (SELECT id FROM generated_images WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2)', [userId, KEEP_PER_USER]);
    return { id: ins.rows[0].id, free, charged };
  });
}

async function generateForUser(userId, rawPrompt) {
  const prompt = String(rawPrompt || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT);
  if (prompt.length < 3) throw new ImageGenError('empty', 'ยังไม่รู้ว่าจะให้วาดอะไร บอกรายละเอียดเพิ่มหน่อยนะคะ', 400);
  const st = await loadStatus(userId);
  if (!st.allowed) throw new ImageGenError('not_allowed', 'ยังไม่ได้เปิดสิทธิ์เจนภาพ (ขอแอดมินเปิดให้)', 403);
  if (!st.budgetOk) throw new ImageGenError('budget', 'งบเจนภาพของแพลตฟอร์มเดือนนี้เต็มแล้ว ไว้เดือนหน้านะคะ', 402);
  if (st.freeLeft <= 0 && st.creditsPerImage > st.balance) throw new ImageGenError('no_credit', `โควตาเจนภาพฟรีเดือนนี้หมดแล้ว และเครดิตไม่พอ (ต้องใช้ ${st.creditsPerImage} เครดิต)`, 402);
  const img = await genImpl(prompt);
  const s = await settle(userId, prompt, img, st);
  return { id: s.id, free: s.free, charged: s.charged, freeLeft: Math.max(0, st.freeLeft - (s.free ? 1 : 0)) };
}

async function getImage(userId, id) {
  if (!UUID_RE.test(String(id))) return null;
  const r = await query('SELECT mime, image FROM generated_images WHERE id = $1 AND owner_id = $2', [id, userId]);
  return r.rows[0] || null;
}
// กันเจนรัว: ต่อคน 6 ภาพ/นาที
const hits = new Map();
function limited(userId) {
  const now = Date.now(); const arr = (hits.get(userId) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(userId, arr);
  return arr.length > 6;
}

module.exports = { ImageGenError, status, generateForUser, getImage, monthSpentThb, monthNow, setGenerateForTests, limited, UUID_RE };
