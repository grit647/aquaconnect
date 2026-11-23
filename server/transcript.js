// ตรวจว่าข้อความที่ถอดจากเสียง "ฟังไม่ได้ความ" (เสียงรบกวน เสียงแทรก ไมค์ไวเกิน → โมเดลถอดเป็นคำเรื่อยเปื่อย) ไหม
// ถ้าใช่ จะไม่ส่งเข้าเลขา (ไม่เสียค่าเรียก AI ไม่ได้คำตอบมั่วๆ) แต่ให้เลขาถามกลับสั้นๆ ว่าไม่เข้าใจ ขอพูดใหม่
// หลักการ: เข้มแค่ "แน่ใจว่าไม่ใช่คำพูด" — คำสั้นที่มีความหมายจริง (ครับ ใช่ ไม่ ได้ ค่ะ) ต้องผ่านเสมอ
const MARKER_RE = /\[\[\s*unclear\s*\]\]|\bunclear\b|\[inaudible\]|\(inaudible\)/i;
// เสียงอึกอัก/เสียงในลำคอ/คำอุทานล้วนๆ
const FILLER_RE = /^(?:อื+ม*|อืม+|เอ[่้๊๋]?อ+|เออ+|อ[าิ]?[่้๊๋]?|ฮึ+|หึ+|หืม+|ฮื+อ*|อ๋อ+|อ๊ะ+|อะ+|เอ๊ะ+|ฮะ+|ฮ่า+|ฮา+|อ่า+|อา+|โอ+|โอ๊ะ+|ว้า+|ว้าว+|um+|uh+|hm+|mm+|ah+|oh+|er+|huh)$/i;
// ประโยคหลอนที่โมเดลถอดเสียงชอบสร้างเองตอนไม่มีคำพูดจริง (เหมือนท้ายคลิปวิดีโอ)
const HALLU_RE = /(ขอบคุณที่(?:รับชม|ติดตาม|รับฟัง)|ฝากกด(?:ติดตาม|ไลก์|แชร์|กระดิ่ง)|อย่าลืมกด(?:ติดตาม|ไลก์|แชร์)|ซับไตเติ้ล|คำบรรยายโดย|แปลโดย|subtitles? by|thanks? for watching|amara\.org|please subscribe)/i;

function normalize(s) { return String(s || '').replace(/[\s.,!?;:'"“”‘’()\[\]{}…\-–—_*~`|/\\]+/g, ''); }

// จำนวนตัวอักษร "ที่เป็นเนื้อหา" (พยัญชนะ/สระไทยที่ออกเสียง ตัวอังกฤษ ตัวเลข) ไม่นับวรรณยุกต์/เครื่องหมาย
function meaningfulCount(s) { return (String(s).match(/[ก-ฮเแโใไะาำa-zA-Z0-9๐-๙]/g) || []).length; }

function isUnintelligible(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return false;                      // ว่างเปล่า = "ไม่ได้ยินเสียง" (จัดการอีกทาง) ไม่ใช่ "ฟังไม่ได้ความ"
  if (MARKER_RE.test(text)) return true;        // โมเดลถอดเสียงบอกเองว่าฟังไม่ชัด
  const n = normalize(text);
  if (!n) return true;                          // มีแต่เครื่องหมายวรรคตอน
  if (meaningfulCount(n) < 2) return true;      // ตัวเดียวโดดๆ
  if (FILLER_RE.test(n)) return true;           // อืม เอ่อ ฮึ ...
  if (n.length <= 40 && HALLU_RE.test(text)) return true;
  if (/(.)\1{5,}/.test(n)) return true;         // ตัวอักษรเดิมซ้ำยาวๆ
  if (n.length >= 6 && new Set(n).size <= 2) return true;   // วนอยู่ 1-2 ตัวอักษร
  // วลีสั้นๆ ซ้ำวนไปมา เช่น "ฮ่าฮ่าฮ่าฮ่า" "ไม่ไม่ไม่ไม่ไม่"
  const rep = /^(.{1,4}?)\1{3,}$/.exec(n);
  if (rep && !/^[0-9๐-๙]+$/.test(n)) return true;
  return false;
}

module.exports = { isUnintelligible, MARKER_RE };
