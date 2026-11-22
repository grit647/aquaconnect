// โปรไฟล์ของผู้ใช้เอง: ดูสรุป (ขนาดข้อมูลส่วนตัว, สิทธิ์ Google) + แก้ชื่อ/ชื่อเลขา/ชื่อที่ให้เรียก
// ทุกอย่างผูกกับผู้ล็อกอินจากเซสชันเท่านั้น (ไม่รับ id จากผู้ใช้)
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const { cleanShortName } = require('../secretary');
const occ = require('../occupations');

// รูป AI ส่วนตัว: รับ data URL (JPEG/PNG/WebP) ที่หน้าเว็บย่อแล้ว — ตรวจ "ไบต์หัวไฟล์จริง" ไม่เชื่อ MIME ที่ส่งมา และจำกัดขนาด
const MAX_AVATAR_BYTES = 120 * 1024;
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const aiAvatarUrl = (at) => (at ? '/api/me/ai-avatar?v=' + new Date(at).getTime() : null);

const router = express.Router();
router.use(requireAuth);

// รูป AI ของตัวเอง (ไม่รับ id จากผู้ใช้ → ดูรูปของคนอื่นไม่ได้)
router.get('/ai-avatar', async (req, res) => {
  try {
    const r = await query('SELECT ai_avatar, ai_avatar_mime FROM users WHERE id = $1', [req.user.id]);
    if (!r.rows[0] || !r.rows[0].ai_avatar) return res.status(404).end();
    res.set({ 'Content-Type': r.rows[0].ai_avatar_mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(r.rows[0].ai_avatar);
  } catch (err) { console.error('ai-avatar get error:', err.message); res.status(500).end(); }
});
router.put('/ai-avatar', async (req, res) => {
  try {
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.image) || ''));
    if (!m) return res.status(400).json({ error: 'รูปต้องเป็นไฟล์ JPEG, PNG หรือ WebP' });
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_AVATAR_BYTES) return res.status(400).json({ error: 'รูปใหญ่เกินไป (ไม่เกิน 120 KB หลังย่อ)' });
    const mime = sniffImage(buf);
    if (!mime) return res.status(400).json({ error: 'ไฟล์ไม่ใช่รูปภาพที่รองรับ' });
    const r = await query('UPDATE users SET ai_avatar = $2, ai_avatar_mime = $3, ai_avatar_at = now() WHERE id = $1 RETURNING ai_avatar_at', [req.user.id, buf, mime]);
    res.json({ ok: true, aiAvatarUrl: aiAvatarUrl(r.rows[0].ai_avatar_at) });
  } catch (err) { console.error('ai-avatar put error:', err.message); res.status(500).json({ error: 'บันทึกรูปไม่สำเร็จ' }); }
});
router.delete('/ai-avatar', async (req, res) => {
  try { await query('UPDATE users SET ai_avatar = NULL, ai_avatar_mime = NULL, ai_avatar_at = NULL WHERE id = $1', [req.user.id]); res.json({ ok: true }); }
  catch (err) { console.error('ai-avatar delete error:', err.message); res.status(500).json({ error: 'ลบรูปไม่สำเร็จ' }); }
});

const LABELS = { memories: 'ความจำ', messages: 'ข้อความแชท', events: 'ปฏิทินและเตือน', proposals: 'ข้อเสนอรอยืนยัน' };

router.get('/summary', async (req, res) => {
  try {
    const id = req.user.id;
    const [u, sizes, lim] = await Promise.all([
      query('SELECT name, phone, call_name, secretary_name, occupation_main, occupation_sub, occupation_detail, ai_avatar_at, google_search_enabled, (CASE WHEN google_search_month = $2 THEN google_search_count ELSE 0 END) AS google_search_count FROM users WHERE id = $1', [id, require('../webSearch').currentMonth()]),
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
      profile: { name: row.name, phone: row.phone, callName: row.call_name || '', secretaryName: row.secretary_name, aiAvatarUrl: aiAvatarUrl(row.ai_avatar_at), occupationMain: row.occupation_main || '', occupationSub: row.occupation_sub || '', occupationDetail: row.occupation_detail || '' },
      occupationOptions: occ.OCCUPATIONS,
      occupationOther: occ.OTHER_SUB,
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
    let o = null;                                                    // ไม่ส่งฟิลด์สถานะมา = ไม่แตะของเดิม
    if ('occupationMain' in b) o = occ.validateOccupation(b.occupationMain, b.occupationSub, b.occupationDetail);
    const r = await query(
      `UPDATE users SET name = $2, call_name = $3, secretary_name = $4,
              occupation_main = CASE WHEN $5::boolean THEN $6 ELSE occupation_main END,
              occupation_sub = CASE WHEN $5::boolean THEN $7 ELSE occupation_sub END,
              occupation_detail = CASE WHEN $5::boolean THEN $8 ELSE occupation_detail END
        WHERE id = $1 RETURNING name, call_name, secretary_name, occupation_main, occupation_sub, occupation_detail`,
      [req.user.id, name, callName, secretaryName, !!o, o && o.main, o && o.sub, o && o.detail]
    );
    const x = r.rows[0];
    res.json({ ok: true, profile: { name: x.name, callName: x.call_name || '', secretaryName: x.secretary_name, occupationMain: x.occupation_main || '', occupationSub: x.occupation_sub || '', occupationDetail: x.occupation_detail || '' } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
