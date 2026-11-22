// ทดสอบ "ผู้ใช้สอนเลขาเอง": 2 หมวดหลัก, หมวดความสามารถเลขา (ส่วนตัวเสมอ), เลขาไตร่ตรองแล้วเสนอ → เจ้าของยืนยัน/ปฏิเสธ
//   node server/teachSmokeTest.js   (โมเดลจำลอง ไม่เสียเงิน • ผู้ใช้ทดสอบ 09999 ลบทิ้งเมื่อจบ)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake';

const app = require('./index');
const ai = require('./ai');
const sharing = require('./sharing');
const memory = require('./memory');
const reflect = require('./reflect');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900031', '0999900032'];

let reflectReply = null;     // สิ่งที่โมเดลจำลองจะตอบตอน "ไตร่ตรอง"
let lastChatPrompt = '';
ai.setCallModelForTests(async ({ systemPrompt, contents }) => {
  if (systemPrompt.startsWith('คุณคือเลขาส่วนตัวที่กำลังทบทวน')) return { parts: [{ text: reflectReply }], usage: {} };
  lastChatPrompt = systemPrompt;
  const last = contents[contents.length - 1];
  if (last.parts.some((p) => p.functionResponse)) return { parts: [{ text: 'เรียบร้อยค่ะ' }], usage: {} };
  const text = (last.parts[0] && last.parts[0].text) || '';
  if (text.includes('สอนเลขา')) return { parts: [{ functionCall: { name: 'save_memory', args: { category: 'ความสามารถเลขา', content: '[บทเรียน] ชอบให้ตอบสั้นๆ' } } }], usage: {} };
  if (text === 'ยืนยัน') {
    const m = /id: ([0-9a-f-]{36})/.exec(systemPrompt);
    return m ? { parts: [{ functionCall: { name: 'confirm_memory_proposal', args: { id: m[1] } } }], usage: {} } : { parts: [{ text: 'ไม่มีข้อเสนอ' }], usage: {} };
  }
  return { parts: [{ text: 'สวัสดีค่ะ' }], usage: {} };
});

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

(async () => {
  const counts = async () => (await query('SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM messages) AS messages, (SELECT count(*)::int FROM memories) AS memories, (SELECT count(*)::int FROM memory_categories) AS cats, (SELECT count(*)::int FROM memory_proposals) AS props')).rows[0];
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const base = await counts();

  const A = await call('POST', '/api/auth/register', { name: 'ทดสอบ สอน', phone: PHONES[0], pin: '111222' });
  const B = await call('POST', '/api/auth/register', { name: 'ทดสอบ อื่น', phone: PHONES[1], pin: '333444' });
  check('สมัครผู้ใช้ทดสอบ 2 คน', A.status === 200 && B.status === 200);

  const cats = (await query("SELECT c.name, c.visibility FROM memory_categories c JOIN users u ON u.id = c.owner_id WHERE u.phone = $1 ORDER BY c.name", [PHONES[0]])).rows;
  check('สมัครแล้วมี 2 หมวดหลัก: ทั่วไป + ความสามารถเลขา (ส่วนตัว)', cats.length === 2 && cats.some((c) => c.name === 'ทั่วไป') && cats.some((c) => c.name === 'ความสามารถเลขา') && cats.every((c) => c.visibility === 'private'), JSON.stringify(cats));

  const uidA = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[0]])).rows[0].id;
  const uidB = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[1]])).rows[0].id;

  // หมวดความสามารถเลขาเปิดแชร์/ขายไม่ได้
  let blocked = false; try { await sharing.setCategoryVisibility(uidA, 'ความสามารถเลขา', 'free'); } catch { blocked = true; }
  check('หมวดความสามารถเลขาเปิดแชร์ไม่ได้ (ส่วนตัวเสมอ)', blocked);
  let paidBlocked = false; try { await sharing.setCategoryVisibility(uidA, 'ความสามารถเลขา', 'paid', 'question', 5); } catch { paidBlocked = true; }
  check('และตั้งราคาขายไม่ได้', paidBlocked);
  let ok = true; try { await sharing.setCategoryVisibility(uidA, 'ทั่วไป', 'free'); await sharing.setCategoryVisibility(uidA, 'ทั่วไป', 'private'); } catch { ok = false; }
  check('หมวด "ทั่วไป" ยังตั้งแชร์ได้ตามปกติ', ok);

  // สอนเลขา → ถูกใส่ใน prompt ครั้งต่อไป พร้อมคำสั่ง "ทำตามเสมอ"
  const conv = (await call('POST', '/api/chat/conversations', {}, A.cookie)).json.conversation;
  const t1 = await call('POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'สอนเลขา ให้ตอบสั้น' }, A.cookie);
  check('สอนเลขา → บันทึกลงหมวดความสามารถเลขา', t1.status === 200 && t1.json.savedMemories[0] && t1.json.savedMemories[0].category === 'ความสามารถเลขา', JSON.stringify(t1.json.savedMemories));
  await call('POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'สวัสดี' }, A.cookie);
  check('รอบต่อไปเลขาเห็นสิ่งที่ถูกสอน + ต้องทำตามเสมอ', lastChatPrompt.includes('ทำตามเสมอ') && lastChatPrompt.includes('ชอบให้ตอบสั้นๆ'));

  // ไตร่ตรอง → ข้อเสนอ (กรองหมวดแปลก/ซ้ำ/สั้น)
  reflectReply = '```json\n' + JSON.stringify({ items: [
    { category: 'persona', summary: 'คุณต้นดูสีน้ำแล้วรู้ว่าบ่อกุ้งมีปัญหา' },
    { category: 'dream', summary: 'อยากให้ทุกคนมีเลขาส่วนตัวของตัวเอง' },
    { category: 'weird', summary: 'หมวดที่ไม่มีอยู่จริง' },
    { category: 'lesson', summary: 'คุณต้นดูสีน้ำแล้วรู้ว่าบ่อกุ้งมีปัญหา' },
    { category: 'lesson', summary: 'สั้น' },
  ] }) + '\n```';
  const r1 = await call('POST', '/api/chat/reflect', {}, A.cookie);
  check('ให้เลขาทบทวน → ได้ข้อเสนอที่ถูกต้อง 2 ข้อ (ตัดหมวดแปลก/ซ้ำ/สั้นออก)', r1.status === 200 && r1.json.proposals.length === 2 && r1.json.created === 2, JSON.stringify(r1.json.proposals && r1.json.proposals.map((p) => p.content)));
  check('ข้อเสนออยู่ในหมวดความสามารถเลขา มีป้ายชนิด [ตัวตน]/[ความฝัน]', r1.json.proposals.every((p) => p.category === 'ความสามารถเลขา') && r1.json.proposals.some((p) => p.content.startsWith('[ตัวตน]')) && r1.json.proposals.some((p) => p.content.startsWith('[ความฝัน]')));
  const memCountBefore = (await query('SELECT count(*)::int n FROM memories WHERE owner_id = $1', [uidA])).rows[0].n;
  check('ยังไม่บันทึกเป็นความจำจนกว่าเจ้าของยืนยัน', memCountBefore === 1);
  check('กดทบทวนถี่เกิน → 429 (คุมค่า AI)', (await call('POST', '/api/chat/reflect', {}, A.cookie)).status === 429);
  check('คนอื่นไม่เห็นข้อเสนอของ A', (await call('GET', '/api/chat/proposals', null, B.cookie)).json.proposals.length === 0);

  // เลขาถามในแชท → ผู้ใช้ตอบ "ยืนยัน" → เรียก confirm_memory_proposal
  const t2 = await call('POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'ยืนยัน' }, A.cookie);
  check('prompt มีรายการรอยืนยัน และผู้ใช้ตอบรับ → เลขายืนยันให้', lastChatPrompt.includes('รอเจ้าของยืนยัน') && t2.json.proposals.length === 1, JSON.stringify(t2.json.proposals && t2.json.proposals.length));
  const memAfter = (await query("SELECT m.content FROM memories m JOIN memory_categories c ON c.id = m.category_id WHERE m.owner_id = $1 AND c.name = 'ความสามารถเลขา'", [uidA])).rows;
  check('ข้อที่ยืนยันกลายเป็นความจำถาวรในหมวดความสามารถเลขา', memAfter.length === 2 && memAfter.some((m) => m.content.startsWith('[ตัวตน]')), String(memAfter.length));

  // ปฏิเสธผ่าน REST + คนอื่นตัดสินแทนไม่ได้
  const left = t2.json.proposals[0];
  check('B ตัดสินข้อเสนอของ A ไม่ได้', (await call('POST', `/api/chat/proposals/${left.id}/decide`, { accept: true }, B.cookie)).status === 400);
  const rej = await call('POST', `/api/chat/proposals/${left.id}/decide`, { accept: false }, A.cookie);
  const memFinal = (await query("SELECT count(*)::int n FROM memories WHERE owner_id = $1", [uidA])).rows[0].n;
  check('ปฏิเสธ → ไม่บันทึก และตัดสินซ้ำไม่ได้', rej.status === 200 && memFinal === 2 && (await call('POST', `/api/chat/proposals/${left.id}/decide`, { accept: true }, A.cookie)).status === 400, String(memFinal));

  // ข้อเสนอที่ปฏิเสธแล้วไม่ถูกเสนอซ้ำทันที? (ยังเสนอใหม่ได้ถ้าเจ้าของพูดอีก) — แต่ที่ยืนยันแล้วต้องไม่ซ้ำ
  reflectReply = JSON.stringify({ items: [{ category: 'persona', summary: 'คุณต้นดูสีน้ำแล้วรู้ว่าบ่อกุ้งมีปัญหา' }] });
  const dupCreated = await reflect.reflectConversation(uidA, conv.id);
  check('สิ่งที่จำไว้แล้วไม่ถูกเสนอซ้ำ', dupCreated.length === 0);

  // โมเดลตอบมั่ว (ไม่ใช่ JSON) → ไม่พัง ไม่เกิดข้อเสนอ
  reflectReply = 'ขอโทษค่ะ ไม่เข้าใจ';
  check('โมเดลตอบไม่เป็น JSON → ไม่เกิดข้อเสนอและไม่พัง', (await reflect.reflectConversation(uidA, conv.id)).length === 0);
  check('ตอบ JSON เสียรูป → ไม่พัง', reflect.parseItems('{"items": [oops') .length === 0 && reflect.parseItems('').length === 0);

  // เว้นระยะการไตร่ตรองอัตโนมัติ: ครบ 5 ข้อความของผู้ใช้ค่อยทำ และไม่ทำซ้ำทันที
  const conv2 = (await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation;
  reflectReply = JSON.stringify({ items: [] });
  for (let i = 0; i < 4; i++) await query("INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, 'user', $3, 'text')", [conv2.id, uidB, 'ข้อความ ' + i]);
  check('คุยยังไม่ครบ 5 ข้อความ → ยังไม่ไตร่ตรอง', (await reflect.maybeReflect(uidB, conv2.id)) === null);
  await query("INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, 'user', 'ข้อความ 5', 'text')", [conv2.id, uidB]);
  check('ครบ 5 → ไตร่ตรอง', Array.isArray(await reflect.maybeReflect(uidB, conv2.id)));
  check('แล้วไม่ไตร่ตรองซ้ำทันที', (await reflect.maybeReflect(uidB, conv2.id)) === null);

  // เก็บกวาด
  await new Promise((r) => setTimeout(r, 300)); // รอการไตร่ตรองเบื้องหลังที่ค้างอยู่จบก่อน
  const del = await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const end = await counts();
  check('ลบข้อมูลทดสอบหมดเกลี้ยง', del.rowCount === 2 && JSON.stringify(end) === JSON.stringify(base), `ก่อน ${JSON.stringify(base)} หลัง ${JSON.stringify(end)}`);

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]); } catch { /* ignore */ }
  process.exit(1);
});
