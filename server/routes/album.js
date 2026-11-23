// อัลบั้มรูปส่วนตัว — ทุกเส้นทางต้องล็อกอิน และทำงานกับรูปของผู้ล็อกอินเท่านั้น (ไม่รับ id เจ้าของจากผู้ใช้)
const express = require('express');
const { requireAuth } = require('../auth');
const album = require('../album');

const router = express.Router();
router.use(requireAuth);

const fail = (res, err) => {
  if (err instanceof album.AlbumError) return res.status(err.status).json({ error: err.message });
  console.error('album error:', err.message);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
};

// กันอัปโหลดรัว (แต่ละรูปเรียก AI อ่านรูป 1 ครั้ง): ต่อคน 20 รูป/นาที
const hits = new Map();
function limited(userId) {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(userId, arr);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return arr.length > 20;
}

router.get('/', async (req, res) => {
  try { res.json({ photos: await album.listPhotos(req.user.id), usage: await album.usage(req.user.id) }); } catch (err) { fail(res, err); }
});
router.post('/', async (req, res) => {
  try {
    if (limited(req.user.id)) return res.status(429).json({ error: 'เพิ่มรูปถี่เกินไป รอสักครู่' });
    const photo = await album.addPhoto(req.user.id, { image: req.body && req.body.image, thumb: req.body && req.body.thumb, caption: req.body && req.body.caption });
    res.json({ ok: true, photo, usage: await album.usage(req.user.id) });
  } catch (err) { fail(res, err); }
});
async function sendImage(req, res, thumb) {
  try {
    const img = await album.getImage(req.user.id, req.params.id, thumb);
    if (!img) return res.status(404).end();
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(img.data);
  } catch (err) { console.error('album image error:', err.message); res.status(500).end(); }
}
router.get('/:id/image', (req, res) => sendImage(req, res, false));
router.get('/:id/thumb', (req, res) => sendImage(req, res, true));
router.patch('/:id', async (req, res) => {
  try { res.json({ ok: true, photo: await album.updateCaption(req.user.id, req.params.id, req.body && req.body.caption) }); } catch (err) { fail(res, err); }
});
router.delete('/:id', async (req, res) => {
  try { res.json({ ...(await album.deletePhoto(req.user.id, req.params.id)), usage: await album.usage(req.user.id) }); } catch (err) { fail(res, err); }
});

module.exports = router;
