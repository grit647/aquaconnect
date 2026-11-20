// ทดสอบหลังบ้านแอดมิน: node server/adminSmokeTest.js (ผู้ใช้ทดสอบเบอร์ 09999000.. ลบทิ้งเมื่อจบ ค่าตั้งระบบถูกคืนค่าเดิม)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const app = require('./index');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const PHONES = ['0999900031', '0999900032'];
const cleanup = async () => {
  const ids = 'SELECT id FROM users WHERE phone = ANY($1)';
  await query(`DELETE FROM credit_ledger WHERE user_id IN (${ids})`, [PHONES]);
  await query(`DELETE FROM topups WHERE user_id IN (${ids}) OR reviewed_by IN (${ids})`, [PHONES]);
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
};

(async () => {
  const baseUsers = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const oldSetting = (await query("SELECT value FROM app_settings WHERE key = 'commission_rate'")).rows[0];

  const a = await call('POST', '/api/auth/register', { name: 'แอดมิน ทดสอบ', phone: PHONES[0], pin: '111111' });
  const u = await call('POST', '/api/auth/register', { name: 'ผู้ใช้ ทดสอบ', phone: PHONES[1], pin: '222222' });
  await query('UPDATE users SET is_admin = true WHERE phone = $1', [PHONES[0]]);

  check('ไม่ล็อกอิน → 401', (await call('GET', '/api/admin/overview')).status === 401);
  check('ผู้ใช้ทั่วไป → 403', (await call('GET', '/api/admin/overview', null, u.cookie)).status === 403);
  check('ผู้ใช้ทั่วไปแก้ค่าตั้งไม่ได้', (await call('PATCH', '/api/admin/settings/commission_rate', { value: 15 }, u.cookie)).status === 403);

  const ov = await call('GET', '/api/admin/overview', null, a.cookie);
  check('แอดมินดูภาพรวมได้', ov.status === 200 && ov.json.users.total >= 2 && ov.json.messagesPerDay.length === 7);
  const us = await call('GET', '/api/admin/users', null, a.cookie);
  check('รายชื่อผู้ใช้ไม่มี pin_hash หลุดออกมา', us.status === 200 && !JSON.stringify(us.json).includes('pin_hash') && !JSON.stringify(us.json).includes('$2'));

  const target = us.json.users.find((x) => x.phone === PHONES[1]);
  check('ระงับผู้ใช้ได้', (await call('PATCH', `/api/admin/users/${target.id}/status`, { status: 'suspended' }, a.cookie)).status === 200);
  check('ผู้ใช้ที่ถูกระงับ login ไม่ได้', (await call('POST', '/api/auth/login', { phone: PHONES[1], pin: '222222' })).status >= 400);
  check('เปิดใช้งานคืนได้', (await call('PATCH', `/api/admin/users/${target.id}/status`, { status: 'active' }, a.cookie)).status === 200);
  const self = us.json.users.find((x) => x.phone === PHONES[0]);
  check('ระงับตัวเองไม่ได้', (await call('PATCH', `/api/admin/users/${self.id}/status`, { status: 'suspended' }, a.cookie)).status === 400);
  check('สถานะมั่ว → 400', (await call('PATCH', `/api/admin/users/${target.id}/status`, { status: 'x' }, a.cookie)).status === 400);

  check('ตั้งส่วนแบ่งในช่วง 10-30 ได้', (await call('PATCH', '/api/admin/settings/commission_rate', { value: 25 }, a.cookie)).status === 200);
  check('ตั้งส่วนแบ่งนอกช่วง → 400', (await call('PATCH', '/api/admin/settings/commission_rate', { value: 90 }, a.cookie)).status === 400);
  check('ค่าตั้งที่ไม่อนุญาต → 404', (await call('PATCH', '/api/admin/settings/withdraw_enabled', { value: 1 }, a.cookie)).status === 404);
  const st = await call('GET', '/api/admin/settings', null, a.cookie);
  check('อ่านค่าตั้งได้และเห็นค่าใหม่', st.json.settings.find((s) => s.key === 'commission_rate').value === 25);

  // ---------- เครดิตรายคน (ปุ่มเข้าดูเครดิตในหลังบ้าน) ----------
  const uid = target.id;
  await query("UPDATE users SET line_picture_url = 'https://profile.line-scdn.net/0hAdminTestPic/preview' WHERE id = $1", [uid]);
  const us2 = await call('GET', '/api/admin/users', null, a.cookie);
  const row0 = us2.json.users.find((x) => x.id === uid);
  check('ผู้ใช้ที่ยังไม่เคยเติมเครดิต: ไม่มีรายการเครดิต (หน้าจอจะไม่แสดงปุ่มดูเครดิต)', row0.topup_count === 0 && row0.ledger_count === 0 && row0.balance === 0);
  check('รายชื่อผู้ใช้ส่งรูปโปรไฟล์ไลน์มาด้วย', row0.picture === 'https://profile.line-scdn.net/0hAdminTestPic/preview');
  await query("INSERT INTO credit_balances (user_id, balance) VALUES ($1, 70) ON CONFLICT (user_id) DO UPDATE SET balance = 70", [uid]);
  await query("INSERT INTO topups (user_id, amount_claimed, status, approved_amount, reviewed_by, reviewed_at) VALUES ($1, 100, 'approved', 100, $2, now())", [uid, self.id]);
  await query("INSERT INTO credit_ledger (user_id, amount, type, note, balance_after) VALUES ($1, 100, 'topup', 'เติมเครดิต', 100), ($1, -30, 'spend', 'ถามเลขาหมวดเสียเงิน', 70)", [uid]);
  const us3 = await call('GET', '/api/admin/users', null, a.cookie);
  const row1 = us3.json.users.find((x) => x.id === uid);
  check('มีการเติมเครดิต → รายชื่อบอกจำนวนรายการและยอดคงเหลือ (หน้าจอแสดงปุ่มดูเครดิต)', row1.topup_count === 1 && row1.ledger_count === 2 && row1.balance === 70);
  const cr = await call('GET', `/api/admin/users/${uid}/credits`, null, a.cookie);
  check('แอดมินดูเครดิตรายคนได้: ยอดคงเหลือ + ยอดสะสมเติม/ใช้', cr.status === 200 && cr.json.balance === 70 && cr.json.totals.topup === 100 && cr.json.totals.spent === 30 && cr.json.totals.earned === 0);
  check('ดูเครดิตรายคน: มีสมุดบัญชีและรายการเติมเงิน', cr.json.ledger.length === 2 && cr.json.topups.length === 1 && cr.json.topups[0].status === 'approved' && cr.json.topups[0].approved_amount === 100);
  check('ดูเครดิตรายคน: ไม่มีข้อมูลสลิป/รหัสผ่านหลุด', !JSON.stringify(cr.json).includes('slip_data') && !JSON.stringify(cr.json).includes('pin_hash'));
  check('ผู้ใช้ทั่วไปดูเครดิตของคนอื่นไม่ได้', (await call('GET', `/api/admin/users/${uid}/credits`, null, u.cookie)).status === 403);
  check('ไม่ล็อกอินดูไม่ได้', (await call('GET', `/api/admin/users/${uid}/credits`)).status === 401);
  check('id มั่ว → 404', (await call('GET', '/api/admin/users/not-a-uuid/credits', null, a.cookie)).status === 404);

  // คืนค่าเดิม + เก็บกวาด
  if (oldSetting) await query("UPDATE app_settings SET value = $1::jsonb WHERE key = 'commission_rate'", [JSON.stringify(oldSetting.value)]);
  await cleanup();
  const left = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  check('ลบข้อมูลทดสอบหมดเกลี้ยง', left === baseUsers, `ก่อน ${baseUsers} หลัง ${left}`);
  server.close(); await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error('ทดสอบพังกลางทาง:', e); try { await cleanup(); } catch { /* ignore */ } process.exit(1); });
