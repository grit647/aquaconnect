// ทดสอบระบบแชร์หมวด/ขออนุญาต/ถามเลขาคนอื่น โดยไม่เรียก AI จริง (โมเดลจำลอง) และไม่ส่งไลน์จริง
//   node server/sharingSmokeTest.js
// ใช้ผู้ใช้ทดสอบเบอร์ขึ้นต้น 09999 แล้วลบทิ้งเมื่อจบ
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const ai = require('./ai');
const line = require('./line');
const memory = require('./memory');
const sharing = require('./sharing');
const { buildTools, buildSystemPrompt } = require('./secretary');
const { query, getPool } = require('./db');

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`);
}
async function rejects(fn) { try { await fn(); return null; } catch (e) { return e.message; } }

const sent = [];
line.setSenderForTests(async (path, body) => { sent.push({ path, body }); });
let lastPrompt = '';
ai.setCallModelForTests(async ({ systemPrompt }) => { lastPrompt = systemPrompt; return { parts: [{ text: 'ตอบจากข้อมูลจำลอง' }], usage: {} }; });

const PHONES = ['0999900021', '0999900022', '0999900023'];
// access_sessions ไม่มี cascade โดยตั้งใจ (เป็นบันทึกเรื่องเงิน) — ต้องลบรอบการถามของผู้ใช้ทดสอบก่อนถึงลบผู้ใช้ได้
const cleanup = async () => {
  await query('DELETE FROM access_sessions WHERE requester_id IN (SELECT id FROM users WHERE phone = ANY($1)) OR owner_id IN (SELECT id FROM users WHERE phone = ANY($1))', [PHONES]);
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
};

(async () => {
  const baseUsers = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const mk = async (name, phone) => (await query("INSERT INTO users (phone, pin_hash, name) VALUES ($1, 'x', $2) RETURNING id", [phone, name])).rows[0].id;
  const owner = await mk('เจ้าของ ทดสอบ', PHONES[0]);
  const asker = await mk('ผู้ถาม ทดสอบ', PHONES[1]);
  const other = await mk('คนนอก ทดสอบ', PHONES[2]);

  await memory.saveMemory(owner, 'วิชาการ', 'กุ้งขาวปล่อยหนาแน่น 80 ตัวต่อตารางเมตรได้ถ้าคุมน้ำดี');
  await memory.saveMemory(owner, 'ส่วนตัว', 'รหัสตู้เซฟคือ 1234');

  // --- ตั้งสถานะหมวด ---
  check('ค่าเริ่มต้นหมวดใหม่เป็นส่วนตัว', (await memory.listCategories(owner)).every((c) => c.visibility === 'private'));
  check('เสียเงินแต่ไม่ใส่ราคา → ปฏิเสธ', !!(await rejects(() => sharing.setCategoryVisibility(owner, 'วิชาการ', 'paid'))));
  check('คนอื่นแก้หมวดของเจ้าของไม่ได้', !!(await rejects(() => sharing.setCategoryVisibility(asker, 'วิชาการ', 'free'))));
  const setFree = await sharing.setCategoryVisibility(owner, 'วิชาการ', 'free');
  check('เปิดหมวดเป็นฟรีได้', setFree.visibility === 'free');

  // --- ค้นหา: เห็นเฉพาะหมวดที่เปิด ---
  const found = await sharing.findSharedCategories(asker, 'เจ้าของ ทดสอบ');
  check('ค้นหาเห็นเฉพาะหมวดที่เปิด (ไม่เห็นหมวดส่วนตัว)', found.length === 1 && found[0].category === 'วิชาการ');
  check('ค้นหาด้วยเบอร์เต็มได้', (await sharing.findSharedCategories(asker, PHONES[0])).length === 1);
  check('ค้นหาเจอตัวเองไม่ได้', (await sharing.findSharedCategories(owner, 'เจ้าของ ทดสอบ')).length === 0);
  check('ขอหมวดส่วนตัวไม่ได้', !!(await rejects(() => sharing.requestAccess(asker, owner, 'ส่วนตัว'))));

  // --- ขออนุญาต ---
  const req1 = await sharing.requestAccess(asker, owner, 'วิชาการ', 'อยากรู้เรื่องความหนาแน่น');
  check('ขอสิทธิ์ → สถานะ pending', req1.status === 'pending');
  check('ขอซ้ำ → ไม่สร้างใหม่', (await sharing.requestAccess(asker, owner, 'วิชาการ')).alreadyExisted === true);
  check('ยังไม่อนุมัติ → ถามไม่ได้', !!(await rejects(() => sharing.askSharedCategory(asker, req1.requestId, 'ปล่อยกี่ตัว'))));
  check('เจ้าของมีคำขอรอ 1 รายการ', (await sharing.pendingCount(owner)) === 1);
  check('คำเตือนแสดงใน prompt ของเจ้าของ', buildSystemPrompt({ secretaryName: 'เลขา', userName: 'x', pendingRequests: 1 }).includes('รออนุมัติ 1'));

  check('คนนอกอนุมัติแทนไม่ได้', !!(await rejects(() => sharing.decideRequest(other, req1.requestId, 'approve'))));
  check('ผู้ถามอนุมัติให้ตัวเองไม่ได้', !!(await rejects(() => sharing.decideRequest(asker, req1.requestId, 'approve'))));
  check('เจ้าของอนุมัติได้', (await sharing.decideRequest(owner, req1.requestId, 'approve')).status === 'approved');

  // --- ถามเลขาเจ้าของ ---
  check('คนนอกใช้ request ของคนอื่นถามไม่ได้', !!(await rejects(() => sharing.askSharedCategory(other, req1.requestId, 'ทดสอบ'))));
  const ans = await sharing.askSharedCategory(asker, req1.requestId, 'ปล่อยกี่ตัวต่อตารางเมตร');
  check('ได้คำตอบจากเลขาเจ้าของ', ans.answer === 'ตอบจากข้อมูลจำลอง' && ans.from === 'เจ้าของ ทดสอบ');
  check('เลขาเจ้าของเห็นเฉพาะหมวดที่แชร์ (ไม่เห็นหมวดส่วนตัว)', lastPrompt.includes('80 ตัวต่อตารางเมตร') && !lastPrompt.includes('รหัสตู้เซฟ'));
  await sharing.askSharedCategory(asker, req1.requestId, 'ถามต่ออีกข้อ');
  const sess = await query('SELECT count(*)::int AS n, sum(units_billed)::int AS u FROM access_sessions WHERE requester_id = $1', [asker]);
  check('ถามต่อเนื่องรวมเป็นรอบเดียว นับ 2 คำถาม', sess.rows[0].n === 1 && sess.rows[0].u === 2, JSON.stringify(sess.rows[0]));

  // --- เครื่องมือของเลขา ผูกกับผู้ใช้เท่านั้น ---
  const tools = buildTools(asker, null);
  const out = await tools.list_access_requests.run({});
  check('เครื่องมือ list: ผู้ถามเห็น outgoing approved', out.outgoing.length === 1 && out.outgoing[0].status === 'approved' && out.incoming.length === 0);
  check('เครื่องมือ decide: ผู้ถามอนุมัติไม่ได้', !!(await rejects(() => tools.decide_access_request.run({ request_id: req1.requestId, decision: 'approve' }))));

  // --- หมวดเสียเงิน: ขอ/อนุมัติได้ แต่ถามไม่ได้จนกว่าจะมีเครดิต ---
  await sharing.setCategoryVisibility(owner, 'วิชาการ', 'paid', 'hour', 150);
  check('หมวดเสียเงิน → ยังถามไม่ได้ (รอระบบเครดิต)', (await rejects(() => sharing.askSharedCategory(asker, req1.requestId, 'x'))).includes('เครดิต'));

  // --- ถอนสิทธิ์ / กลับเป็นส่วนตัว ---
  await sharing.setCategoryVisibility(owner, 'วิชาการ', 'free');
  check('กลับเป็นฟรีแล้วถามได้อีก', (await sharing.askSharedCategory(asker, req1.requestId, 'y')).answer.length > 0);
  check('เจ้าของถอนสิทธิ์ได้', (await sharing.decideRequest(owner, req1.requestId, 'revoke')).status === 'revoked');
  check('ถอนสิทธิ์แล้วถามไม่ได้', !!(await rejects(() => sharing.askSharedCategory(asker, req1.requestId, 'z'))));

  const req2 = await sharing.requestAccess(asker, owner, 'วิชาการ');
  await sharing.decideRequest(owner, req2.requestId, 'approve');
  await sharing.setCategoryVisibility(owner, 'วิชาการ', 'private');
  check('ปิดเป็นส่วนตัว → ตัดสิทธิ์ที่อนุมัติไว้ทันที', !!(await rejects(() => sharing.askSharedCategory(asker, req2.requestId, 'q'))));
  check('ไม่มีข้อความไลน์หลุดออกไปตอนทดสอบ', sent.length === 0);

  await cleanup();
  const left = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  check('ลบข้อมูลทดสอบหมดเกลี้ยง', left === baseUsers, `ก่อน ${baseUsers} หลัง ${left}`);
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await cleanup(); } catch { /* ignore */ }
  process.exit(1);
});
