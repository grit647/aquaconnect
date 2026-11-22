// โปรไฟล์ของผู้ใช้เอง: ดูสรุป (ขนาดข้อมูลส่วนตัว, สิทธิ์ Google) + แก้ชื่อ/ชื่อเลขา/ชื่อที่ให้เรียก
// ทุกอย่างผูกกับผู้ล็อกอินจากเซสชันเท่านั้น (ไม่รับ id จากผู้ใช้)
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { cleanShortName } = require('../secretary');

const router = express.Router();
router.use(requireAuth);

const LABELS = { memories: 'ความจำ', messages: 'ข้อความแชท', events: 'ปฏิทินและเตือน', proposals: 'ข้อเสนอรอยืนยัน' };

router.get('/summary', async (req, res) => {
  try {
    const id = req.user.id;
    const [u, sizes, lim] = await Promise.all([
      query('SELECT name, phone, call_name, secretary_name, google_search_enabled, (CASE WHEN google_search_month = $2 THEN google_search_count ELSE 0 END) AS google_search_count FROM users WHERE id = $1', [id, require('../webSearch').currentMonth()]),
      query(
        `SELECT
           (SELECT count(*)::int FROM memories WHERE owner_id = $1) AS memories_n,
           (SELECT COALESCE(sum(octet_length(content)), 0)::bigint FROM memories WHERE owner_id = $1) AS memories_b,
           (SELECT count(*)::int FROM messages WHERE user_id = $1) AS messages_n,
           (SELECT COALESCE(sum(octet_length(content)), 0)::bigint FROM messages WHERE user_id = $1) AS messages_b,
           (SELECT count(*)::int FROM events WHERE user_id = $1) AS events_n,
           (SELECT COALESCE(sum(octet_length(title) + octet_length(COALESCE(note, ''))), 0)::bigint FROM events WHERE user_id = $1) AS events_b,
           (SELECT count(*)::int FROM memory_proposals WHERE owner_id = $1 AND status = 'pending') AS proposals_n,
           (SELECT COALESCE(sum(octet_length(content)), 0)::bigint FROM memory_proposals WHERE owner_id = $1 AND status = 'pending') AS proposals_b`,
        [id]
      ),
      query("SELECT key, value FROM app_settings WHERE key IN ('user_data_quota_mb', 'google_search_limit')"),
    ]);
    const L = Object.fromEntries(lim.rows.map((x) => [x.key, Number(x.value)]));
    const row = u.rows[0];
    if (!row) return res.status(404).json({ error: 'ไม่พบบัญชี' });
    const s = sizes.rows[0];
    const parts = Object.keys(LABELS).map((k) => ({ key: k, label: LABELS[k], count: s[k + '_n'], bytes: Number(s[k + '_b']) }));
    res.json({
      profile: { name: row.name, phone: row.phone, callName: row.call_name || '', secretaryName: row.secretary_name },
      usage: { totalBytes: parts.reduce((a, p) => a + p.bytes, 0), quotaBytes: (L.user_data_quota_mb || 20) * 1048576, parts },
      google: { enabled: !!row.google_search_enabled, count: row.google_search_count, limit: L.google_search_limit || 100 },
    });
  } catch (err) {
    console.error('me summary error:', err.message);
    res.status(500).json({ error: 'โหลดข้อมูลโปรไฟล์ไม่สำเร็จ' });
  }
});

router.patch('/profile', async (req, res) => {
  try {
    const b = req.body || {};
    const name = typeof b.name === 'string' ? b.name.split(/\s+/).join(' ').trim() : '';
    if (!name || name.length > 100) return res.status(400).json({ error: 'ชื่อต้องไม่ว่าง และไม่เกิน 100 ตัวอักษร' });
    if (/[<>`{}"\\]/.test(name)) return res.status(400).json({ error: 'ชื่อมีตัวอักษรที่ใช้ไม่ได้' });
    const callRaw = typeof b.callName === 'string' ? b.callName.trim() : '';
    const callName = callRaw ? cleanShortName(callRaw) : null;     // ว่าง = กลับไปเรียกตามชื่อที่สมัคร
    const secretaryName = cleanShortName(b.secretaryName);
    const r = await query(
      'UPDATE users SET name = $2, call_name = $3, secretary_name = $4 WHERE id = $1 RETURNING name, call_name, secretary_name',
      [req.user.id, name, callName, secretaryName]
    );
    res.json({ ok: true, profile: { name: r.rows[0].name, callName: r.rows[0].call_name || '', secretaryName: r.rows[0].secretary_name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
