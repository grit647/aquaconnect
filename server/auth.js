// ลงทะเบียน / เข้าสู่ระบบ — เก็บผู้ใช้ไว้ในแท็บ Users ของ Google Sheet
// หมวดหมู่ที่สมัครเองได้: เกษตรกร/ผู้ค้าปัจจัย/ทั่วไป/ผู้ลงข้อมูล/นักวิชาการ (สูงสุด 2 หมวด)
// "แอดมิน" ไม่เปิดให้สมัครเอง — มีให้เฉพาะบัญชีที่ seed ไว้ล่วงหน้าเท่านั้น (ดู server/seedAdmin.js)
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { readUsers, appendUser } = require('./sheets');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'aq_token';
const PIN_RE = /^\d{6}$/;
const PHONE_RE = /^\d{9,10}$/;
const ALLOWED_ROLES = ['farmer', 'supplier', 'general', 'reporter', 'academic'];
const MAX_ROLES = 2;

const USER_HEADERS = ['id', 'phone', 'pinHash', 'name', 'province', 'roles', 'roleDetails', 'status', 'registeredDate'];

function nextUserId(users) {
  const nums = users
    .map((u) => parseInt(String(u.id || '').replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `U${String(max + 1).padStart(5, '0')}`;
}

function issueToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    province: u.province || '',
    roles: Array.isArray(u.roles) ? u.roles : String(u.roles || '').split(',').filter(Boolean),
  };
}

router.post('/register', async (req, res) => {
  try {
    const { name, phone, pin, province, roles, roleDetails } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'กรอกชื่อ-นามสกุล' });
    }
    if (!PHONE_RE.test(phone || '')) {
      return res.status(400).json({ error: 'กรอกเบอร์โทรศัพท์ให้ถูกต้อง' });
    }
    if (!PIN_RE.test(pin || '')) {
      return res.status(400).json({ error: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' });
    }
    if (!Array.isArray(roles) || roles.length === 0 || roles.length > MAX_ROLES) {
      return res.status(400).json({ error: `เลือกหมวดหมู่ 1-${MAX_ROLES} หมวด` });
    }
    if (roles.some((r) => !ALLOWED_ROLES.includes(r))) {
      return res.status(400).json({ error: 'หมวดหมู่ไม่ถูกต้อง' });
    }

    const { headers, users } = await readUsers();
    if (users.some((u) => u.phone === phone)) {
      return res.status(409).json({ error: 'เบอร์นี้มีบัญชีสมาชิกอยู่แล้ว ลองเข้าสู่ระบบแทน' });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const id = nextUserId(users);
    const userRow = {
      id,
      phone,
      pinHash,
      name: name.trim(),
      province: province || '',
      roles: roles.join(','),
      roleDetails: JSON.stringify(roleDetails || {}),
      status: 'active',
      registeredDate: new Date().toISOString(),
    };

    await appendUser(headers.length ? headers : USER_HEADERS, userRow);

    const token = issueToken({ id, phone, roles, name: userRow.name });
    setAuthCookie(res, token);
    res.json({ ok: true, user: publicUser({ ...userRow, roles }) });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, pin } = req.body || {};
    if (!PHONE_RE.test(phone || '') || !PIN_RE.test(pin || '')) {
      return res.status(400).json({ error: 'เบอร์โทรศัพท์หรือรหัส PIN ไม่ถูกต้อง' });
    }

    const { users } = await readUsers();
    const user = users.find((u) => u.phone === phone);
    if (!user || !user.pinHash) {
      return res.status(401).json({ error: 'ไม่พบบัญชี หรือรหัส PIN ไม่ถูกต้อง' });
    }

    const match = await bcrypt.compare(pin, user.pinHash);
    if (!match) {
      return res.status(401).json({ error: 'ไม่พบบัญชี หรือรหัส PIN ไม่ถูกต้อง' });
    }
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน ติดต่อแอดมิน' });
    }

    const roles = String(user.roles || '').split(',').filter(Boolean);
    const token = issueToken({ id: user.id, phone: user.phone, roles, name: user.name });
    setAuthCookie(res, token);
    res.json({ ok: true, user: publicUser({ ...user, roles }) });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ user: null });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ user: { id: payload.id, phone: payload.phone, roles: payload.roles, name: payload.name } });
  } catch {
    res.json({ user: null });
  }
});

module.exports = router;
