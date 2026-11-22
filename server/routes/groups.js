// กลุ่มสนทนาบนแพลตฟอร์ม — ทุกเส้นทางเป็นของผู้ล็อกอินเท่านั้น (ตัวตนมาจากเซสชันฝั่งเซิร์ฟเวอร์)
const express = require('express');
const { requireAuth } = require('../auth');
const groups = require('../groups');

const router = express.Router();
router.use(requireAuth);

const fail = (res, err) => res.status(400).json({ error: err.message });

router.get('/', async (req, res) => {
  try { res.json(await groups.listGroups(req.user.id)); } catch (err) { console.error('groups list error:', err.message); res.status(500).json({ error: 'โหลดรายการกลุ่มไม่สำเร็จ' }); }
});
router.post('/', async (req, res) => {
  try { res.json({ ok: true, group: await groups.createGroup(req.user.id, req.body && req.body.name, req.body && req.body.description) }); } catch (err) { fail(res, err); }
});
router.post('/:id/join', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.requestJoin(req.user.id, req.params.id)) }); } catch (err) { fail(res, err); }
});
router.get('/:id', async (req, res) => {
  try { res.json(await groups.getGroup(req.user.id, req.params.id)); } catch (err) { res.status(403).json({ error: err.message }); }
});
router.post('/requests/:rid/decide', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.decideJoin(req.user.id, req.params.rid, !!(req.body && req.body.approve === true))) }); } catch (err) { fail(res, err); }
});
router.get('/:id/messages', async (req, res) => {
  try { res.json({ messages: await groups.listMessages(req.user.id, req.params.id, req.query.after) }); } catch (err) { res.status(403).json({ error: err.message }); }
});
router.post('/:id/messages', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.postMessage(req.user.id, req.params.id, req.body && req.body.content)) }); } catch (err) { fail(res, err); }
});
router.post('/:id/leave', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.leaveGroup(req.user.id, req.params.id)) }); } catch (err) { fail(res, err); }
});
router.delete('/:id', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.deleteGroup(req.user.id, req.params.id)) }); } catch (err) { fail(res, err); }
});

module.exports = router;
