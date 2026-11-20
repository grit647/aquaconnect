// ปฏิทิน & เตือนของฉัน — เฉพาะผู้ล็อกอิน ของใครของมัน
const express = require('express');
const { requireAuth } = require('../auth');
const cal = require('../calendar');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res, err) => (err instanceof cal.CalendarError
  ? res.status(400).json({ error: err.message })
  : (console.error('calendar error:', err), res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' })));

router.get('/', async (req, res) => {
  try { res.json({ events: await cal.listMonth(req.user.id, req.query.month) }); } catch (e) { fail(res, e); }
});

router.get('/due', async (req, res) => {
  try { res.json({ events: await cal.listDue(req.user.id) }); } catch (e) { fail(res, e); }
});

router.post('/', async (req, res) => {
  try { res.json({ ok: true, event: await cal.createEvent(req.user.id, req.body || {}, 'app') }); } catch (e) { fail(res, e); }
});

router.post('/:id/ack', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบนัดหมาย' });
    const r = await cal.acknowledge(req.user.id, req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบนัดหมาย หรือรับทราบไปแล้ว' });
    res.json(r);
  } catch (e) { fail(res, e); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบนัดหมาย' });
    const r = await cal.removeEvent(req.user.id, req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบนัดหมาย' });
    res.json(r);
  } catch (e) { fail(res, e); }
});

module.exports = router;
