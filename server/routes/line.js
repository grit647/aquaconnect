// webhook ของ LINE OA + ค่าตั้งสาธารณะสำหรับหน้าเว็บ (LIFF ID)
const express = require('express');
const line = require('../line');
const { query } = require('../db');
const sharing = require('../sharing');

const router = express.Router();

const WELCOME = 'ยินดีต้อนรับสู่ AquaConnect ค่ะ\nกดปุ่ม "คุยกับเลขา" ที่เมนูด้านล่าง เพื่อคุยกับเลขาประจำตัวของคุณได้เลย\nพิมพ์ "วิธีใช้" ถ้าอยากให้อธิบายค่ะ';
const HELP = 'วิธีใช้ AquaConnect\n1) กดปุ่ม "คุยกับเลขา" ที่เมนูด้านล่าง\n2) ครั้งแรกให้สมัคร/เข้าสู่ระบบด้วยเบอร์โทร + PIN 6 หลัก (ครั้งต่อไปเข้าอัตโนมัติ)\n3) บอกให้เลขาจำเรื่องที่ต้องการได้เลย เช่น "จำไว้ในหมวดฟาร์ม ว่าบ่อ 2 ปล่อยกุ้งวันที่ 5"\nเลขาจะจำให้และตอบจากความจำได้ทุกครั้งที่ถามค่ะ';
const FALLBACK = 'ตอนนี้ให้คุยกับเลขาผ่านปุ่ม "คุยกับเลขา" ที่เมนูด้านล่างนะคะ หรือพิมพ์ "วิธีใช้" ดูวิธีใช้งานค่ะ';

// กันประมวลผลเหตุการณ์ซ้ำ: เมื่อเปิด Webhook redelivery ไว้ LINE ส่งซ้ำได้ (เช่น ตอนเซิร์ฟเวอร์เพิ่งตื่นจากหลับ)
// เก็บในหน่วยความจำ 30 นาทีก็พอ เพราะช่วงส่งซ้ำของ LINE สั้นกว่านั้น
const seenEvents = new Map();
const SEEN_TTL_MS = 30 * 60 * 1000;
function alreadySeen(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of seenEvents) if (now - t > SEEN_TTL_MS) seenEvents.delete(k);
  if (seenEvents.has(id)) return true;
  seenEvents.set(id, now);
  return false;
}

async function handleEvent(ev) {
  if (alreadySeen(ev.webhookEventId)) return;
  if (!ev.replyToken) return;

  if (ev.type === 'follow') return line.replyText(ev.replyToken, WELCOME);

  // ปุ่ม "อนุญาต/ไม่อนุญาต" ในข้อความแจ้งคำขอเข้าใช้ข้อมูล — ตัวตนมาจากบัญชีไลน์ที่กดจริง (ผูกกับผู้ใช้ไว้แล้ว) ไม่ใช่จากข้อมูลในปุ่ม
  if (ev.type === 'postback' && ev.postback && ev.postback.data) {
    const d = new URLSearchParams(ev.postback.data);
    if (d.get('act') !== 'access') return;
    const lineUserId = ev.source && ev.source.userId;
    const u = lineUserId ? await query("SELECT id FROM users WHERE line_user_id = $1 AND status = 'active'", [lineUserId]) : { rows: [] };
    if (!u.rows[0]) return line.replyText(ev.replyToken, 'ยังไม่พบบัญชีที่ผูกกับไลน์นี้ค่ะ เปิดแอปผ่านปุ่ม "คุยกับเลขา" ก่อนนะคะ');
    try {
      const decision = d.get('d') === 'approve' ? 'approve' : 'deny';
      await sharing.decideRequest(u.rows[0].id, d.get('id'), decision);
      return line.replyText(ev.replyToken, decision === 'approve' ? 'อนุญาตแล้วค่ะ ผู้ขอเริ่มใช้ข้อมูลได้เลย (ถอนสิทธิ์ได้ภายหลังที่ปุ่ม "เชื่อมต่อข้อมูลภายนอก")' : 'ปฏิเสธคำขอแล้วค่ะ');
    } catch (err) {
      return line.replyText(ev.replyToken, 'ทำรายการไม่ได้: ' + err.message);
    }
  }

  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    const text = String(ev.message.text || '').trim();
    if (/^(วิธีใช้|ช่วยเหลือ|help|เมนู)$/i.test(text)) return line.replyText(ev.replyToken, HELP);
    return line.replyText(ev.replyToken, FALLBACK);
  }
}

router.post('/webhook', (req, res) => {
  // ลายเซ็นไม่ตรง = ไม่ใช่ LINE จริง ทิ้งทันที
  if (!line.verifySignature(req.rawBody, req.get('x-line-signature'))) return res.status(401).end();
  // ตอบ 200 ให้ LINE ก่อนเสมอ (LINE รอไม่เกิน ~2 วินาที) แล้วค่อยประมวลผลทีละเหตุการณ์
  res.status(200).end();
  for (const ev of (req.body && req.body.events) || []) {
    handleEvent(ev).catch((err) => console.error('[line] handleEvent error:', err.message));
  }
});

// ค่าสาธารณะที่หน้าเว็บต้องใช้ (LIFF ID ไม่ใช่ความลับ)
router.get('/config', (req, res) => {
  res.json({ liffId: process.env.LIFF_ID || null });
});

module.exports = router;
