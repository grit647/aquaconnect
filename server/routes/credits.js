// เครดิตของฉัน: ดูยอด/ประวัติ, รูป QR รับเงิน (เฉพาะคนล็อกอิน), ส่งสลิปขอเติมเครดิต
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const credits = require('../credits');

const router = express.Router();
router.use(requireAuth);

router.get('/me', async (req, res) => {
  try {
    res.json(await credits.myCredits(req.user.id));
  } catch (err) {
    console.error('credits me error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// รูป QR พร้อมเพย์ของแพลตฟอร์ม — ไม่ฝังในโค้ด/เว็บสาธารณะ เก็บใน app_settings แล้วให้เฉพาะคนล็อกอินดู
router.get('/payment-qr', async (req, res) => {
  try {
    const r = await query("SELECT value FROM app_settings WHERE key = 'payment_qr'");
    const v = r.rows[0] && r.rows[0].value;
    if (!v || !v.data) return res.status(404).json({ error: 'ยังไม่ได้ตั้งค่า QR รับเงิน' });
    res.set('Content-Type', v.mime || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(v.data, 'base64'));
  } catch (err) {
    console.error('payment-qr error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

router.post('/topups', async (req, res) => {
  try {
    const { amount, slip, mimeType } = req.body || {};
    const r = await credits.createTopup(req.user.id, amount, slip, mimeType);
    res.json({ ok: true, topupId: r.topupId });
  } catch (err) {
    // ข้อความจาก createTopup เป็นข้อความที่ตั้งใจให้ผู้ใช้เห็น (ยอด/สลิปซ้ำ/รูปไม่ถูก)
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
