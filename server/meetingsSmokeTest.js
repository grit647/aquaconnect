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

  // ---------- JaaS: ผู้จัดเป็น moderator ด้วยโทเค็นเซ็นฝั่งเซิร์ฟเวอร์ (ไม่ต้องล็อกอิน Jitsi) ----------
  const nojaas = await call('GET', '/api/meetings/public/' + c3.json.meeting.code, null, A.cookie);
  check('ยังไม่ตั้งค่า JaaS → ไม่มีข้อมูล jaas (ถอยไปใช้ meet.jit.si)', nojaas.status === 200 && !nojaas.json.meeting.jaas);
  const crypto = require('crypto'); const jwtLib = require('jsonwebtoken');
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  process.env.JAAS_APP_ID = 'vpaas-magic-cookie-testapp'; process.env.JAAS_KEY_ID = 'abc123'; process.env.JAAS_PRIVATE_KEY = kp.privateKey.split(String.fromCharCode(10)).join(String.fromCharCode(92) + 'n');   // จำลอง Environment ที่เก็บขึ้นบรรทัดใหม่เป็นตัวอักษร backslash-n

  const withJaas = await call('GET', '/api/meetings/public/' + c3.json.meeting.code, null, A.cookie);
  const jj = (withJaas.json.meeting || {}).jaas || {};
  let claims = null; try { claims = jwtLib.verify(jj.jwt, kp.publicKey, { algorithms: ['RS256'], complete: true }); } catch (e) { claims = { err: e.message }; }
  check('ตั้งค่า JaaS แล้ว ผู้จัดได้โทเค็น RS256 ที่ตรวจด้วยกุญแจสาธารณะผ่าน + kid ถูกรูปแบบ <AppID>/<keyId>', claims && claims.header && claims.header.kid === 'vpaas-magic-cookie-testapp/abc123' && claims.header.alg === 'RS256', JSON.stringify(claims && (claims.header || claims)));
  const pl = (claims && claims.payload) || {};
  check('โทเค็นผู้จัด: aud/iss/sub ถูก, ผูกกับห้องนี้ห้องเดียว, เป็น moderator, อายุไม่เกิน 3 ชม., ใช้ชื่อบัญชี', pl.aud === 'jitsi' && pl.iss === 'chat' && pl.sub === 'vpaas-magic-cookie-testapp' && pl.room === c3.json.meeting.code && pl.context.user.moderator === 'true' && pl.exp - pl.nbf <= 3 * 3600 + 20 && pl.context.user.name === 'ทดสอบ ผู้จัด', JSON.stringify(pl));
  const guestJ = await call('GET', '/api/meetings/public/' + c3.json.meeting.code);
  const otherJ = await call('GET', '/api/meetings/public/' + c3.json.meeting.code, null, B.cookie);
  check('คนไม่ล็อกอิน/สมาชิกคนอื่น ไม่ได้โทเค็น moderator (ได้แค่ appId + room)', guestJ.json.meeting.jaas && !guestJ.json.meeting.jaas.jwt && otherJ.json.meeting.jaas && !otherJ.json.meeting.jaas.jwt && !JSON.stringify(guestJ.json).includes('PRIVATE KEY'));
  await call('POST', '/api/meetings/' + c3.json.meeting.id + '/end', {}, A.cookie);
  check('ห้องที่จบแล้ว ไม่ออกโทเค็นผู้จัด', !((await call('GET', '/api/meetings/public/' + c3.json.meeting.code, null, A.cookie)).json.meeting.jaas));
  process.env.JAAS_PRIVATE_KEY = 'ไม่ใช่กุญแจ';
  check('ค่ากุญแจไม่ถูกรูปแบบ → ถือว่ายังไม่ตั้งค่า (ไม่พังหน้าห้อง)', !((await call('GET', '/api/meetings/public/' + m1.code)).json.meeting || {}).jaas);
  // วางกุญแจเพี้ยนใน Environment หลายแบบ → ยังใช้ได้ (ดึงเนื้อ base64 มาประกอบ PEM ใหม่) และตรวจลายเซ็นผ่านเหมือนเดิม
  const jaasLib = require('./jaas');
  const NL = String.fromCharCode(10);
  const bodyOnly = kp.privateKey.split(NL).filter((l) => l && !l.startsWith('-----')).join('');
  const variants = {
    'ยุบบรรทัดเป็นช่องว่าง': kp.privateKey.split(NL).join(' '),
    'ครอบด้วยเครื่องหมายคำพูด': '"' + kp.privateKey.split(NL).join(String.fromCharCode(92) + 'n') + '"',
    'วางแต่เนื้อ ไม่มีบรรทัด BEGIN/END': bodyOnly,
  };
  for (const [label, val] of Object.entries(variants)) {
    process.env.JAAS_APP_ID = 'vpaas-magic-cookie-testapp'; process.env.JAAS_KEY_ID = 'abc123'; process.env.JAAS_PRIVATE_KEY = val;
    let ok = false; try { jwtLib.verify(jaasLib.hostToken({ room: 'r', userId: 'u', name: 'n' }), kp.publicKey, { algorithms: ['RS256'] }); ok = jaasLib.status().ready === true; } catch (e) { ok = false; }
    check('กุญแจใน Environment แบบ "' + label + '" → ยังใช้เซ็นโทเค็นได้', ok);
  }
  process.env.JAAS_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----' + NL + 'MIIEvQIBADAN';
  check('กุญแจวางไม่ครบ (ขาดท่อนหลัง) → สถานะ bad-format พร้อมจำนวนตัวอักษรที่อ่านได้ ไม่เผยเนื้อกุญแจ', jaasLib.status().privateKey === 'bad-format' && jaasLib.status().keyChars < 400 && !JSON.stringify(jaasLib.status()).includes('MIIE'));
  delete process.env.JAAS_APP_ID; delete process.env.JAAS_KEY_ID; delete process.env.JAAS_PRIVATE_KEY;

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
