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

  // --- สวิตช์หลัก เปิด/ปิดรับการเชื่อมต่อ ---
  check('ไม่ล็อกอินเปลี่ยนสวิตช์ไม่ได้', (await call('POST', '/api/connect/enabled', { enabled: false })).status === 401);
  check('ค่าเริ่มต้นสวิตช์ = เปิด', (await call('GET', '/api/connect/mine', null, ownerC)).json.connectEnabled === true);
  check('เจ้าของปิดสวิตช์ได้', (await call('POST', '/api/connect/enabled', { enabled: false }, ownerC)).json.connectEnabled === false);
  const closedList = (await call('GET', '/api/connect/people', null, askerC)).json.people.find((p) => p.id === owner);
  check('ปิดสวิตช์ → รายชื่อแสดงว่าปิดรับ ไม่นับหมวด', !!closedList && closedList.open === false && closedList.categories === 0);
  const closedDet = await call('GET', `/api/connect/people/${owner}`, null, askerC);
  check('ปิดสวิตช์ → เข้าดูหมวดไม่ได้ (closed, ไม่มีหมวด)', closedDet.json.closed === true && closedDet.json.categories.length === 0);
  const balBefore = Number((await query('SELECT balance FROM credit_balances WHERE user_id = $1', [asker])).rows[0].balance);
  const closedAsk = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ถามตอนปิด', askRequestId: rq.json.requestId }, askerC);
  check('ปิดสวิตช์ → ใช้ข้อมูลที่เคยอนุญาตไว้ไม่ได้ และไม่ถูกหักเงิน', closedAsk.status === 400 && closedAsk.json.error.includes('ปิดการอนุญาต') && Math.abs(Number((await query('SELECT balance FROM credit_balances WHERE user_id = $1', [asker])).rows[0].balance) - balBefore) < 0.01);
  check('ปิดสวิตช์ → ขอสิทธิ์ใหม่ไม่ได้', (await call('POST', '/api/connect/request', { ownerId: owner, category: 'ฟาร์ม' }, askerC)).status === 400);
  check('ปิดสวิตช์ → เจ้าของยังเห็นสถานะปิดของตัวเอง', (await call('GET', '/api/connect/mine', null, ownerC)).json.connectEnabled === false);
  check('เจ้าของเปิดสวิตช์กลับได้', (await call('POST', '/api/connect/enabled', { enabled: true }, ownerC)).json.connectEnabled === true);
  const openDet = await call('GET', `/api/connect/people/${owner}`, null, askerC);
  check('เปิดสวิตช์กลับ → หมวดและสิทธิ์เดิมกลับมา (approved ยังอยู่)', openDet.json.categories.length === 2 && openDet.json.categories.find((c) => c.name === 'วิชาการ').my_status === 'approved');
  const tools = require('./secretary').buildTools(owner, null);
  check('เครื่องมือเลขาสั่งปิด/เปิดสวิตช์ได้', (await tools.set_connect_enabled.run({ enabled: false })).connectEnabled === false && (await tools.set_connect_enabled.run({ enabled: true })).connectEnabled === true);

  // --- เมนู "ตั้งค่าข้อมูล": ดูจำนวนเนื้อหา + ตั้งส่วนตัว/ฟรี/เสียเงิน ---
  await memory.saveMemory(owner, 'ทดสอบตั้งค่า', 'เนื้อหา 1'); await memory.saveMemory(owner, 'ทดสอบตั้งค่า', 'เนื้อหา 2');
  check('ไม่ล็อกอินดูตั้งค่าข้อมูลไม่ได้', (await call('GET', '/api/connect/my-categories')).status === 401);
  const mc = await call('GET', '/api/connect/my-categories', null, ownerC);
  const tcat = mc.json.categories.find((x) => x.name === 'ทดสอบตั้งค่า');
  check('ตั้งค่าข้อมูล: เห็นหมวดของตัวเองพร้อมจำนวนเนื้อหา', mc.status === 200 && !!tcat && tcat.items === 2 && tcat.visibility === 'private');
  check('ตั้งค่าข้อมูล: ผู้ถามเห็นเฉพาะหมวดของตัวเอง (ไม่ปนของเจ้าของ)', !(await call('GET', '/api/connect/my-categories', null, askerC)).json.categories.some((x) => x.name === 'ทดสอบตั้งค่า'));
  const setHour = await call('POST', '/api/connect/category-setting', { category: 'ทดสอบตั้งค่า', visibility: 'paid', priceType: 'hour', price: 150 }, ownerC);
  const after1 = (await call('GET', '/api/connect/my-categories', null, ownerC)).json.categories.find((x) => x.name === 'ทดสอบตั้งค่า');
  check('ตั้งเป็นเสียเงิน 150 เครดิต/ชั่วโมงได้ และบันทึกจริง', setHour.status === 200 && after1.visibility === 'paid' && after1.price_type === 'hour' && after1.price_credits === 150);
  check('คนอื่นเห็นราคาที่ตั้งไว้ในหน้าเชื่อมต่อ', (await call('GET', `/api/connect/people/${owner}`, null, askerC)).json.categories.find((x) => x.name === 'ทดสอบตั้งค่า').price_credits === 150);
  check('เสียเงินแต่ไม่ใส่ราคา → ปฏิเสธ', (await call('POST', '/api/connect/category-setting', { category: 'ทดสอบตั้งค่า', visibility: 'paid', priceType: 'hour' }, ownerC)).status === 400);
  check('คนอื่นแก้หมวดของเจ้าของไม่ได้', (await call('POST', '/api/connect/category-setting', { category: 'ทดสอบตั้งค่า', visibility: 'free' }, askerC)).status === 400);
  check('ตั้งเป็นฟรีได้', (await call('POST', '/api/connect/category-setting', { category: 'ทดสอบตั้งค่า', visibility: 'free' }, ownerC)).status === 200);
  const items = await call('GET', `/api/connect/my-categories/${tcat.id}/items`, null, ownerC);
  check('เจ้าของดูเนื้อหาในหมวดตัวเองได้', items.status === 200 && items.json.items.length === 2);
  check('คนอื่นดูเนื้อหาในหมวดของเจ้าของไม่ได้ (404)', (await call('GET', `/api/connect/my-categories/${tcat.id}/items`, null, askerC)).status === 404);
  check('ตั้งกลับเป็นส่วนตัวได้', (await call('POST', '/api/connect/category-setting', { category: 'ทดสอบตั้งค่า', visibility: 'private' }, ownerC)).status === 200);

  // --- ความปลอดภัย ---
  const steal = await call('POST', `/api/chat/conversations/${(await call('POST', '/api/chat/conversations', {}, otherC)).json.conversation.id}/messages`, { content: 'ขโมย', askRequestId: rq.json.requestId }, otherC);
  check('คนอื่นเอา request ของผู้ขอไปใช้ไม่ได้', steal.status === 400);

  // --- หมวดฟรี: ใช้ได้ 15 นาทีแล้วตัด ต้องขอใหม่ ---
  const fr = await call('POST', '/api/connect/request', { ownerId: owner, category: 'ฟาร์ม' }, askerC);
  check('ขอหมวดฟรี → pending (ต้องรอเจ้าของกดอนุญาต)', fr.status === 200 && fr.json.status === 'pending');
  const frNoAsk = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ถามก่อนอนุญาต', askRequestId: fr.json.requestId }, askerC);
  check('ยังไม่อนุญาต → ใช้หมวดฟรีไม่ได้', frNoAsk.status === 400);
  const frAp = await call('POST', '/api/connect/decide', { requestId: fr.json.requestId, decision: 'approve' }, ownerC);
  const frRow = (await query('SELECT status, expires_at, decided_at FROM access_requests WHERE id = $1', [fr.json.requestId])).rows[0];
  const mins = (new Date(frRow.expires_at) - new Date(frRow.decided_at)) / 60000;
  check('เจ้าของอนุญาตหมวดฟรี → ตั้งเวลาหมดอายุ 15 นาทีให้เอง', frAp.status === 200 && frRow.status === 'approved' && Math.abs(mins - 15) < 0.1, mins + ' นาที');
  check('คำตอบอนุญาตบอกเวลาหมดอายุ (หน้าจอใช้นับถอยหลัง)', !!frAp.json.expiresAt);
  const frMine = (await call('GET', '/api/connect/mine', null, askerC)).json.outgoing.find((r) => r.request_id === fr.json.requestId);
  check('ผู้ขอเห็นสถานะ approved + เวลาหมดอายุ (ให้หน้าจอเชื่อมต่ออัตโนมัติ)', frMine && frMine.status === 'approved' && !!frMine.expires_at && !!frMine.decided_at);
  const frUse = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ถามหมวดฟรี', askRequestId: fr.json.requestId }, askerC);
  check('ในเวลา 15 นาที → ใช้หมวดฟรีได้ ไม่หักเงิน', frUse.status === 200 && !frUse.json.creditsCharged);
  await query("UPDATE access_requests SET expires_at = now() - interval '1 minute' WHERE id = $1", [fr.json.requestId]);
  const frLate = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ถามหลังหมดเวลา', askRequestId: fr.json.requestId }, askerC);
  check('ครบ 15 นาที → ตัดการเชื่อมต่อ ใช้ไม่ได้', frLate.status === 400 && frLate.json.error.includes('หมดเวลา'), frLate.json.error);
  check('สถานะกลายเป็น expired', (await call('GET', '/api/connect/mine', null, askerC)).json.outgoing.find((r) => r.request_id === fr.json.requestId).status === 'expired');
  const fr2 = await call('POST', '/api/connect/request', { ownerId: owner, category: 'ฟาร์ม' }, askerC);
  check('ขอใหม่หลังหมดเวลา → ได้คำขอใหม่ pending (ต้องให้เจ้าของอนุญาตอีกครั้ง)', fr2.status === 200 && fr2.json.status === 'pending' && fr2.json.requestId !== fr.json.requestId);
  await call('POST', '/api/connect/decide', { requestId: fr2.json.requestId, decision: 'approve' }, ownerC);
  const frUse2 = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ถามรอบใหม่', askRequestId: fr2.json.requestId }, askerC);
  check('เจ้าของอนุญาตรอบใหม่ → ใช้ได้อีก 15 นาที', frUse2.status === 200);
  const paidRow = (await query("SELECT expires_at FROM access_requests WHERE id = $1", [rq.json.requestId])).rows[0];
  check('หมวดเสียเงินไม่ถูกจำกัด 15 นาที (ไม่มีวันหมดอายุ)', paidRow.expires_at === null);

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
