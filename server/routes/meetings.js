// สัมมนา / ประชุมออนไลน์ — สร้าง/ดู/จบห้อง (ต้องล็อกอิน) + ข้อมูลห้องแบบสาธารณะให้หน้า /meet/<code> (ไม่ต้องล็อกอิน)
const express = require('express');
const { requireAuth, getUserFromReq } = require('../auth');
const meetings = require('../meetings');

const router = express.Router();
const fail = (res, err) => res.status(400).json({ error: err.message });

// กันคนยิงเดารหัสห้อง: ต่อ IP นาทีละ 60 ครั้ง (เก็บในหน่วยความจำ)
const hits = new Map();
function limited(req) {
  const now = Date.now(); const key = req.ip;
  const arr = (hits.get(key) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return arr.length > 60;
}

// สาธารณะ (ประกาศก่อน requireAuth) — ถ้าล็อกอินอยู่จะรู้ว่าเป็นผู้จัดไหม + ชื่อที่จะใช้ในห้อง
router.get('/public/:code', async (req, res) => {
  try {
    if (limited(req)) return res.status(429).json({ error: 'ลองบ่อยเกินไป รอสักครู่' });
    const viewer = getUserFromReq(req);
    const info = await meetings.publicInfo(req.params.code, viewer && viewer.id, viewer && viewer.name);
    if (!info) return res.status(404).json({ error: 'ไม่พบห้องนี้ ตรวจลิงก์อีกครั้ง' });
    res.json({ meeting: info, me: viewer ? { name: viewer.name } : null });
  } catch (err) { console.error('meeting public error:', err.message); res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' }); }
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  try { res.json({ meetings: await meetings.myMeetings(req.user.id) }); } catch (err) { console.error('meetings list error:', err.message); res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' }); }
});
router.post('/', async (req, res) => {
  try { res.json({ ok: true, meeting: await meetings.createMeeting(req.user.id, req.body && req.body.title, req.body && req.body.type) }); } catch (err) { fail(res, err); }
});
router.post('/:id/end', async (req, res) => {
  try { res.json(await meetings.endMeeting(req.user.id, req.params.id)); } catch (err) { fail(res, err); }
});

module.exports = router;
