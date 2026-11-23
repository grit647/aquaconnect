// เจนภาพ — สถานะสิทธิ์/โควตาของผู้ล็อกอิน + ดูภาพที่เจน (เฉพาะเจ้าของ) • การสั่งวาดทำผ่านเลขาในแชท (เครื่องมือ generate_image)
const express = require('express');
const { requireAuth } = require('../auth');
const imagegen = require('../imagegen');

const router = express.Router();
router.use(requireAuth);

router.get('/status', async (req, res) => {
  try { res.json(await imagegen.status(req.user.id)); } catch (err) { console.error('imagegen status error:', err.message); res.json({ allowed: false }); }
});
router.get('/:id/image', async (req, res) => {
  try {
    const img = await imagegen.getImage(req.user.id, req.params.id);
    if (!img) return res.status(404).end();
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(img.image);
  } catch (err) { console.error('imagegen image error:', err.message); res.status(500).end(); }
});

module.exports = router;
