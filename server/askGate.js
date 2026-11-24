// ตัวคุมความถี่ "เลขาถามว่าจะบันทึกข้อมูลไหม" ระหว่างคุย (เจ้าของแจ้ง 2026-11-24: ถามถี่เกิน — ตอนกลับเข้าแอประบบมีขั้นตอนยืนยันการบันทึกอยู่แล้ว)
// กติกา: เลขาจะถูกอนุญาตให้ถามได้ก็ต่อเมื่อ (1) คุยในบทสนทนานี้มากพอจนมีรายละเอียด (ผู้ใช้พิมพ์ ≥ minTotal ข้อความ) และ
//        (2) ห่างจากครั้งที่เลขาเพิ่งถามไปแล้ว ≥ minGap ข้อความของผู้ใช้ — ไม่งั้นระบบสั่งเลขา "ห้ามถาม" ในรอบนั้น (ตัดสินที่เซิร์ฟเวอร์ ไม่พึ่งให้โมเดลจำเอง)
// ตรวจว่าครั้งก่อนเลขา "ถามบันทึก" ไหม จากข้อความของเลขาในประวัติ (รูปแบบคำถามชวนบันทึก/จด/จำ/อัปเดตหมวด)
const ASK_RE = /(?:บันทึก|จดไว้|จำไว้|เก็บไว้|เก็บลง|ลงหมวด|อัปเดต(?:หมวด|ข้อมูล))[^\n]{0,80}(?:ไหม|มั้ย|หรือเปล่า|หรือไม่)|(?:ไหม|มั้ย)[^\n]{0,24}(?:บันทึก|จดไว้|จำไว้)|(?:อยากให้|จะให้|ให้)(?:เลขา)?(?:ช่วย)?(?:บันทึก|จด|จำ|เก็บ)[^\n]{0,60}(?:ไหม|มั้ย)/;

const DEFAULTS = { minTotal: 6, minGap: 10 };

// rows: [{ role, content }] เรียงเก่า→ใหม่ (ไม่รวมข้อความที่กำลังจะส่งตอนนี้) • includeCurrent: นับข้อความผู้ใช้ที่กำลังส่งอยู่ด้วย
function evaluate(rows, opts = {}) {
  const minTotal = Number.isFinite(opts.minTotal) ? opts.minTotal : DEFAULTS.minTotal;
  const minGap = Number.isFinite(opts.minGap) ? opts.minGap : DEFAULTS.minGap;
  const list = Array.isArray(rows) ? rows : [];
  const cur = opts.includeCurrent === false ? 0 : 1;
  let userTotal = cur; let userSinceAsk = cur; let asked = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.role === 'assistant' && ASK_RE.test(String(m.content || ''))) { asked = true; break; }
    if (m.role === 'user') userSinceAsk++;
  }
  for (const m of list) if (m.role === 'user') userTotal++;
  if (!asked) userSinceAsk = Infinity;
  const allowed = userTotal >= minTotal && userSinceAsk >= minGap;
  return { allowed, userTotal, userSinceAsk: asked ? userSinceAsk : null, minTotal, minGap };
}

const NOTE_NO = `

[ถามเรื่องบันทึกข้อมูล: ตอนนี้ห้ามถาม] ห้ามถามผู้ใช้ว่าจะบันทึก/จดไว้/จำไว้/อัปเดตหมวดไหมในข้อความนี้ (ผู้ใช้ยังคุยมาไม่มาก หรือเพิ่งถามไปแล้ว — และระบบจะถามยืนยันการบันทึกให้ตอนผู้ใช้กลับเข้าแอปอยู่แล้ว) คุยเรื่องของเขาต่อตามธรรมชาติ **และห้ามเรียก save_memory / ห้ามพูดว่า "บันทึกให้แล้ว"** จนกว่าผู้ใช้จะสั่งให้บันทึกเอง หรือตอบรับคำถามชวนบันทึกของคุณ (ข้อมูลที่เขาเล่าระบบจะพักไว้ให้อัตโนมัติ แล้วถามยืนยันตอนกลับเข้าแอป)`;
const NOTE_OK = `

[ถามเรื่องบันทึกข้อมูล: ถามได้ 1 ครั้งเมื่อถึงจังหวะ] ถ้าตอนนี้เป็นจังหวะจบประเด็น หรือผู้ใช้เล่าข้อมูลใหม่ที่มีรายละเอียดมากพอแล้ว คุณถามได้ "ครั้งเดียว" ว่าจะให้บันทึกส่วนที่คุยกันมาไหม (สรุปสั้นๆ 1 ประโยคว่าจะเก็บอะไร) ถ้ายังไม่ใช่จังหวะก็ไม่ต้องถาม ถ้าผู้ใช้ปฏิเสธหรือเมินให้ไม่ถามซ้ำ ห้ามบันทึกเองก่อนผู้ใช้ตอบรับ`;
const noteFor = (gate) => (gate && gate.allowed ? NOTE_OK : NOTE_NO);

module.exports = { evaluate, noteFor, ASK_RE, DEFAULTS, NOTE_NO, NOTE_OK };
