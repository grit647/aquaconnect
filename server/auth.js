// สมัครสมาชิก / เข้าสู่ระบบ — เก็บผู้ใช้ในฐานข้อมูล Postgres (ตาราง users)
// ผู้ใช้ทุกคนมี AI เลขาของตัวเอง; "แอดมิน" ไม่เปิดให้สมัครเอง (is_admin ตั้งผ่านสคริปต์เท่านั้น)
// session = JWT ในคุกกี้ httpOnly, PIN เก็บเฉพาะค่า hash (bcrypt)
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('./db');
const line = require('./line');

const router = express.Router();

if (!process.env.JWT_SECRET) {
  console.warn('[auth] ⚠️ ไม่ได้ตั้ง JWT_SECRET — ใช้ค่าชั่วคราวสำหรับเครื่องพัฒนาเท่านั้น ห้ามใช้บนเว็บจริง');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'aq_token';
const PIN_RE = /^\d{6}$/;
const PHONE_RE = /^\d{9,10}$/;

// ---------- กันเดา PIN / กันสมัครรัว (เก็บในหน่วยความจำ — รีสตาร์ทเซิร์ฟเวอร์แล้วเริ่มนับใหม่) ----------
const LOGIN_MAX_FAILS = 5;                 // ผิดได้กี่ครั้งต่อเบอร์
const LOGIN_IP_MAX_FAILS = 20;             // ผิดได้กี่ครั้งต่อ IP (กันไล่เดาหลายเบอร์)
const LOGIN_WINDOW_MS = 15 * 60 * 1000;    // ภายใน 15 นาที
const REGISTER_IP_MAX = 10;                // สมัครได้กี่บัญชีต่อ IP
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // ภายใน 1 ชั่วโมง
const LINE_LOGIN_IP_MAX = 200;             // เข้าด้วย LINE ได้กี่ครั้งต่อ IP ใน 15 นาที (เผื่อเครือข่ายมือถือที่หลายคนใช้ IP เดียวกัน)

const hits = new Map(); // key -> [timestamp, ...]
function recent(key, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length) hits.set(key, list); else hits.delete(key);
  return list;
}
function noteHit(key, windowMs) {
  const list = recent(key, windowMs);
  list.push(Date.now());
  hits.set(key, list);
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, name: user.name, isAdmin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // ผ่านพร็อกซีของ Render ต้องตั้ง app.set('trust proxy', 1) ไว้แล้ว
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    isAdmin: !!u.is_admin,
    secretaryName: u.secretary_name,
    pictureUrl: u.line_picture_url || null,
  };
}

// ผูกบัญชี LINE กับผู้ใช้ — เรียกหลังสมัคร/เข้าสู่ระบบด้วย PIN สำเร็จ เมื่อหน้าเว็บส่ง ID token ของ LIFF มาด้วย
// (ผูกได้เฉพาะคนที่พิสูจน์ตัวตนด้วย PIN แล้วเท่านั้น และ ID token ตรวจกับ LINE โดยตรง ปลอมไม่ได้)
async function tryBindLine(userId, idToken) {
  if (!idToken) return null;
  try {
    const { lineUserId, picture } = await line.verifyIdToken(idToken);
    await query('UPDATE users SET line_user_id = $2, line_picture_url = COALESCE($3, line_picture_url) WHERE id = $1', [userId, lineUserId, picture || null]);
    return { linked: true };
  } catch (err) {
    if (err.code === '23505') return { linked: false, error: 'บัญชี LINE นี้ผูกกับบัญชีอื่นอยู่แล้ว' };
    console.error('[auth] ผูก LINE ไม่สำเร็จ:', err.message);
    return { linked: false, error: 'ผูกบัญชี LINE ไม่สำเร็จ ลองเปิดจากเมนูไลน์อีกครั้ง' };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// อ่าน session จากคุกกี้ (ไม่แตะฐานข้อมูล) — คืน null ถ้าไม่ได้ login
function getUserFromReq(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    // คุกกี้จากระบบเก่า (สมัยใช้ Google Sheet) มีรหัสผู้ใช้เป็น "U00001" ไม่ใช่ UUID — ถือว่ายังไม่ได้ login (ให้เข้าสู่ระบบใหม่)
    // ไม่งั้นเอาไปค้นฐานข้อมูลแล้ว error 500
    if (!UUID_RE.test(String(p.id))) return null;
    return { id: p.id, phone: p.phone, name: p.name, isAdmin: !!p.isAdmin };
  } catch {
    return null;
  }
}

// Middleware: บังคับ login
function requireAuth(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  req.user = user;
  next();
}

// Middleware: เฉพาะแอดมิน (เช็คจากฐานข้อมูลสด ไม่เชื่อค่าใน token อย่างเดียว กันกรณีถูกถอนสิทธิ์ทีหลัง)
async function requireAdmin(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  try {
    const r = await query("SELECT is_admin FROM users WHERE id = $1 AND status = 'active'", [user.id]);
    if (!r.rows[0] || !r.rows[0].is_admin) return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้น' });
    req.user = user;
    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
}

router.post('/register', async (req, res) => {
  try {
    const { name, phone, pin } = req.body || {};

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({ error: 'กรอกชื่อ-นามสกุล (ไม่เกิน 100 ตัวอักษร)' });
    }
    if (!PHONE_RE.test(phone || '')) {
      return res.status(400).json({ error: 'กรอกเบอร์โทรศัพท์ให้ถูกต้อง' });
    }
    if (!PIN_RE.test(pin || '')) {
      return res.status(400).json({ error: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' });
    }

    const ipKey = `reg|${req.ip}`;
    if (recent(ipKey, REGISTER_WINDOW_MS).length >= REGISTER_IP_MAX) {
      return res.status(429).json({ error: 'สมัครบ่อยเกินไป ลองใหม่ภายหลัง' });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    // สร้างบัญชี + กระเป๋าเครดิต (ยอด 0) เป็นก้อนเดียว ถ้าพังกลางทางย้อนกลับทั้งหมด
    const user = await withTransaction(async (c) => {
      const r = await c.query(
        'INSERT INTO users (phone, pin_hash, name) VALUES ($1, $2, $3) RETURNING id, phone, name, is_admin, secretary_name',
        [phone, pinHash, name.trim()]
      );
      await c.query('INSERT INTO credit_balances (user_id) VALUES ($1)', [r.rows[0].id]);
      // 2 หมวดหลักตั้งแต่เริ่มใช้งาน: ทั่วไป + ความสามารถเลขา (สิ่งที่เจ้าของสอนเลขา)
      await c.query("INSERT INTO memory_categories (owner_id, name) VALUES ($1, 'ทั่วไป'), ($1, 'ความสามารถเลขา') ON CONFLICT (owner_id, name) DO NOTHING", [r.rows[0].id]);
      return r.rows[0];
    });

    noteHit(ipKey, REGISTER_WINDOW_MS);
    const lineResult = await tryBindLine(user.id, req.body.idToken);
    setAuthCookie(req, res, issueToken(user));
    res.json({ ok: true, user: publicUser(user), line: lineResult });
  } catch (err) {
    if (err.code === '23505') { // เบอร์ซ้ำ
      return res.status(409).json({ error: 'เบอร์นี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบแทน' });
    }
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

    const phoneKey = `login|phone|${phone}`;
    const ipKey = `login|ip|${req.ip}`;
    if (recent(phoneKey, LOGIN_WINDOW_MS).length >= LOGIN_MAX_FAILS
        || recent(ipKey, LOGIN_WINDOW_MS).length >= LOGIN_IP_MAX_FAILS) {
      return res.status(429).json({ error: 'ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' });
    }

    const r = await query(
      'SELECT id, phone, name, pin_hash, is_admin, status, secretary_name, line_picture_url FROM users WHERE phone = $1',
      [phone]
    );
    const user = r.rows[0];
    // ข้อความเดียวกันทั้งกรณีไม่พบเบอร์/PIN ผิด (ไม่บอกใบ้ว่าเบอร์ไหนมีบัญชี)
    const ok = user ? await bcrypt.compare(pin, user.pin_hash) : (await bcrypt.compare(pin, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi'), false);
    if (!ok) {
      noteHit(phoneKey, LOGIN_WINDOW_MS);
      noteHit(ipKey, LOGIN_WINDOW_MS);
      return res.status(401).json({ error: 'ไม่พบบัญชี หรือรหัส PIN ไม่ถูกต้อง' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน ติดต่อแอดมิน' });
    }

    hits.delete(phoneKey); // เข้าสำเร็จ ล้างตัวนับของเบอร์นี้
    const lineResult = await tryBindLine(user.id, req.body.idToken);
    setAuthCookie(req, res, issueToken(user));
    res.json({ ok: true, user: publicUser(user), line: lineResult });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

// เข้าสู่ระบบอัตโนมัติด้วย LINE (LIFF) — ถ้าบัญชี LINE นี้เคยผูกไว้ เข้าได้เลยไม่ต้องกรอก PIN
// ถ้ายังไม่เคยผูก ตอบ needsLink ให้หน้าเว็บพาไปสมัคร/เข้าด้วย PIN ครั้งแรก (แล้วระบบผูกให้เอง)
router.post('/line', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (typeof idToken !== 'string' || !idToken) {
      return res.status(400).json({ error: 'ไม่พบข้อมูลยืนยันตัวตนจาก LINE' });
    }
    const ipKey = `line|ip|${req.ip}`;
    if (recent(ipKey, LOGIN_WINDOW_MS).length >= LINE_LOGIN_IP_MAX) {
      return res.status(429).json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });
    }
    noteHit(ipKey, LOGIN_WINDOW_MS); // นับทุกครั้ง เพราะแต่ละครั้งต้องยิงตรวจกับ LINE

    let info;
    try {
      info = await line.verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ error: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ ลองเปิดจากเมนูไลน์อีกครั้ง' });
    }

    const r = await query(
      'SELECT id, phone, name, is_admin, status, secretary_name, line_picture_url FROM users WHERE line_user_id = $1',
      [info.lineUserId]
    );
    const user = r.rows[0];
    if (!user) return res.json({ ok: false, needsLink: true, lineName: info.name });
    if (user.status !== 'active') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน ติดต่อแอดมิน' });

    if (info.picture && info.picture !== user.line_picture_url) {
      await query('UPDATE users SET line_picture_url = $2 WHERE id = $1', [user.id, info.picture]);
      user.line_picture_url = info.picture;
    }
    setAuthCookie(req, res, issueToken(user));
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.error('POST /api/auth/line error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

// ลิงก์เข้าสู่ระบบครั้งเดียว (ใช้ตอนกด "เปิดในเบราว์เซอร์" จากไลน์ ให้เข้า Chrome ได้ทันทีโดยไม่ต้องกรอกเบอร์+PIN ซ้ำ)
// อายุ 2 นาที ใช้ได้ครั้งเดียว ขอได้เฉพาะคนที่ล็อกอินอยู่แล้ว
const usedLinkIds = new Map();   // jti -> หมดอายุเมื่อ (ms) — เก็บไว้กันใช้ซ้ำ
const linkIssued = new Map();    // userId -> [เวลาที่ขอ]
router.post('/login-link', requireAuth, (req, res) => {
  const now = Date.now();
  const list = (linkIssued.get(req.user.id) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (list.length >= 10) return res.status(429).json({ error: 'ขอลิงก์ถี่เกินไป รอสักครู่แล้วลองใหม่' });
  list.push(now);
  linkIssued.set(req.user.id, list);
  const jti = require('crypto').randomBytes(16).toString('hex');
  const t = jwt.sign({ id: req.user.id, purpose: 'link', jti }, JWT_SECRET, { expiresIn: '2m' });
  res.json({ ok: true, url: `${req.protocol}://${req.get('host')}/api/auth/link?t=${encodeURIComponent(t)}` });
});

router.get('/link', async (req, res) => {
  try {
    const p = jwt.verify(String(req.query.t || ''), JWT_SECRET);
    if (p.purpose !== 'link' || !UUID_RE.test(String(p.id)) || !p.jti) throw new Error('bad');
    const now = Date.now();
    for (const [k, exp] of usedLinkIds) if (exp < now) usedLinkIds.delete(k);
    if (usedLinkIds.has(p.jti)) throw new Error('used');
    usedLinkIds.set(p.jti, now + 5 * 60 * 1000);
    const r = await query("SELECT * FROM users WHERE id = $1 AND status = 'active'", [p.id]);
    if (!r.rows[0]) throw new Error('nouser');
    setAuthCookie(req, res, issueToken(r.rows[0]));
    res.redirect(req.query.next === 'voice' ? '/?mode=voice' : '/');
  } catch {
    res.status(400).send('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#0b0f1e;color:#e8ecff;padding:30px"><h3>ลิงก์หมดอายุหรือถูกใช้ไปแล้ว</h3><p>กลับไปที่แอปในไลน์แล้วกดปุ่ม "เปิดในเบราว์เซอร์" ใหม่อีกครั้ง หรือ <a style="color:#22d3ee" href="/">เข้าสู่ระบบด้วยเบอร์ + PIN</a></p></body>');
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// ข้อมูลผู้ใช้ปัจจุบัน — เช็คจากฐานข้อมูลสด (บัญชีที่ถูกระงับ/ลบจะหลุดทันที ไม่ต้องรอ token หมดอายุ)
router.get('/me', async (req, res) => {
  const session = getUserFromReq(req);
  if (!session) return res.json({ user: null });
  try {
    const r = await query(
      "SELECT id, phone, name, is_admin, secretary_name, line_picture_url FROM users WHERE id = $1 AND status = 'active'",
      [session.id]
    );
    res.json({ user: r.rows[0] ? publicUser(r.rows[0]) : null });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

module.exports = { router, requireAuth, requireAdmin, getUserFromReq };
