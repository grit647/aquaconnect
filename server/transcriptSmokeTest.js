// ทดสอบ "ตรวจข้อความถอดเสียงที่ฟังไม่ได้ความ" (เสียงรบกวน/ไมค์ไวเกิน) — ไม่ใช้ฐานข้อมูล ไม่เรียก AI
//   node server/transcriptSmokeTest.js
const { isUnintelligible } = require('./transcript');
let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };

// ต้องถือว่า "ฟังไม่ได้ความ"
const noise = ['[[unclear]]', ' [[ unclear ]] ', '...', '?!', 'ก', 'อืมมม', 'เอ่ออ', 'ฮึ', 'หืม', 'อ๋อ', 'um', 'uh', 'ฮ่าฮ่าฮ่าฮ่า', 'ไม่ไม่ไม่ไม่ไม่', 'กกกกกกกก', 'ขอบคุณที่รับชม', 'ฝากกดติดตามด้วยนะครับ', 'Thanks for watching!', 'คำบรรยายโดย Amara.org', 'ซับไตเติ้ลโดย ทีมงาน', 'ออออออออ'];
for (const t of noise) check('ฟังไม่ได้ความ: "' + t + '"', isUnintelligible(t) === true);

// ต้องผ่าน (เป็นคำพูดจริง แม้สั้น)
const real = ['ครับ', 'ค่ะ', 'ใช่', 'ไม่', 'ได้', 'โอเค', 'ไม่ใช่', 'ขอบคุณค่ะ', 'วันนี้มีนัดอะไรบ้าง', 'ช่วยตั้งเตือนพรุ่งนี้เช้า', 'ขอดูรูปบ่อกุ้ง', 'เปิดไฟ', 'yes', 'ok', 'ขอบคุณที่ช่วยจดให้นะคะ', 'เมื่อวานดูคลิปนี้แล้วขอบคุณที่รับชมแล้วฝากบอกพี่ด้วยว่าให้ตรวจบ่อหนึ่งหน่อย', '5555', '12', 'หา', 'อีกครั้ง', 'โอ้โห น่าสนใจมาก', 'ฮัลโหล'];
for (const t of real) check('คำพูดจริงต้องผ่าน: "' + t + '"', isUnintelligible(t) === false, t);

check('ข้อความว่าง = ไม่ใช่ "ฟังไม่ได้ความ" (เป็นกรณี "ไม่ได้ยินเสียง" แยกต่างหาก)', isUnintelligible('') === false && isUnintelligible(null) === false && isUnintelligible(undefined) === false);

console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
process.exit(failures ? 1 : 0);
