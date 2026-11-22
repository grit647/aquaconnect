// หลังบ้านสำหรับแอดมิน: ภาพรวม / ผู้ใช้ (ระงับ-เปิด) / ค่าตั้งระบบ — ทุกเส้นทางต้องเป็นแอดมินที่ยังใช้งานอยู่ (เช็คกับฐานข้อมูลสดทุกครั้ง)
const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../auth');
const credits = require('../credits');

const router = express.Router();
router.use(requireAdmin);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ค่าตั้งที่แก้ได้ + ช่วงที่ยอมรับ (กันตั้งค่าเพี้ยนจนระบบพัง)
const SETTINGS = {
  commission_rate:  { label: 'ส่วนแบ่งแพลตฟอร์ม (%)', min: 10, max: 30 },
  idle_timeout_min: { label: 'เงียบเกินกี่นาทีถือว่าจบรอบคุยที่คิดเงิน', min: 1, max: 60 },
  chat_daily_limit: { label: 'โควตาข้อความต่อคนต่อวัน', min: 10, max: 2000 },
  credit_per_baht:  { label: 'เครดิต 1 = กี่บาท', min: 0.01, max: 100 },
  free_access_minutes: { label: 'หมวดฟรี: ใช้ข้อมูลได้กี่นาทีต่อการอนุญาต 1 ครั้ง', min: 1, max: 240 },
  user_data_quota_mb: { label: 'โควตาข้อมูลส่วนตัวต่อคน (MB) — แสดงแถบในเมนูโปรไฟล์', min: 1, max: 1000 },
  google_search_limit: { label: 'ค้นหาด้วย Google ได้สูงสุดกี่ครั้งต่อคนต่อเดือน (รีเซ็ตทุกวันที่ 1)', min: 1, max: 100000 },
  group_ai_per_hour:  { label: 'เลขา AI พูดในกลุ่มได้กี่ข้อความต่อชั่วโมง (ต่อเลขา ต่อกลุ่ม)', min: 0, max: 200 },
  group_ai_per_day:   { label: 'เลขา AI พูดในกลุ่มได้กี่ข้อความต่อวัน (ต่อเลขา ทุกกลุ่มรวม)', min: 0, max: 1000 },
  group_ai_chain_max: { label: 'เลขา AI ตอบเลขา AI ต่อกันได้กี่ชั้น (กันวนลูป)', min: 1, max: 10 },
  group_ai_session_minutes: { label: 'ช่วงให้เลขาคุยกันเอง ยาวกี่นาที', min: 1, max: 15 },
  group_ai_sessions_per_day: { label: 'กลุ่มเริ่มช่วงให้เลขาคุยกันเองได้กี่ครั้งต่อ 24 ชม.', min: 1, max: 50 },
  group_ai_session_max_messages: { label: 'ช่วงเลขาคุยกันเอง พูดได้รวมกี่ข้อความ (เพดานค่า AI)', min: 2, max: 200 },
  topup_min:        { label: 'เติมเครดิตขั้นต่ำต่อครั้ง (บาท)', min: 1, max: 10000 },
  topup_max:        { label: 'เติมเครดิตสูงสุดต่อครั้ง (บาท)', min: 100, max: 100000 },
};

router.get('/overview', async (req, res) => {
  try {
    const [users, today, totals, cats, reqs, days, pend] = await Promise.all([
      query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE line_user_id IS NOT NULL)::int AS line FROM users"),
      query("SELECT count(*)::int AS messages, count(DISTINCT user_id)::int AS users FROM messages WHERE role = 'user' AND created_at > now() - interval '24 hours'"),
      query('SELECT (SELECT count(*) FROM conversations)::int AS conversations, (SELECT count(*) FROM memories)::int AS memories, (SELECT count(*) FROM memory_categories)::int AS categories'),
      query('SELECT visibility, count(*)::int AS n FROM memory_categories GROUP BY visibility'),
      query('SELECT status, count(*)::int AS n FROM access_requests GROUP BY status'),
      query("SELECT to_char(d::date, 'YYYY-MM-DD') AS day, count(m.id)::int AS messages FROM generate_series(current_date - 6, current_date, '1 day') d LEFT JOIN messages m ON m.role = 'user' AND m.created_at::date = d::date GROUP BY d ORDER BY d"),
      query("SELECT count(*)::int AS n FROM topups WHERE status = 'pending'"),
    ]);
    res.json({
      users: users.rows[0], last24h: today.rows[0], totals: totals.rows[0],
      categories: cats.rows, accessRequests: reqs.rows, messagesPerDay: days.rows, pendingTopups: pend.rows[0].n,
    });
  } catch (err) {
    console.error('admin overview error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const r = await query(
      `SELECT u.id, u.name, u.phone, u.is_admin, u.status, (u.line_user_id IS NOT NULL) AS line_linked, u.google_search_enabled, (CASE WHEN u.google_search_month = $1 THEN u.google_search_count ELSE 0 END) AS google_search_count, u.line_picture_url AS picture, u.created_at,
              (SELECT count(*)::int FROM messages m WHERE m.user_id = u.id AND m.role = 'user') AS messages,
              (SELECT count(*)::int FROM memories x WHERE x.owner_id = u.id) AS memories,
              COALESCE(b.balance, 0) AS balance,
              (SELECT count(*)::int FROM topups t WHERE t.user_id = u.id) AS topup_count,
              (SELECT count(*)::int FROM credit_ledger l WHERE l.user_id = u.id) AS ledger_count
         FROM users u LEFT JOIN credit_balances b ON b.user_id = u.id ORDER BY u.created_at DESC LIMIT 500`,
      [require('../webSearch').currentMonth()]
    );
    res.json({ users: r.rows.map((x) => ({ ...x, balance: Number(x.balance) })) });
  } catch (err) {
    console.error('admin users error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// แอดมินกำหนดว่าใครค้นหาข้อมูลภายนอกด้วย Google ได้ (ผู้ใช้เปิดเองไม่ได้)
router.patch('/users/:id/google', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const enabled = !!(req.body && req.body.enabled === true);
    const r = await query('UPDATE users SET google_search_enabled = $2 WHERE id = $1 RETURNING id, google_search_enabled', [req.params.id, enabled]);
    if (!r.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ ok: true, user: r.rows[0] });
  } catch (err) {
    console.error('admin google flag error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

router.patch('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'ระงับบัญชีตัวเองไม่ได้' });
    const r = await query('UPDATE users SET status = $2 WHERE id = $1 AND is_admin = false RETURNING id, status', [req.params.id, status]);
    if (!r.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้ หรือเป็นแอดมิน (ระงับแอดมินไม่ได้)' });
    res.json({ ok: true, user: r.rows[0] });
  } catch (err) {
    console.error('admin status error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// เครดิตของผู้ใช้รายคน: ยอดคงเหลือ + ยอดเติม/ใช้/รายได้สะสม + สมุดบัญชี + รายการเติมเงินทั้งหมดของคนนี้
router.get('/users/:id/credits', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const u = await query('SELECT id, name, phone, line_picture_url AS picture FROM users WHERE id = $1', [req.params.id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const [bal, sums, ledger, topups] = await Promise.all([
      query('SELECT balance FROM credit_balances WHERE user_id = $1', [req.params.id]),
      query(`SELECT COALESCE(sum(amount) FILTER (WHERE type = 'topup'), 0) AS topup,
                    COALESCE(-sum(amount) FILTER (WHERE type = 'spend'), 0) AS spent,
                    COALESCE(sum(amount) FILTER (WHERE type = 'earn'), 0) AS earned
               FROM credit_ledger WHERE user_id = $1`, [req.params.id]),
      query('SELECT amount, type, note, balance_after, created_at FROM credit_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [req.params.id]),
      query(`SELECT id, status, amount_claimed, slip_amount_read, approved_amount, created_at, reviewed_at, note
               FROM topups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.params.id]),
    ]);
    const num = (v) => (v === null || v === undefined ? null : Number(v));
    res.json({
      user: u.rows[0],
      balance: num(bal.rows[0] && bal.rows[0].balance) || 0,
      totals: { topup: num(sums.rows[0].topup), spent: num(sums.rows[0].spent), earned: num(sums.rows[0].earned) },
      ledger: ledger.rows.map((x) => ({ ...x, amount: num(x.amount), balance_after: num(x.balance_after) })),
      topups: topups.rows.map((x) => ({ ...x, amount_claimed: num(x.amount_claimed), slip_amount_read: num(x.slip_amount_read), approved_amount: num(x.approved_amount) })),
    });
  } catch (err) {
    console.error('admin user credits error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

router.get('/settings', async (req, res) => {
  try {
    const r = await query('SELECT key, value FROM app_settings WHERE key = ANY($1)', [Object.keys(SETTINGS)]);
    const vals = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    res.json({ settings: Object.entries(SETTINGS).map(([key, s]) => ({ key, label: s.label, min: s.min, max: s.max, value: vals[key] ?? null })) });
  } catch (err) {
    console.error('admin settings error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

router.patch('/settings/:key', async (req, res) => {
  try {
    const s = SETTINGS[req.params.key];
    if (!s) return res.status(404).json({ error: 'ไม่มีค่าตั้งนี้' });
    const n = Number(req.body && req.body.value);
    if (!Number.isFinite(n) || n < s.min || n > s.max) return res.status(400).json({ error: `ค่าต้องอยู่ระหว่าง ${s.min} ถึง ${s.max}` });
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [req.params.key, JSON.stringify(n)]
    );
    res.json({ ok: true, key: req.params.key, value: n });
  } catch (err) {
    console.error('admin setting save error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ---------- เติมเครดิต: คิวรอตรวจสลิป ----------
router.get('/topups', async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const r = await query(
      `SELECT t.id, t.status, t.amount_claimed, t.slip_amount_read, t.approved_amount, t.created_at, t.note, u.name AS user_name, u.phone, u.line_picture_url AS picture
         FROM topups t JOIN users u ON u.id = t.user_id WHERE t.status = $1 ORDER BY t.created_at DESC LIMIT 100`,
      [status]
    );
    res.json({ topups: r.rows.map((x) => ({ ...x, amount_claimed: Number(x.amount_claimed), slip_amount_read: x.slip_amount_read === null ? null : Number(x.slip_amount_read), approved_amount: x.approved_amount === null ? null : Number(x.approved_amount) })) });
  } catch (err) {
    console.error('admin topups error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

router.get('/topups/:id/slip', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).end();
    const r = await query('SELECT slip_data, slip_mime FROM topups WHERE id = $1', [req.params.id]);
    if (!r.rows[0] || !r.rows[0].slip_data) return res.status(404).end();
    res.set('Content-Type', r.rows[0].slip_mime || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(r.rows[0].slip_data, 'base64'));
  } catch (err) {
    console.error('admin slip error:', err);
    res.status(500).end();
  }
});

router.post('/topups/:id/approve', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ ok: true, ...(await credits.approveTopup(req.user.id, req.params.id, req.body && req.body.amount)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/topups/:id/reject', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json(await credits.rejectTopup(req.user.id, req.params.id, req.body && req.body.note));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// อัปโหลดรูป QR รับเงิน (เก็บใน app_settings ไม่ขึ้น GitHub)
router.put('/payment-qr', async (req, res) => {
  try {
    const { mimeType, data } = req.body || {};
    if (!/^image\/(jpeg|png|webp)$/.test(String(mimeType))) return res.status(400).json({ error: 'ต้องเป็นรูป JPG, PNG หรือ WEBP' });
    if (typeof data !== 'string' || !data || data.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้องหรือใหญ่เกินไป' });
    await query(
      `INSERT INTO app_settings (key, value, note) VALUES ('payment_qr', $1::jsonb, 'รูป QR PromptPay รับเงินเติมเครดิต')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ mime: mimeType, data })]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('admin qr error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

module.exports = router;
