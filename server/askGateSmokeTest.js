// ทดสอบตัวคุมความถี่ "เลขาถามว่าจะบันทึกข้อมูลไหม" (askGate) — ไม่ใช้ฐานข้อมูล ไม่เรียก AI
//   node server/askGateSmokeTest.js
const g = require('./askGate');
let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const pair = (i) => [{ role: 'user', content: 'u' + i }, { role: 'assistant', content: 'a' + i }];
const chat = (n) => Array.from({ length: n }, (_, i) => pair(i)).flat();

check('เริ่มคุย (ข้อความที่ 1) → ห้ามถาม', g.evaluate([]).allowed === false);
check('คุยมา 5 ข้อความ (รวมข้อความที่กำลังส่ง) → ยังห้ามถาม (รายละเอียดยังน้อย)', g.evaluate(chat(4)).allowed === false && g.evaluate(chat(4)).userTotal === 5);
check('คุยมา 6 ข้อความและยังไม่เคยถาม → ถามได้', g.evaluate(chat(5)).allowed === true);
const asked = chat(5).concat([{ role: 'assistant', content: 'อยากให้เลขาบันทึกสาระที่คุยกันไว้ในหมวดฟาร์มไหมคะ' }]);
check('เพิ่งถามบันทึกไป → ห้ามถามซ้ำทันที', g.evaluate(asked).allowed === false && g.evaluate(asked).userSinceAsk === 1);
check('หลังถามแล้ว คุยต่ออีก 8 ข้อความ → ยังห้าม (ห่างไม่ถึง 10)', g.evaluate(asked.concat(chat(8))).allowed === false);
check('หลังถามแล้ว คุยต่ออีก 10 ข้อความ → ถามได้อีกครั้ง', g.evaluate(asked.concat(chat(10))).allowed === true);
check('ค่าตั้งปรับได้ (minTotal=2, minGap=3)', g.evaluate(chat(1), { minTotal: 2, minGap: 3 }).allowed === true && g.evaluate(asked.concat(chat(1)), { minTotal: 2, minGap: 3 }).allowed === false);
const askTexts = ['จะให้บันทึกไว้ไหมคะ', 'ต้องการให้จดไว้ในหมวดฟาร์มไหม', 'จะให้อัปเดตหมวดนี้ไหมคะ', 'ช่วยจำไว้ให้ไหมคะ', 'ให้เลขาเก็บส่วนนี้ไว้ไหมคะ', 'อยากให้เลขาจดเรื่องนี้ไว้ไหม'];
const notAsk = ['วันนี้อากาศดีไหมคะ', 'บันทึกให้แล้วค่ะ', 'น้ำเขียวแบบนี้ควรเปลี่ยนน้ำไหมคะ', 'ราคากุ้งช่วงนี้ขึ้นนะคะ', 'จดทะเบียนฟาร์มต้องใช้เอกสารอะไรบ้างคะ'];
check('จับ "คำถามชวนบันทึก" ของเลขาได้ (' + askTexts.length + ' แบบ)', askTexts.every((t) => g.ASK_RE.test(t)), askTexts.filter((t) => !g.ASK_RE.test(t)).join(' | '));
check('ไม่จับคำพูดปกติเป็นคำถามบันทึก (' + notAsk.length + ' แบบ)', notAsk.every((t) => !g.ASK_RE.test(t)), notAsk.filter((t) => g.ASK_RE.test(t)).join(' | '));
check('ข้อความระบบ: ห้ามถาม ระบุว่าห้าม + เหตุผลว่าตอนกลับเข้าแอประบบถามอยู่แล้ว', /ตอนนี้ห้ามถาม/.test(g.noteFor({ allowed: false })) && /กลับเข้าแอป/.test(g.noteFor({ allowed: false })));
check('ข้อความระบบ: ถามได้ แค่ครั้งเดียว ต้องสรุปสิ่งที่จะเก็บ และห้ามถามซ้ำถ้าปฏิเสธ', /ถามได้ 1 ครั้ง/.test(g.noteFor({ allowed: true })) && /ครั้งเดียว/.test(g.noteFor({ allowed: true })) && /ไม่ถามซ้ำ/.test(g.noteFor({ allowed: true })));
console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
process.exit(failures ? 1 : 0);
