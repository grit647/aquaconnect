// ทดสอบส่วนไลน์ครบวงจร โดยไม่คุยกับ LINE จริง (ตัวส่งข้อความและตัวตรวจ ID token เป็นตัวจำลอง)
//   node server/lineSmokeTest.js
// ใช้ผู้ใช้ทดสอบเบอร์ขึ้นต้น 09999 แล้วลบทิ้งเมื่อจบ — ไม่แตะบัญชีจริง
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.LINE_CHANNEL_SECRET = 'test-secret-for-smoke-test';   // ใช้แทนค่าจริงตอนทดสอบเท่านั้น
process.env.LIFF_ID = '1234567890-testliff';

const crypto = require('crypto');
const app = require('./index');
const line = require('./line');
const { query, getPool } = require('./db');

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`);
}

const sent = [];
line.setSenderForTests(async (path, body) => { sent.push({ path, body }); });
line.setVerifyIdTokenForTests(async (token) => {
  if (token === 'good-A') return { lineUserId: 'Utest-A-0001', name: 'ไลน์ เอ' };
  throw new Error('bad token');
});

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;

async function call(method, path, body, cookie, headers = {}) {
  const raw = body ? JSON.stringify(body) : undefined;
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const sign = (obj) => crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(JSON.stringify(obj)).digest('base64');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // จำนวนผู้ใช้จริงก่อนเริ่มทดสอบ — ตอนจบต้องกลับมาเท่าเดิม (ห้ามสมมติว่ามีแค่แอดมินคนเดียว)
  const baseUsers = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;

  // ---- webhook ----
  const evFollow = { events: [{ type: 'follow', replyToken: 'rt1', webhookEventId: 'ev-follow-1' }] };
  check('webhook ไม่มีลายเซ็น → 401', (await call('POST', '/api/line/webhook', evFollow)).status === 401);
  check('webhook ลายเซ็นปลอม → 401', (await call('POST', '/api/line/webhook', evFollow, null, { 'x-line-signature': 'AAAA' })).status === 401);
  check('ลายเซ็นปลอมไม่มีการตอบข้อความออกไป', sent.length === 0);

  const ok = await call('POST', '/api/line/webhook', evFollow, null, { 'x-line-signature': sign(evFollow) });
  await wait(100);
  check('webhook ลายเซ็นถูก → 200', ok.status === 200);
  check('เพิ่มเพื่อน (follow) → ส่งข้อความต้อนรับ', sent.length === 1 && sent[0].path === '/message/reply' && sent[0].body.replyToken === 'rt1' && sent[0].body.messages[0].text.includes('ยินดีต้อนรับ'));

  const evHelp = { events: [{ type: 'message', replyToken: 'rt2', webhookEventId: 'ev-help-1', message: { type: 'text', text: 'วิธีใช้' } }] };
  await call('POST', '/api/line/webhook', evHelp, null, { 'x-line-signature': sign(evHelp) });
  await wait(100);
  check('พิมพ์ "วิธีใช้" → ตอบวิธีใช้', sent.length === 2 && sent[1].body.messages[0].text.startsWith('วิธีใช้ AquaConnect'));

  await call('POST', '/api/line/webhook', evHelp, null, { 'x-line-signature': sign(evHelp) }); // ส่งซ้ำ (LINE redelivery)
  await wait(100);
  check('เหตุการณ์ซ้ำ (redelivery) → ไม่ตอบซ้ำ', sent.length === 2, `ข้อความที่ส่งทั้งหมด ${sent.length}`);

  const evOther = { events: [{ type: 'message', replyToken: 'rt3', webhookEventId: 'ev-other-1', message: { type: 'text', text: 'ทดสอบอะไรก็ได้' } }] };
  await call('POST', '/api/line/webhook', evOther, null, { 'x-line-signature': sign(evOther) });
  await wait(100);
  check('ข้อความทั่วไป → บอกให้ใช้ปุ่มคุยกับเลขา', sent.length === 3 && sent[2].body.messages[0].text.includes('คุยกับเลขา'));

  const cfg = await call('GET', '/api/line/config');
  check('ค่าสาธารณะให้หน้าเว็บ (LIFF ID)', cfg.json.liffId === '1234567890-testliff');

  // ---- เข้าสู่ระบบด้วย LINE (LIFF) ----
  check('ไม่ส่ง token → 400', (await call('POST', '/api/auth/line', {})).status === 400);
  check('token ปลอม → 401', (await call('POST', '/api/auth/line', { idToken: 'fake' })).status === 401);

  const first = await call('POST', '/api/auth/line', { idToken: 'good-A' });
  check('LINE จริงแต่ยังไม่เคยผูกบัญชี → needsLink', first.status === 200 && first.json.ok === false && first.json.needsLink === true && first.json.lineName === 'ไลน์ เอ');

  const reg = await call('POST', '/api/auth/register', { name: 'ทดสอบ ไลน์ เอ', phone: '0999900011', pin: '121212', idToken: 'good-A' });
  check('สมัครพร้อมส่ง token → ผูกไลน์ให้อัตโนมัติ', reg.status === 200 && reg.json.line && reg.json.line.linked === true);

  const again = await call('POST', '/api/auth/line', { idToken: 'good-A' });
  check('ครั้งต่อไปเข้าอัตโนมัติด้วย LINE ไม่ต้องกรอก PIN', again.status === 200 && again.json.ok === true && again.json.user.name === 'ทดสอบ ไลน์ เอ');
  const me = await call('GET', '/api/auth/me', null, again.cookie);
  check('session ที่ได้จาก LINE ใช้งานได้จริง', me.json.user && me.json.user.phone === '0999900011');

  // บัญชีอื่นพยายามผูก LINE เดียวกัน
  const regB = await call('POST', '/api/auth/register', { name: 'ทดสอบ บี', phone: '0999900012', pin: '343434' });
  const loginB = await call('POST', '/api/auth/login', { phone: '0999900012', pin: '343434', idToken: 'good-A' });
  check('LINE เดียวกันผูกซ้ำกับอีกบัญชีไม่ได้ (แต่ยังเข้าสู่ระบบด้วย PIN ได้)', loginB.status === 200 && loginB.json.line && loginB.json.line.linked === false, loginB.json.line && loginB.json.line.error);

  const badBind = await call('POST', '/api/auth/login', { phone: '0999900012', pin: '343434', idToken: 'not-valid' });
  check('token ปลอมตอนเข้าด้วย PIN → ผูกไม่ได้แต่เข้าสู่ระบบได้', badBind.status === 200 && badBind.json.line && badBind.json.line.linked === false);

  // เก็บกวาด
  const del = await query("DELETE FROM users WHERE phone IN ('0999900011','0999900012')");
  const left = await query('SELECT count(*)::int AS users FROM users');
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (จำนวนผู้ใช้กลับมาเท่าก่อนทดสอบ)', del.rowCount === 2 && left.rows[0].users === baseUsers, `ก่อน ${baseUsers} หลัง ${left.rows[0].users}`);

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query("DELETE FROM users WHERE phone IN ('0999900011','0999900012')"); } catch { /* ignore */ }
  process.exit(1);
});
