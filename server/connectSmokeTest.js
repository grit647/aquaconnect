// ทดสอบปุ่ม "เชื่อมต่อข้อมูล": รายชื่อ → ดูรายละเอียด/ค่าบริการ → ขอเข้าใช้ (แจ้งเจ้าของพร้อมปุ่ม) → กดอนุญาตจากไลน์ → ใช้ข้อมูลและคิดเงิน
//   node server/connectSmokeTest.js
// โมเดล AI/ตัวส่งไลน์เป็นตัวจำลอง (ไม่เสียเงิน ไม่ส่งจริง) • ผู้ใช้ทดสอบเบอร์ 09999000.. ลบทิ้งเมื่อจบ
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.LINE_CHANNEL_SECRET = 'test-secret-for-connect-test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'test-token';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = require('./index');
const ai = require('./ai');
const line = require('./line');
const memory = require('./memory');
const sharing = require('./sharing');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };

const sent = [];
line.setSenderForTests(async (path, body) => { sent.push({ path, body }); });
ai.setCallModelForTests(async () => ({ parts: [{ text: 'คำตอบจากเลขาเจ้าของ' }], usage: {} }));

const PHONES = ['0999900081', '0999900082', '0999900083'];
const OWNER_LINE = 'Utest-connect-owner';
const OTHER_LINE = 'Utest-connect-other';
const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
const cookieFor = async (id) => { const u = (await query('SELECT * FROM users WHERE id = $1', [id])).rows[0]; return 'aq_token=' + jwt.sign({ id: u.id, phone: u.phone, name: u.name, isAdmin: false }, secret, { expiresIn: '5m' }); };
async function call(method, path, body, cookie, headers = {}) {
  const raw = body ? JSON.stringify(body) : undefined;
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json };
}
const sign = (obj) => crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(JSON.stringify(obj)).digest('base64');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  const ids = 'SELECT id FROM users WHERE phone = ANY($1)';
  await query(`DELETE FROM credit_ledger WHERE user_id IN (${ids})`, [PHONES]);
  await query(`DELETE FROM access_sessions WHERE requester_id IN (${ids}) OR owner_id IN (${ids})`, [PHONES]);
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
}

(async () => {
  await cleanup();
  const baseUsers = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const oldRate = (await query("SELECT value FROM app_settings WHERE key = 'commission_rate'")).rows[0];
  await query("INSERT INTO app_settings (key, value) VALUES ('commission_rate', '20') ON CONFLICT (key) DO UPDATE SET value = '20'");

  const mk = async (name, phone, lineId) => (await query('INSERT INTO users (phone, pin_hash, name, line_user_id) VALUES ($1, $2, $3, $4) RETURNING id', [phone, 'x', name, lineId || null])).rows[0].id;
  const owner = await mk('เจ้าของ เชื่อม', PHONES[0], OWNER_LINE);
  const asker = await mk('ผู้ขอ เชื่อม', PHONES[1], null);
  const other = await mk('คนนอก เชื่อม', PHONES[2], OTHER_LINE);
  const ownerC = await cookieFor(owner); const askerC = await cookieFor(asker); const otherC = await cookieFor(other);

  await memory.saveMemory(owner, 'วิชาการ', 'ข้อมูลวิชาการทดสอบ');
  await memory.saveMemory(owner, 'ฟาร์ม', 'ข้อมูลฟาร์มทดสอบ');
  await memory.saveMemory(owner, 'ส่วนตัว', 'ความลับ');
  await sharing.setCategoryVisibility(owner, 'วิชาการ', 'paid', 'question', 10);
  await sharing.setCategoryVisibility(owner, 'ฟาร์ม', 'free');

  // --- รายชื่อ / รายละเอียด ---
  check('ไม่ล็อกอินดูรายชื่อไม่ได้', (await call('GET', '/api/connect/people')).status === 401);
  const ppl = await call('GET', '/api/connect/people', null, askerC);
  const me1 = ppl.json.people.find((p) => p.id === owner);
  check('รายชื่อมีเจ้าของที่เปิดหมวดแชร์ (2 หมวด)', !!me1 && me1.categories === 2);
  const oth = ppl.json.people.find((p) => p.id === other);
  check('รายชื่อมีสมาชิกทุกคน (คนที่ยังไม่เปิดข้อมูลมี categories = 0) แต่ไม่มีตัวเอง', !!oth && oth.categories === 0 && !ppl.json.people.some((p) => p.id === asker));
  check('คนที่เปิดข้อมูลแล้วขึ้นก่อนคนที่ยังไม่เปิด', ppl.json.people.findIndex((p) => p.id === owner) < ppl.json.people.findIndex((p) => p.id === other));
  check('รายชื่อไม่เปิดเผยเบอร์โทร/ไลน์', !JSON.stringify(ppl.json).includes(PHONES[0]) && !JSON.stringify(ppl.json).includes(OWNER_LINE));
  const det = await call('GET', `/api/connect/people/${owner}`, null, askerC);
  const cats = det.json.categories || [];
  check('รายละเอียดแสดงเฉพาะหมวดที่เปิด + ราคา (ไม่เห็นหมวดส่วนตัว)', cats.length === 2 && !cats.some((c) => c.name === 'ส่วนตัว') && cats.find((c) => c.name === 'วิชาการ').price_credits === 10 && cats.find((c) => c.name === 'วิชาการ').price_type === 'question');
  check('รายละเอียดไม่มีเนื้อหาข้อมูลดิบ', !JSON.stringify(det.json).includes('ข้อมูลวิชาการทดสอบ'));
  check('ดูรายละเอียดได้โดยไม่เสียเงิน/ไม่ต้องขอ', det.status === 200 && cats.every((c) => c.my_status === null));

  // --- ขอเข้าใช้ → แจ้งเจ้าของพร้อมปุ่ม ---
  const rq = await call('POST', '/api/connect/request', { ownerId: owner, category: 'วิชาการ' }, askerC);
  check('ขอเข้าใช้ → pending', rq.status === 200 && rq.json.status === 'pending');
  const btn = sent.find((m) => m.body.to === OWNER_LINE && m.body.messages[0].type === 'template');
  const actions = btn && btn.body.messages[0].template.actions;
  check('เจ้าของได้ข้อความพร้อมปุ่ม อนุญาต/ไม่อนุญาต', !!actions && actions.length === 2 && actions[0].label === 'อนุญาต' && actions[1].label === 'ไม่อนุญาต');
  check('คนนอกไม่ได้รับข้อความ', !sent.some((m) => m.body.to === OTHER_LINE));
  const mineO = await call('GET', '/api/connect/mine', null, ownerC);
  check('เจ้าของเห็นคำขอที่รออนุญาตในแอป', mineO.json.incoming.some((r) => r.status === 'pending' && r.requester_name === 'ผู้ขอ เชื่อม'));

  // ยังไม่อนุญาต → ใช้ไม่ได้
  const conv = (await call('POST', '/api/chat/conversations', {}, askerC)).json.conversation.id;
  const askNow = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ถาม', askRequestId: rq.json.requestId }, askerC);
  check('ยังไม่ได้รับอนุญาต → ใช้ข้อมูลไม่ได้', askNow.status === 400);

  // --- กดปุ่มจากไลน์ ---
  const evOther = { events: [{ type: 'postback', replyToken: 'rt-x', webhookEventId: 'ev-pb-other', source: { userId: OTHER_LINE }, postback: { data: actions[0].data } }] };
  await call('POST', '/api/line/webhook', evOther, null, { 'x-line-signature': sign(evOther) });
  await wait(300);
  check('คนอื่นกดปุ่มอนุญาตแทนไม่ได้ (ตัวตนมาจากไลน์ที่กดจริง)', (await query('SELECT status FROM access_requests WHERE id = $1', [rq.json.requestId])).rows[0].status === 'pending');
  const evOwner = { events: [{ type: 'postback', replyToken: 'rt-y', webhookEventId: 'ev-pb-owner', source: { userId: OWNER_LINE }, postback: { data: actions[0].data } }] };
  await call('POST', '/api/line/webhook', evOwner, null, { 'x-line-signature': sign(evOwner) });
  await wait(300);
  check('เจ้าของกดอนุญาตในไลน์ → approved', (await query('SELECT status FROM access_requests WHERE id = $1', [rq.json.requestId])).rows[0].status === 'approved');

  // --- ใช้ข้อมูล: เครดิตไม่พอ → ไม่คิดเงิน / มีเครดิต → คิดตามที่ตั้ง ---
  const poor = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'คำถามแรก', askRequestId: rq.json.requestId }, askerC);
  check('เครดิตไม่พอ → ใช้ไม่ได้ ไม่ถูกหักอะไร', poor.status === 400 && poor.json.error.includes('เครดิตไม่พอ'));
  await query("INSERT INTO credit_balances (user_id, balance) VALUES ($1, 50) ON CONFLICT (user_id) DO UPDATE SET balance = 50", [asker]);
  await query("INSERT INTO credit_ledger (user_id, amount, type, note, balance_after) VALUES ($1, 50, 'adjust', 'ทดสอบ', 50)", [asker]);
  const use = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'คำถามแรก', askRequestId: rq.json.requestId }, askerC);
  check('ใช้ข้อมูล: ได้คำตอบจากเลขาเจ้าของ + บอกว่าหักเท่าไหร่', use.status === 200 && use.json.reply.includes('คำตอบจากเลขาเจ้าของ') && use.json.reply.includes('หักค่าบริการ 10') && use.json.creditsCharged === 10);
  check('เริ่มคิดค่าบริการตามที่เจ้าของตั้ง (50 → 40)', use.json.balanceLeft === 40);
  const ob = Number((await query('SELECT balance FROM credit_balances WHERE user_id = $1', [owner])).rows[0].balance);
  check('เจ้าของได้รายได้หลังหักส่วนแบ่ง 20% (8)', Math.abs(ob - 8) < 0.01);
  const msgs = await call('GET', `/api/chat/conversations/${conv}/messages`, null, askerC);
  check('บทสนทนาบันทึกคำถาม/คำตอบไว้', msgs.json.messages.some((m) => m.role === 'assistant' && m.content.includes('ข้อมูลจากคุณเจ้าของ เชื่อม')));

  // --- ความปลอดภัย ---
  const steal = await call('POST', `/api/chat/conversations/${(await call('POST', '/api/chat/conversations', {}, otherC)).json.conversation.id}/messages`, { content: 'ขโมย', askRequestId: rq.json.requestId }, otherC);
  check('คนอื่นเอา request ของผู้ขอไปใช้ไม่ได้', steal.status === 400);

  // --- ถอนสิทธิ์จากหน้าจอ ---
  check('เจ้าของถอนสิทธิ์ผ่านปุ่มได้', (await call('POST', '/api/connect/decide', { requestId: rq.json.requestId, decision: 'revoke' }, ownerC)).status === 200);
  const after = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ถามอีก', askRequestId: rq.json.requestId }, askerC);
  check('ถอนสิทธิ์แล้วใช้ไม่ได้ และไม่ถูกหักเงินเพิ่ม', after.status === 400 && Math.abs(Number((await query('SELECT balance FROM credit_balances WHERE user_id = $1', [asker])).rows[0].balance) - 40) < 0.01);
  const rq2 = await call('POST', '/api/connect/request', { ownerId: owner, category: 'วิชาการ' }, askerC);
  check('ขอเข้าใช้ใหม่ได้หลังถูกถอนสิทธิ์', rq2.status === 200 && rq2.json.status === 'pending' && rq2.json.requestId !== rq.json.requestId);
  check('เจ้าของกด "ไม่อนุญาต" ผ่านปุ่มได้', (await call('POST', '/api/connect/decide', { requestId: rq2.json.requestId, decision: 'deny' }, ownerC)).status === 200);

  if (oldRate) await query("UPDATE app_settings SET value = $1::jsonb WHERE key = 'commission_rate'", [JSON.stringify(oldRate.value)]);
  await cleanup();
  const left = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  check('ลบข้อมูลทดสอบหมดเกลี้ยง', left === baseUsers, `ก่อน ${baseUsers} หลัง ${left}`);
  server.close(); await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error('ทดสอบพังกลางทาง:', e); try { await cleanup(); } catch { /* ignore */ } process.exit(1); });
