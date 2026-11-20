// โหลด .env จากโฟลเดอร์โปรเจกต์เสมอ (ไม่ขึ้นกับว่ารันคำสั่งจากโฟลเดอร์ไหน)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { router: authRouter } = require('./auth');
const chatRouter = require('./routes/chat');
const lineRouter = require('./routes/line');
const adminRouter = require('./routes/admin');
const creditsRouter = require('./routes/credits');
const connectRouter = require('./routes/connect');
const calendarRouter = require('./routes/calendar');
const { runDueReminders } = require('./reminders');
const { query } = require('./db');
// หมายเหตุ: ตลาดลูกกุ้ง (server/listings.js, ฐานข้อมูล Google Sheets) เลิกใช้แล้วตอนเปลี่ยนเป็นแอป AI เลขา
// ไฟล์ยังอยู่ใน git เผื่อย้อนกลับ แต่ไม่ถูกเรียกใช้อีก

const app = express();
app.set('trust proxy', 1); // อยู่หลังพร็อกซีของ Render — ให้ req.ip / req.secure ถูกต้อง (ใช้กันเดา PIN และตั้งคุกกี้ secure)
// ไฟล์เสียงที่ส่งมาถอดเป็นข้อความมีขนาดใหญ่กว่า JSON ทั่วไป — ขยายเพดานเฉพาะเส้นทางนี้ (ต้องประกาศก่อนตัวอ่าน JSON ทั่วไปด้านล่าง
// ไม่งั้นตัวทั่วไปจะตัดทิ้งที่ 1MB ก่อน) ส่วนเพดานที่แท้จริง (5MB + จำนวนครั้ง) ตรวจซ้ำอีกชั้นใน routes/chat.js
app.use('/api/chat/transcribe', express.json({ limit: '7mb' }));
// รูปสลิป/รูป QR เป็น base64 ขนาดเกิน 1MB — ขยายเฉพาะสองเส้นทางนี้ (เพดานจริงตรวจซ้ำในโค้ดแต่ละเส้นทาง)
app.use('/api/credits/topups', express.json({ limit: '3mb' }));
// ส่งข้อความพร้อมไฟล์แนบ (รูป/PDF เป็น base64) — เพดานจริง (4 ไฟล์ รวม ~8MB) ตรวจซ้ำใน attachments.js
app.use(/^\/api\/chat\/conversations\/[^/]+\/messages$/, express.json({ limit: '9mb' }));
app.use('/api/admin/payment-qr', express.json({ limit: '3mb' }));
// เก็บ body ดิบไว้ด้วย (req.rawBody) เพราะการตรวจลายเซ็น webhook ของ LINE ต้องใช้ข้อความดิบก่อนถูกแปลงเป็น JSON
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);
app.use('/api/line', lineRouter);
app.use('/api/credits', creditsRouter);
app.use('/api/connect', connectRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/admin', adminRouter);

// เช็คสุขภาพระบบ (ใช้กับ UptimeRobot ได้) — แตะฐานข้อมูลเบาๆ ด้วย ช่วยกันโปรเจกต์ Supabase แผนฟรีโดนพักจากไม่มีการใช้งาน
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    // คนยิง /api/health (UptimeRobot ทุก 5 นาที) = ปลุกเซิร์ฟเวอร์ + ตรวจนัดที่ถึงเวลาเตือนแล้วส่งไลน์ (ไม่รอผล ไม่ให้ health ช้า)
    runDueReminders().catch((e) => console.error('[reminders]', e.message));
    res.json({ ok: true });
  } catch (err) {
    console.error('health check failed:', err.message);
    res.status(503).json({ ok: false });
  }
});

// หน้าหลักของเว็บคือหน้า AI เลขา (ai.html) — หน้าเว็บเก่าย้ายไปเก็บที่ legacy-site/ ไม่ถูกเสิร์ฟอีก
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { index: 'ai.html' }));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

// เส้นทางที่ไม่ใช่ /api/* และไม่ตรงไฟล์ static ให้ส่งหน้า AI เลขา
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'ai.html'));
});

// รันตรงๆ (npm start) = เปิดเซิร์ฟเวอร์ / ถูก require จากสคริปต์ทดสอบ = ส่ง app ให้ใช้โดยไม่เปิดพอร์ตเอง
if (require.main === module) {
  const PORT = process.env.PORT || 8787;
  app.listen(PORT, () => console.log(`AquaConnect server running on port ${PORT}`));
  // ตัวจับเวลาแจ้งเตือนนัดหมายทุก 1 นาที (เฉพาะตอนรันจริง ไม่ทำงานตอนชุดทดสอบ require ไฟล์นี้)
  setInterval(() => runDueReminders().catch((e) => console.error('[reminders]', e.message)), 60000);
}

module.exports = app;
