// ทดสอบระบบแชทครบวงจรกับฐานข้อมูลจริง โดยใช้ "โมเดลจำลอง" แทน Gemini (ไม่เสียเงิน ไม่ส่งอะไรออกนอก)
//   node server/chatSmokeTest.js
// สร้างผู้ใช้ทดสอบ 2 คน (เบอร์ขึ้นต้น 09999) แล้วลบทิ้งเมื่อจบ — ไม่แตะบัญชีจริง
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake'; // ทำให้ isConfigured() เป็นจริงตอนทดสอบเท่านั้น

const app = require('./index');
const ai = require('./ai');
const { query, getPool } = require('./db');

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`);
}

// โมเดลจำลอง: ตอบตามข้อความล่าสุด + เรียกเครื่องมือเมื่อถูกสั่ง
let failNext = false;
ai.setCallModelForTests(async ({ systemPrompt, contents }) => {
  if (failNext) { failNext = false; throw new Error('จำลองว่าโมเดลล่ม'); }
  const last = contents[contents.length - 1];
  if (last.parts.some((p) => p.functionResponse)) return { parts: [{ text: 'บันทึกเรียบร้อยแล้วค่ะ' }], usage: {} };
  const text = (last.parts[0] && last.parts[0].text) || '';
  if (text.includes('จำไว้')) return { parts: [{ functionCall: { name: 'save_memory', args: { category: 'วิชาการ', content: 'pH ที่เหมาะสมของบ่อกุ้งคือ 7.5-8.5' } } }], usage: {} };
  if (text.includes('ถามความจำ')) return { parts: [{ text: systemPrompt.includes('pH ที่เหมาะสม') ? 'ความจำ: มี' : 'ความจำ: ไม่มี' }], usage: {} };
  return { parts: [{ text: 'สวัสดีค่ะ' }], usage: {} };
});

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;

async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

(async () => {
  // จำนวนข้อมูลจริงก่อนเริ่มทดสอบ — ตอนจบต้องกลับมาเท่าเดิมเป๊ะ (ฐานข้อมูลนี้มีข้อมูลจริงของผู้ใช้อยู่ด้วย ห้ามสมมติว่าว่างเปล่า)
  const counts = async () => (await query('SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM messages) AS messages, (SELECT count(*)::int FROM memories) AS memories, (SELECT count(*)::int FROM memory_categories) AS cats')).rows[0];
  const base = await counts();
  const pinA = '111222', pinB = '333444';
  const A = await call('POST', '/api/auth/register', { name: 'ทดสอบ เอ', phone: '0999900001', pin: pinA });
  const B = await call('POST', '/api/auth/register', { name: 'ทดสอบ บี', phone: '0999900002', pin: pinB });
  check('สมัครผู้ใช้ทดสอบ 2 คน', A.status === 200 && B.status === 200);

  check('ยังไม่ login เรียกแชทไม่ได้ (401)', (await call('GET', '/api/chat/conversations')).status === 401);

  const convA = (await call('POST', '/api/chat/conversations', {}, A.cookie)).json.conversation;
  const m1 = await call('POST', `/api/chat/conversations/${convA.id}/messages`, { content: 'สวัสดี' }, A.cookie);
  check('ส่งข้อความแล้วได้คำตอบ', m1.status === 200 && m1.json.reply === 'สวัสดีค่ะ', m1.json.reply);

  const m2 = await call('POST', `/api/chat/conversations/${convA.id}/messages`, { content: 'จำไว้ในหมวดวิชาการ ว่า pH ควร 7.5-8.5' }, A.cookie);
  check('สั่งจำ → เลขาเรียก save_memory จริง', m2.status === 200 && m2.json.savedMemories.length === 1 && m2.json.savedMemories[0].category === 'วิชาการ', JSON.stringify(m2.json.savedMemories));
  const mem = await query('SELECT count(*)::int AS n FROM memories m JOIN users u ON u.id = m.owner_id WHERE u.phone = $1', ['0999900001']);
  check('ความจำอยู่ในฐานข้อมูลจริง', mem.rows[0].n === 1);

  const msgs = await call('GET', `/api/chat/conversations/${convA.id}/messages`, null, A.cookie);
  check('ประวัติแชทถูกบันทึกครบ (4 ข้อความ)', msgs.json.messages && msgs.json.messages.length === 4, String(msgs.json.messages && msgs.json.messages.length));
  const list = await call('GET', '/api/chat/conversations', null, A.cookie);
  check('ชื่อหัวข้อตั้งอัตโนมัติจากข้อความแรก', list.json.conversations[0].title === 'สวัสดี', list.json.conversations[0].title);

  const convA2 = (await call('POST', '/api/chat/conversations', {}, A.cookie)).json.conversation;
  const m3 = await call('POST', `/api/chat/conversations/${convA2.id}/messages`, { content: 'ถามความจำ' }, A.cookie);
  check('หัวข้อใหม่ก็จำเรื่องเดิมได้ (ความจำข้ามหัวข้อ)', m3.json.reply === 'ความจำ: มี', m3.json.reply);

  // แยกข้อมูลระหว่างผู้ใช้
  const convB = (await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation;
  check('B อ่านแชทของ A ไม่ได้ (404)', (await call('GET', `/api/chat/conversations/${convA.id}/messages`, null, B.cookie)).status === 404);
  check('B ส่งข้อความเข้าหัวข้อของ A ไม่ได้ (404)', (await call('POST', `/api/chat/conversations/${convA.id}/messages`, { content: 'แอบ' }, B.cookie)).status === 404);
  const mB = await call('POST', `/api/chat/conversations/${convB.id}/messages`, { content: 'ถามความจำ' }, B.cookie);
  check('ความจำของ A ไม่รั่วไปถึง B', mB.json.reply === 'ความจำ: ไม่มี', mB.json.reply);
  check('รหัสหัวข้อมั่วๆ → 404', (await call('GET', '/api/chat/conversations/not-a-uuid/messages', null, A.cookie)).status === 404);

  // โมเดลล่มกลางทาง: ต้องไม่ทิ้งข้อความค้างครึ่งๆ กลางๆ
  const before = (await query('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [convB.id])).rows[0].n;
  failNext = true;
  const mFail = await call('POST', `/api/chat/conversations/${convB.id}/messages`, { content: 'สวัสดี' }, B.cookie);
  const after = (await query('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [convB.id])).rows[0].n;
  check('โมเดลล่ม → ตอบ 502 และไม่บันทึกข้อความค้าง', mFail.status === 502 && before === after, `status ${mFail.status}, ข้อความก่อน/หลัง ${before}/${after}`);

  // ข้อความว่าง/ยาวเกิน
  check('ข้อความว่างถูกปฏิเสธ (400)', (await call('POST', `/api/chat/conversations/${convB.id}/messages`, { content: '   ' }, B.cookie)).status === 400);
  check('ข้อความยาวเกินถูกปฏิเสธ (400)', (await call('POST', `/api/chat/conversations/${convB.id}/messages`, { content: 'ก'.repeat(4001) }, B.cookie)).status === 400);

  // ---- ถอดเสียง (ปุ่มไมค์) — ใช้ตัวถอดเสียงจำลอง ไม่เรียก Gemini จริง ----
  ai.setTranscribeForTests(async (audio, mime) => (audio === 'SILENT' ? '' : `ถอดได้:${mime}`));
  check('ไม่ login ถอดเสียงไม่ได้ (401)', (await call('POST', '/api/chat/transcribe', { audio: 'AAAA', mimeType: 'audio/webm' })).status === 401);
  const tr = await call('POST', '/api/chat/transcribe', { audio: 'QUJD', mimeType: 'audio/webm;codecs=opus' }, B.cookie);
  check('ส่งเสียงแล้วได้ข้อความกลับ (ตัด codecs ออกจากชนิดไฟล์)', tr.status === 200 && tr.json.text === 'ถอดได้:audio/webm', JSON.stringify(tr.json));
  const trSilent = await call('POST', '/api/chat/transcribe', { audio: 'SILENT', mimeType: 'audio/webm' }, B.cookie);
  check('เสียงเงียบ → ได้ข้อความว่าง ไม่ error', trSilent.status === 200 && trSilent.json.text === '');
  check('ไม่ส่งไฟล์เสียง → 400', (await call('POST', '/api/chat/transcribe', { mimeType: 'audio/webm' }, B.cookie)).status === 400);
  check('ชนิดไฟล์ไม่ใช่เสียง → 400', (await call('POST', '/api/chat/transcribe', { audio: 'QUJD', mimeType: 'text/html' }, B.cookie)).status === 400);
  const big = await call('POST', '/api/chat/transcribe', { audio: 'A'.repeat(5 * 1024 * 1024 + 10), mimeType: 'audio/webm' }, B.cookie);
  check('ไฟล์เสียงใหญ่เกินเพดาน → 413', big.status === 413, String(big.status));

  const cats = await call('GET', '/api/chat/categories', null, A.cookie);
  check('รายการหมวดของ A มี 2 หมวดหลัก + "วิชาการ" 1 รายการ', cats.status === 200 && cats.json.categories.length === 5 && cats.json.categories.some((c) => c.name === 'วิชาการ' && c.memories === 1) && cats.json.categories.some((c) => c.name === 'ข้อมูลแชท') && cats.json.categories.some((c) => c.name === 'ทั่วไป') && cats.json.categories.some((c) => c.name === 'ความสามารถเลขา'), JSON.stringify(cats.json.categories));
  const catsB = await call('GET', '/api/chat/categories', null, B.cookie);
  check('B เห็นแค่ 4 หมวดหลักของตัวเอง (ไม่เห็นหมวดของ A)', catsB.status === 200 && catsB.json.categories.length === 4 && !catsB.json.categories.some((c) => c.name === 'วิชาการ'));

  let hitTrLimit = false;
  for (let i = 0; i < 40 && !hitTrLimit; i++) {
    const r = await call('POST', '/api/chat/transcribe', { audio: 'QUJD', mimeType: 'audio/webm' }, B.cookie);
    if (r.status === 429) hitTrLimit = true;
  }
  check('ถอดเสียงถี่เกินเพดาน → โดน 429', hitTrLimit);

  // เพดานส่งถี่: A ส่งไปแล้ว 3 ข้อความ ส่งต่ออีกจนชน 20
  let hit429 = false;
  for (let i = 0; i < 25 && !hit429; i++) {
    const r = await call('POST', `/api/chat/conversations/${convA2.id}/messages`, { content: 'สวัสดี' }, A.cookie);
    if (r.status === 429) hit429 = true;
  }
  check('ส่งถี่เกินเพดาน → โดน 429', hit429);

  // เก็บกวาด: ลบผู้ใช้ทดสอบ (ข้อมูลที่ผูกอยู่ลบตามอัตโนมัติ)
  const del = await query("DELETE FROM users WHERE phone IN ('0999900001','0999900002')");
  const left = await counts();
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (จำนวนกลับมาเท่าก่อนทดสอบ)', del.rowCount === 2 && JSON.stringify(left) === JSON.stringify(base), `ก่อน ${JSON.stringify(base)} หลัง ${JSON.stringify(left)}`);

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query("DELETE FROM users WHERE phone IN ('0999900001','0999900002')"); } catch { /* ignore */ }
  process.exit(1);
});
