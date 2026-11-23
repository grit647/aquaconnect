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
// คำเชิญเข้ากลุ่ม (ต้องประกาศก่อนเส้นทาง /:id)
router.get('/invites', async (req, res) => {
  try { res.json({ invites: await groups.myInvites(req.user.id) }); } catch (err) { console.error('invites error:', err.message); res.status(500).json({ error: 'โหลดคำเชิญไม่สำเร็จ' }); }
});
router.post('/invites/:iid/respond', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.respondInvite(req.user.id, req.params.iid, !!(req.body && req.body.accept === true))) }); } catch (err) { fail(res, err); }
});
router.get('/:id/invite-candidates', async (req, res) => {
  try { res.json({ users: await groups.listInviteCandidates(req.user.id, req.params.id, req.query.q) }); } catch (err) { res.status(403).json({ error: err.message }); }
});
router.post('/:id/invites', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.inviteUser(req.user.id, req.params.id, req.body && req.body.userId)) }); } catch (err) { fail(res, err); }
});
router.patch('/:id/ai-settings', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.setAiSettings(req.user.id, req.params.id, !!(req.body && req.body.aiJoin === true), req.body && req.body.aiTopic)) }); } catch (err) { fail(res, err); }
});
router.post('/:id/summarize', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.summarizeToMemory(req.user.id, req.params.id, req.body && req.body.topic)) }); } catch (err) { fail(res, err); }
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
router.get('/:id/ai-avatar/:uid', async (req, res) => {
  try {
    const img = await groups.aiAvatarForGroup(req.user.id, req.params.id, req.params.uid);
    if (!img) return res.status(404).end();
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(img.bytes);
  } catch (err) { res.status(404).end(); }
});
router.post('/:id/ai-session', async (req, res) => {
  try { res.json({ ok: true, session: await groups.startAiSession(req.user.id, req.params.id, req.body && req.body.topic) }); } catch (err) { fail(res, err); }
});
router.post('/:id/ai-session/respond', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.respondAiConsent(req.user.id, req.params.id, !!(req.body && req.body.accept === true))) }); } catch (err) { fail(res, err); }
});
router.delete('/:id/ai-session', async (req, res) => {
  try { res.json({ ok: true, ...(await groups.stopAiSession(req.user.id, req.params.id)) }); } catch (err) { fail(res, err); }
});
router.get('/:id/messages', async (req, res) => {
  try { res.json({ messages: await groups.listMessages(req.user.id, req.params.id, req.query.after), session: await groups.aiSessionInfo(req.user.id, req.params.id) }); } catch (err) { res.status(403).json({ error: err.message }); }
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
