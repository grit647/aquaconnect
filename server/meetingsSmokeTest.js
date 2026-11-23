// ทดสอบ "สัมมนา / ประชุมออนไลน์": สร้างห้อง ลิงก์สาธารณะ (ไม่ต้องล็อกอิน) จำกัดจำนวน/วัน จบห้อง หมดอายุ และไม่ให้คนอื่นยุ่งกับห้องของเรา
//   node server/meetingsSmokeTest.js   (ไม่เรียก AI ไม่เสียเงิน • ผู้ใช้ทดสอบ 09999 ลบทิ้งหมดตอนจบ)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake';

const app = require('./index');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900041', '0999900042'];

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0], type: r.headers.get('content-type') || '' };
}

(async () => {
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const A = await call('POST', '/api/auth/register', { name: 'ทดสอบ ผู้จัด', phone: PHONES[0], pin: '111222' });
  const B = await call('POST', '/api/auth/register', { name: 'ทดสอบ คนอื่น', phone: PHONES[1], pin: '333444' });
  check('สมัครผู้ใช้ทดสอบ 2 คน', A.status === 200 && B.status === 200);

  check('ยังไม่ล็อกอิน สร้างห้องไม่ได้', (await call('POST', '/api/meetings', { title: 'x' })).status === 401);
  check('ไม่ตั้งชื่อห้อง → ไม่ให้สร้าง', (await call('POST', '/api/meetings', { title: '   ' }, A.cookie)).status === 400);
  check('ชื่อห้องยาวเกิน 80 ตัว → ไม่ให้สร้าง', (await call('POST', '/api/meetings', { title: 'ก'.repeat(81) }, A.cookie)).status === 400);

  const c1 = await call('POST', '/api/meetings', { title: 'คุยเรื่องอาหารกุ้ง', type: 'seminar' }, A.cookie);
  const m1 = c1.json.meeting || {};
  check('สร้างห้องสัมมนาได้ ได้รหัส 12 ตัว a-z0-9', c1.status === 200 && /^[a-z0-9]{12}$/.test(m1.code) && m1.type === 'seminar' && m1.typeLabel === 'สัมมนา', JSON.stringify(m1));
  const c2 = await call('POST', '/api/meetings', { title: 'ประชุมทั่วไป', type: 'อะไรก็ไม่รู้' }, A.cookie);
  check('ประเภทแปลกๆ → ใช้ "ประชุม" เป็นค่าเริ่มต้น', c2.status === 200 && c2.json.meeting.type === 'meeting');
  check('รหัสห้องสองห้องไม่ซ้ำกัน', m1.code !== c2.json.meeting.code);

  // หน้าสาธารณะ: ไม่ล็อกอินก็เปิดได้ และไม่เผยข้อมูลส่วนตัวของผู้จัด
  const pub = await call('GET', '/api/meetings/public/' + m1.code);
  check('คนไม่ล็อกอินเปิดข้อมูลห้องจากลิงก์ได้', pub.status === 200 && pub.json.meeting.title === 'คุยเรื่องอาหารกุ้ง' && pub.json.me === null && pub.json.meeting.isHost === false, JSON.stringify(pub.json));
  const raw = JSON.stringify(pub.json);
  check('ข้อมูลสาธารณะไม่มีเบอร์โทร/ไอดีผู้จัด', !raw.includes(PHONES[0]) && !/host_?id/i.test(raw) && pub.json.meeting.hostName === 'ทดสอบ ผู้จัด');
  check('ชื่อห้องที่ส่งให้ Jitsi สุ่ม ไม่เอาชื่อที่ผู้ใช้ตั้งไปใช้', pub.json.meeting.room === 'aquaconnect-' + m1.code && !pub.json.meeting.room.includes('กุ้ง'));
  const pubHost = await call('GET', '/api/meetings/public/' + m1.code, null, A.cookie);
  check('ผู้จัดล็อกอินเปิดลิงก์ → รู้ว่าเป็นผู้จัด', pubHost.json.meeting.isHost === true && pubHost.json.me.name === 'ทดสอบ ผู้จัด');
  const pubOther = await call('GET', '/api/meetings/public/' + m1.code, null, B.cookie);
  check('สมาชิกคนอื่นล็อกอินเปิดลิงก์ → ไม่ใช่ผู้จัด', pubOther.json.meeting.isHost === false && pubOther.json.me.name === 'ทดสอบ คนอื่น');
  check('รหัสมั่ว/ไม่มีอยู่จริง → 404', (await call('GET', '/api/meetings/public/zzzzzzzzzzzz')).status === 404 && (await call('GET', '/api/meetings/public/abc')).status === 404);
  const page = await fetch(BASE + '/meet/' + m1.code);
  const html = await page.text();
  check('หน้า /meet/<รหัส> เสิร์ฟหน้าห้องประชุม (ไม่ใช่หน้าแอป)', page.status === 200 && html.includes('ห้องประชุมออนไลน์') && html.includes('meet.jit.si'));

  // ห้องของฉัน + จบห้อง (เฉพาะเจ้าของ)
  const mine = await call('GET', '/api/meetings', null, A.cookie);
  check('รายการ "ห้องของฉัน" มี 2 ห้อง', mine.json.meetings.length === 2);
  check('คนอื่นไม่เห็นห้องของเรา', (await call('GET', '/api/meetings', null, B.cookie)).json.meetings.length === 0);
  check('คนอื่นจบห้องของเราไม่ได้', (await call('POST', '/api/meetings/' + m1.id + '/end', {}, B.cookie)).status === 400);
  check('เจ้าของจบห้องได้', (await call('POST', '/api/meetings/' + m1.id + '/end', {}, A.cookie)).status === 200);
  const ended = await call('GET', '/api/meetings/public/' + m1.code);
  check('จบห้องแล้ว ลิงก์ขึ้นสถานะ "ปิดแล้ว"', ended.json.meeting.ended === true);
  check('ห้องที่จบแล้วไม่อยู่ในรายการของฉัน', (await call('GET', '/api/meetings', null, A.cookie)).json.meetings.length === 1);

  // ลิงก์หมดอายุ
  await query("UPDATE meetings SET expires_at = now() - interval '1 minute' WHERE code = $1", [c2.json.meeting.code]);
  check('ลิงก์หมดอายุ → ขึ้นสถานะ "ปิดแล้ว" และไม่อยู่ในรายการ', (await call('GET', '/api/meetings/public/' + c2.json.meeting.code)).json.meeting.ended === true && (await call('GET', '/api/meetings', null, A.cookie)).json.meetings.length === 0);

  // เพดานจำนวนห้องต่อวัน
  await query("INSERT INTO app_settings (key, value, note) VALUES ('meetings_per_day', '3', 'test') ON CONFLICT (key) DO UPDATE SET value = '3'");
  const c3 = await call('POST', '/api/meetings', { title: 'ห้อง 3' }, A.cookie);
  const c4 = await call('POST', '/api/meetings', { title: 'ห้อง 4' }, A.cookie);
  check('สร้างห้องเกินเพดานต่อวัน → ปฏิเสธพร้อมบอกเหตุผล', c3.status === 200 && c4.status === 400 && /ครบ 3 ห้อง/.test(c4.json.error), JSON.stringify(c4.json));
  await query("UPDATE app_settings SET value = '5' WHERE key = 'meetings_per_day'");

  // ลบผู้ใช้ → ห้องหายตาม (ไม่ค้างขยะ)
  const del = await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const left = (await query("SELECT count(*)::int AS n FROM meetings WHERE title IN ('คุยเรื่องอาหารกุ้ง','ประชุมทั่วไป','ห้อง 3')")).rows[0].n;
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (ห้องหายตามผู้จัด)', del.rowCount === 2 && left === 0, `users ${del.rowCount} meetings ${left}`);

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]); } catch { /* ignore */ }
  process.exit(1);
});
