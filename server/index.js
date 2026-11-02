require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRouter = require('./auth');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// SPA-style fallback: เส้นทางที่ไม่ใช่ /api/* และไม่ตรงไฟล์ static ให้ส่ง index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`AquaConnect server running on port ${PORT}`));
