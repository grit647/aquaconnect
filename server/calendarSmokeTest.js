// ทดสอบปฏิทิน & เตือน: สร้าง/ตรวจข้อมูล/แยกของแต่ละคน, ส่งแจ้งเตือนไลน์พร้อมปุ่มรับทราบ, ส่งซ้ำ/หยุดเมื่อรับทราบ, เลขาสร้างนัดผ่านเครื่องมือ
//   node server/calendarSmokeTest.js
// ตัวส่งไลน์และโมเดล AI เป็นตัวจำลอง • จำกัดการส่งแจ้งเตือนเฉพาะผู้ใช้ทดสอบ (ไม่แตะนัดจริง) • ผู้ใช้ทดสอบเบอร์ 09999000.. ลบทิ้งเมื่อจบ (นัดหายตามผู้ใช้)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.LINE_CHANNEL_SECRET = 'test-secret-for-calendar-test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'test-token';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = require('./index');
const ai = require('./ai');
const line = require('./line');
const cal = require('./calendar');
const { runDueReminders, buildText } = require('./reminders');
const { buildTools, buildSystemPrompt } = require('./secretary');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };

const sent = [];
let senderFails = false;
line.setSenderForTests(async (path, body) => { if (senderFails && path === '/message/push') throw new Error('LINE down'); sent.push({ path, body }); });
ai.setCallModelForTests(async () => ({ parts: [{ text: 'ok' }], usage: {} }));

const PHONES = ['0999900181', '0999900182', '0999900183'];
const LA = 'Utest-cal-A'; const LC = 'Utest-cal-C';
const dayKey = (n) => cal.bkkDateKey(new Date(Date.now() + n * 86400000));
const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
const cookieFor = async (id) => { const u = (await query('SELECT * FROM users WHERE id = $1', [id])).rows[0]; return 'aq_token=' + jwt.sign({ id: u.id, phone: u.phone, name: u.name, isAdmin: false }, secret, { expiresIn: '5m' }); };
async function call(method, path, body, cookie, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json };
}
const sign = (obj) => crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(JSON.stringify(obj)).digest('base64');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
const pushes = () => sent.filter((m) => m.path === '/message/push');

(async () => {
  await cleanup();
  const baseUsers = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const mk = async (name, phone, lineId) => (await query('INSERT INTO users (phone, pin_hash, name, line_user_id) VALUES ($1, $2, $3, $4) RETURNING id', [phone, 'x', name, lineId || null])).rows[0].id;
  const A = await mk('เจ้าของนัด เอ', PHONES[0], LA);
  const B = await mk('ไม่มีไลน์ บี', PHONES[1], null);
  const C = await mk('คนอื่น ซี', PHONES[2], LC);
  const ca = await cookieFor(A); const cb = await cookieFor(B); const cc = await cookieFor(C);
  const IDS = [A, B, C];
  const run = () => runDueReminders({ force: true, userIds: IDS });

  // ---------- สร้างนัด + ตรวจข้อมูล ----------
  check('ไม่ล็อกอินใช้ปฏิทินไม่ได้', (await call('GET', '/api/calendar?month=2026-11')).status === 401);
  const d10 = dayKey(10);
  const e1 = await call('POST', '/api/calendar', { title: 'ประชุมบริษัท เอ', note: 'ห้อง 3', date: d10, time: '10:00', remind: { mode: 'minutes', minutes: 60 } }, ca);
  check('สร้างนัดมีเวลา + เตือนก่อน 60 นาที → เตือน 09:00 วันเดียวกัน', e1.status === 200 && e1.json.event.time === '10:00' && e1.json.event.remindDate === d10 && e1.json.event.remindTime === '09:00', JSON.stringify(e1.json.event || e1.json));
  const row1 = (await query('SELECT event_at, remind_at FROM events WHERE id = $1', [e1.json.event.id])).rows[0];
  check('เวลาไทยถูกแปลงเป็น UTC ถูกต้อง (10:00 ไทย = 03:00 UTC)', new Date(row1.event_at).toISOString() === `${d10}T03:00:00.000Z` && new Date(row1.remind_at).toISOString() === `${d10}T02:00:00.000Z`);
  const e2 = await call('POST', '/api/calendar', { title: 'วันครบรอบ', date: dayKey(12), allDay: true }, ca);
  check('นัดทั้งวัน (ไม่ระบุเวลา) → เตือน 08:00 เช้าวันนั้น', e2.status === 200 && e2.json.event.allDay === true && e2.json.event.remindTime === '08:00' && e2.json.event.time === null);
  const e3 = await call('POST', '/api/calendar', { title: 'เตือนล่วงหน้าหนึ่งวัน', date: dayKey(14), time: '15:30', remind: { mode: 'custom', date: dayKey(13), time: '09:00' } }, ca);
  check('กำหนดวัน-เวลาเตือนเองได้', e3.status === 200 && e3.json.event.remindDate === dayKey(13) && e3.json.event.remindTime === '09:00');

  const bad = async (body, label) => check(`ตรวจข้อมูล: ${label} → 400`, (await call('POST', '/api/calendar', body, ca)).status === 400);
  await bad({ date: dayKey(5) }, 'ไม่มีชื่อนัด');
  await bad({ title: 'x', date: '2027-02-31' }, 'วันที่ไม่มีจริง (31 ก.พ.)');
  await bad({ title: 'x', date: 'พรุ่งนี้' }, 'วันที่ไม่ใช่รูปแบบ');
  await bad({ title: 'x', date: dayKey(5), time: '25:00' }, 'เวลา 25:00');
  await bad({ title: 'x', date: dayKey(-3), time: '10:00' }, 'วันที่นัดผ่านไปแล้ว');
  await bad({ title: 'x', date: dayKey(5), time: '10:00', remind: { mode: 'custom', date: dayKey(-2), time: '10:00' } }, 'เวลาเตือนผ่านไปแล้ว');
  await bad({ title: 'x', date: dayKey(5), time: '10:00', remind: { mode: 'custom', date: dayKey(9), time: '10:00' } }, 'เตือนหลังวันนัดเกิน 1 วัน');
  await bad({ title: 'x', date: dayKey(5), time: '10:00', remind: { mode: 'minutes', minutes: -5 } }, 'เตือนล่วงหน้าเป็นลบ');
  await bad({ title: 'ย'.repeat(121), date: dayKey(5) }, 'ชื่อยาวเกิน');
  await bad({ title: 'x', date: dayKey(5), remind: { mode: 'weird' } }, 'รูปแบบเตือนมั่ว');
  await bad({ title: 'x', date: dayKey(2000), time: '10:00' }, 'นัดไกลเกิน 3 ปี');

  // ---------- ดูปฏิทิน / แยกของแต่ละคน ----------
  const ym = d10.slice(0, 7);
  const m1 = await call('GET', `/api/calendar?month=${ym}`, null, ca);
  check('ดูปฏิทินรายเดือน: เห็นนัดของตัวเอง', m1.status === 200 && m1.json.events.some((e) => e.id === e1.json.event.id));
  check('ผู้ใช้อื่นไม่เห็นนัดของคนอื่น', !(await call('GET', `/api/calendar?month=${ym}`, null, cb)).json.events.some((e) => e.id === e1.json.event.id));
  check('เดือนรูปแบบมั่ว → 400', (await call('GET', '/api/calendar?month=abc', null, ca)).status === 400);
  check('ลบนัดของคนอื่นไม่ได้ (404)', (await call('DELETE', `/api/calendar/${e1.json.event.id}`, null, cb)).status === 404);
  check('รับทราบนัดของคนอื่นไม่ได้ (404)', (await call('POST', `/api/calendar/${e1.json.event.id}/ack`, null, cb)).status === 404);

  // ---------- ส่งแจ้งเตือนทางไลน์ ----------
  const due1 = (await query("INSERT INTO events (user_id, title, note, event_at, remind_at) VALUES ($1, 'ประชุมด่วน', 'ห้องประชุมใหญ่', now() + interval '1 hour', now() - interval '1 minute') RETURNING id", [A])).rows[0].id;
  const before = pushes().length;
  const r1 = await run();
  const p1 = pushes().slice(before);
  check('ถึงเวลา → ส่งไลน์หาเจ้าของนัดเท่านั้น พร้อมปุ่ม "รับทราบแล้ว"', p1.length === 1 && p1[0].body.to === LA && p1[0].body.messages[0].template.actions[0].label === 'รับทราบแล้ว' && p1[0].body.messages[0].template.actions[0].data === `act=remind&id=${due1}`, JSON.stringify(r1));
  const txt = p1[0].body.messages[0].template.text;
  check('ข้อความแจ้งเตือนมีชื่อนัด วันเวลา และบันทึก ไม่เกิน 160 ตัวอักษร', txt.includes('ประชุมด่วน') && txt.includes('ห้องประชุมใหญ่') && txt.includes('เวลา') && txt.length <= 160, txt);
  check('นัดที่ยังไม่ถึงเวลาเตือน ไม่ถูกส่ง', !p1.some((m) => m.body.messages[0].altText.includes('ประชุมบริษัท เอ')));
  await run();
  check('รันซ้ำทันที → ไม่ส่งซ้ำ', pushes().length === before + 1);
  await query("UPDATE events SET remind_sent_at = now() - interval '31 minutes' WHERE id = $1", [due1]);
  await run();
  check('ยังไม่รับทราบเกิน 30 นาที → ส่งซ้ำ 1 ครั้ง (ตามค่าตั้ง)', pushes().length === before + 2);
  await query("UPDATE events SET remind_sent_at = now() - interval '31 minutes' WHERE id = $1", [due1]);
  await run();
  check('ส่งซ้ำครบจำนวนแล้ว → หยุด ไม่ส่งอีก', pushes().length === before + 2);

  // ---------- ปุ่มรับทราบจากไลน์ ----------
  const pb = (userId, id, evId) => ({ events: [{ type: 'postback', replyToken: 'rt-' + id, webhookEventId: 'ev-' + id, source: { userId }, postback: { data: `act=remind&id=${evId}` } }] });
  const evOther = pb(LC, 'other', due1);
  await call('POST', '/api/line/webhook', evOther, null, { 'x-line-signature': sign(evOther) }); await wait(300);
  check('คนอื่นกดปุ่มรับทราบแทนไม่ได้ (ตัวตนมาจากบัญชีไลน์ที่กดจริง)', (await query('SELECT acknowledged_at FROM events WHERE id = $1', [due1])).rows[0].acknowledged_at === null);
  const evOwner = pb(LA, 'owner', due1);
  await call('POST', '/api/line/webhook', evOwner, null, { 'x-line-signature': sign(evOwner) }); await wait(300);
  check('เจ้าของกด "รับทราบแล้ว" ในไลน์ → บันทึกว่ารับทราบ', (await query('SELECT acknowledged_at FROM events WHERE id = $1', [due1])).rows[0].acknowledged_at !== null);
  const replies = sent.filter((m) => m.path === '/message/reply');
  check('ไลน์ตอบกลับยืนยันว่ารับทราบแล้ว', replies.some((m) => m.body.messages[0].text.includes('รับทราบแล้วค่ะ') && m.body.messages[0].text.includes('ประชุมด่วน')));
  const evAgain = pb(LA, 'again', due1);
  await call('POST', '/api/line/webhook', evAgain, null, { 'x-line-signature': sign(evAgain) }); await wait(300);
  check('กดซ้ำ → แจ้งว่ารับทราบไปแล้ว', sent.filter((m) => m.path === '/message/reply').some((m) => m.body.messages[0].text.includes('รับทราบไปแล้ว')));
  await query("UPDATE events SET remind_sent_at = now() - interval '31 minutes', remind_count = 1 WHERE id = $1", [due1]);
  const b2 = pushes().length; await run();
  check('รับทราบแล้ว → ไม่เตือนอีกเลย', pushes().length === b2);

  // ---------- คนที่ไม่มีไลน์: เห็นใน popup ของแอป ----------
  const dueB = (await query("INSERT INTO events (user_id, title, event_at, remind_at) VALUES ($1, 'นัดของบี', now() + interval '1 hour', now() - interval '2 minutes') RETURNING id", [B])).rows[0].id;
  const b3 = pushes().length; await run();
  check('ผู้ใช้ไม่มีไลน์ → ไม่ส่งไลน์ แต่ไม่ค้างส่งซ้ำ', pushes().length === b3 && (await query('SELECT remind_count FROM events WHERE id = $1', [dueB])).rows[0].remind_count >= 2);
  const dueList = await call('GET', '/api/calendar/due', null, cb);
  check('แอปดึงรายการที่ถึงเวลาเตือนแล้วได้ (ไว้เด้ง popup)', dueList.json.events.some((e) => e.id === dueB && e.due === true));
  check('รายการถึงเวลาของคนอื่นไม่ปนมา', !(await call('GET', '/api/calendar/due', null, cc)).json.events.some((e) => e.id === dueB));
  check('กดรับทราบในแอปได้', (await call('POST', `/api/calendar/${dueB}/ack`, null, cb)).status === 200 && !(await call('GET', '/api/calendar/due', null, cb)).json.events.some((e) => e.id === dueB));
  check('รับทราบซ้ำ → 404', (await call('POST', `/api/calendar/${dueB}/ack`, null, cb)).status === 404);

  // ---------- ไลน์ล่ม ----------
  const dueF = (await query("INSERT INTO events (user_id, title, event_at, remind_at) VALUES ($1, 'นัดตอนไลน์ล่ม', now() + interval '1 hour', now() - interval '1 minute') RETURNING id", [A])).rows[0].id;
  senderFails = true; await run();
  const f1 = (await query('SELECT fail_count, remind_count, remind_sent_at FROM events WHERE id = $1', [dueF])).rows[0];
  check('ไลน์ล่ม → นับความล้มเหลว ไม่ถือว่าส่งแล้ว (จะลองใหม่)', f1.fail_count === 1 && f1.remind_count === 0 && f1.remind_sent_at === null);
  senderFails = false; const b4 = pushes().length; await run();
  check('ไลน์กลับมา → ส่งสำเร็จ', pushes().length === b4 + 1);
  await query("UPDATE events SET fail_count = 5, remind_count = 0, remind_sent_at = NULL WHERE id = $1", [dueF]);
  const b5 = pushes().length; await run();
  check('ล้มเหลวครบ 5 ครั้ง → หยุดลอง', pushes().length === b5);

  // ---------- เลขาสร้างนัดผ่านเครื่องมือ ----------
  const toolsA = buildTools(A, null); const toolsB = buildTools(B, null);
  const made = await toolsA.create_event.run({ title: 'ประชุมโครงการ', date: dayKey(5), time: '14:30', note: 'นำเอกสาร', remind_minutes_before: 1440 });
  check('เลขาตั้งนัด: เตือนล่วงหน้า 1 วัน = วันก่อนหน้าเวลาเดียวกัน', made.ok && made.event.time === '14:30' && made.event.remindDate === dayKey(4) && made.event.remindTime === '14:30', JSON.stringify(made.event));
  check('เลขาตั้งนัดไม่ระบุเวลา → นัดทั้งวัน เตือน 08:00', (await toolsA.create_event.run({ title: 'ส่งรายงาน', date: dayKey(6) })).event.allDay === true);
  check('เลขาตั้งนัดผิดวันที่ → ปฏิเสธ (ไม่เดา)', await toolsA.create_event.run({ title: 'x', date: '2026-13-45' }).then(() => false, () => true));
  const listed = await toolsA.list_events.run({ from_date: dayKey(5), to_date: dayKey(6) });
  check('เลขาดูนัดตามช่วงวันที่ได้', listed.events.length === 2 && listed.events[0].title === 'ประชุมโครงการ');
  check('เลขาของคนอื่นไม่เห็นนัดนี้', (await toolsB.list_events.run({ from_date: dayKey(5), to_date: dayKey(6) })).events.length === 0);
  check('เลขาของคนอื่นลบนัดนี้ไม่ได้', await toolsB.delete_event.run({ event_id: made.event.id }).then(() => false, () => true));
  check('event_id มั่ว → ปฏิเสธ', await toolsA.delete_event.run({ event_id: 'abc' }).then(() => false, () => true));
  check('เลขาลบนัดของตัวเองได้', (await toolsA.delete_event.run({ event_id: made.event.id })).deleted === 'ประชุมโครงการ');

  // ผ่านแชทจริง: โมเดลสั่ง create_event → ได้ createdEvents กลับไปให้หน้าจอ
  let step = 0;
  ai.setCallModelForTests(async () => (step++ === 0
    ? { parts: [{ functionCall: { name: 'create_event', args: { title: 'นัดจากแชท', date: dayKey(7), time: '09:00' } } }], usage: {} }
    : { parts: [{ text: 'ตั้งนัดให้แล้วค่ะ' }], usage: {} }));
  const conv = (await call('POST', '/api/chat/conversations', {}, ca)).json.conversation.id;
  const chat = await call('POST', `/api/chat/conversations/${conv}/messages`, { content: 'ช่วยตั้งนัดให้หน่อย' }, ca);
  check('แชทกับเลขา: ตั้งนัดสำเร็จ และส่ง createdEvents กลับให้หน้าจอแสดงชิป', chat.status === 200 && chat.json.createdEvents.length === 1 && chat.json.createdEvents[0].title === 'นัดจากแชท');
  check('นัดที่เลขาสร้างบันทึกว่าสร้างผ่านเลขา', (await query("SELECT created_via FROM events WHERE user_id = $1 AND title = 'นัดจากแชท'", [A])).rows[0].created_via === 'secretary');

  // ---------- อื่นๆ ----------
  check('ลบนัดของตัวเองได้', (await call('DELETE', `/api/calendar/${e2.json.event.id}`, null, ca)).status === 200);
  check('เลขารู้วัน-เวลาปัจจุบัน (ใส่ในคำสั่งระบบ)', buildSystemPrompt({ secretaryName: 'เลขา', userName: 'x', nowText: cal.nowText() }).includes('create_event') && cal.nowText().includes('ค.ศ.'));
  check('แปลงวันเป็นภาษาไทยถูกต้อง', cal.fmtThai(new Date('2026-11-25T03:00:00Z'), false) === '25 พฤศจิกายน 2569 เวลา 10:00 น.' && cal.fmtThai(new Date('2026-11-25T03:00:00Z'), true) === '25 พฤศจิกายน 2569');
  const longTxt = buildText({ title: 'ย'.repeat(200), note: 'น'.repeat(400), event_at: new Date(), all_day: false });
  check('ข้อความแจ้งเตือนที่ยาวมาก ถูกตัดให้ไม่เกิน 160 ตัวอักษร', longTxt.length <= 160);

  server.close();
  await cleanup();
  const left = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const leftEv = (await query('SELECT count(*)::int AS n FROM events WHERE user_id = ANY($1)', [IDS])).rows[0].n;
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (รวมนัดที่ผูกกับผู้ใช้ทดสอบ)', left === baseUsers && leftEv === 0, `ผู้ใช้ก่อน ${baseUsers} หลัง ${left}`);
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error('ทดสอบพังกลางทาง:', e); try { await cleanup(); } catch { /* ignore */ } process.exit(1); });
