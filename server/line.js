// ตัวช่วยคุยกับ LINE — ตรวจลายเซ็น webhook, ตอบ/ส่งข้อความ, ตรวจ LIFF ID token (ใครกำลังเปิดหน้าเว็บในไลน์)
//
// ตั้งค่าใน .env:
//   LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN  — จากช่อง Messaging API ของ OA
//   LINE_LOGIN_CHANNEL_ID, LIFF_ID                  — จากช่อง LINE Login ที่สร้าง LIFF ไว้ (ต้องอยู่ Provider เดียวกับ OA
//                                                     เพื่อให้ userId ตรงกับที่ใช้ส่งแจ้งเตือน)
const crypto = require('crypto');

const API = 'https://api.line.me/v2/bot';

function isConfigured() {
  return !!(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);
}

// ตรวจว่า webhook มาจาก LINE จริง (HMAC-SHA256 ของ body ดิบ ด้วย Channel secret) — ไม่ผ่านต้องไม่ประมวลผลอะไรเลย
function verifySignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function lineApi(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LINE API ${path} error (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ตัวส่งข้อความออกไปหา LINE — สลับเป็นตัวจำลองได้ตอนทดสอบ (ไม่ส่งข้อความจริง ไม่กินโควตา)
let sender = lineApi;
function setSenderForTests(fn) { sender = fn || lineApi; }

// ตอบกลับข้อความที่ผู้ใช้ส่งมา (reply ไม่นับโควตา push รายเดือน)
function replyText(replyToken, text) {
  return sender('/message/reply', { replyToken, messages: [{ type: 'text', text }] });
}

// ส่งข้อความหาผู้ใช้โดยตรง (push — นับโควตารายเดือนของ OA ใช้เฉพาะเรื่องสำคัญ)
function pushText(lineUserId, text) {
  return sender('/message/push', { to: lineUserId, messages: [{ type: 'text', text }] });
}

// ส่งข้อความพร้อมปุ่มกด (ปุ่ม postback — กดแล้วไลน์ส่งเหตุการณ์กลับมาที่ webhook) text ยาวได้ไม่เกิน 160, label ไม่เกิน 20
function pushButtons(lineUserId, altText, text, actions) {
  return sender('/message/push', {
    to: lineUserId,
    messages: [{
      type: 'template', altText: String(altText).slice(0, 400),
      template: { type: 'buttons', text: String(text).slice(0, 160), actions: actions.map((a) => ({ type: 'postback', label: String(a.label).slice(0, 20), data: a.data, displayText: a.label })) },
    }],
  });
}

// ตรวจ ID token ที่ LIFF ให้มา กับ LINE โดยตรง (ปลอมไม่ได้) — คืน { lineUserId, name }
async function realVerifyIdToken(idToken) {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) throw new Error('ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID');
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: String(idToken), client_id: clientId }),
  });
  if (!res.ok) throw new Error('ยืนยันตัวตนกับ LINE ไม่สำเร็จ');
  const data = await res.json();
  if (!data.sub) throw new Error('ยืนยันตัวตนกับ LINE ไม่สำเร็จ');
  return { lineUserId: data.sub, name: data.name || '' };
}

let verifyIdTokenImpl = realVerifyIdToken;
function verifyIdToken(idToken) { return verifyIdTokenImpl(idToken); }
function setVerifyIdTokenForTests(fn) { verifyIdTokenImpl = fn || realVerifyIdToken; } // ทดสอบโดยไม่ต้องคุยกับ LINE จริง

module.exports = { isConfigured, verifySignature, replyText, pushText, pushButtons, verifyIdToken, setVerifyIdTokenForTests, setSenderForTests };
