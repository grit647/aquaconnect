// ทดสอบระบบเครดิต: เติมเงิน (สลิป/อนุมัติ/ปฏิเสธ/สลิปซ้ำ), หักเงินตอนถามหมวดเสียเงิน, ส่วนแบ่ง, คืนเงินเมื่อ AI พัง, เส้นทาง HTTP
//   node server/creditsSmokeTest.js
// ใช้ผู้ใช้ทดสอบเบอร์ 09999000.. แล้วลบทิ้งเมื่อจบ (รวมสมุดบัญชี/คำขอเติม/รอบถามของพวกเขา) • ไม่เรียก AI จริง ไม่ส่งไลน์จริง
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'test-token';   // ให้ line.isConfigured() เป็นจริง (ตัวส่งเป็นตัวจำลอง ไม่ยิงจริง)
const crypto = require('crypto');
const app = require('./index');
const ai = require('./ai');
const line = require('./line');
const memory = require('./memory');
const sharing = require('./sharing');
const credits = require('./credits');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const sent = [];
line.setSenderForTests(async (path, body) => { sent.push({ path, body }); });
let modelFails = false;
ai.setCallModelForTests(async () => { if (modelFails) throw new Error('boom'); return { parts: [{ text: 'ตอบจำลอง' }], usage: {} }; });
ai.setReadSlipForTests(async () => 100);

const PHONES = ['0999900051', '0999900052', '0999900053'];
const slip = () => crypto.randomBytes(300).toString('base64');   // สลิปจำลอง (ข้อมูลสุ่มไม่ซ้ำกัน)

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  let json = {}; if (type.includes('json')) { try { json = await r.json(); } catch { /* ไม่มี body */ } } else { await r.arrayBuffer(); }
  return { status: r.status, type, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

async function cleanup() {
  const ids = 'SELECT id FROM users WHERE phone = ANY($1)';
  await query(`DELETE FROM credit_ledger WHERE user_id IN (${ids})`, [PHONES]);
  await query(`DELETE FROM topups WHERE user_id IN (${ids}) OR reviewed_by IN (${ids})`, [PHONES]);
  await query(`DELETE FROM access_sessions WHERE requester_id IN (${ids}) OR owner_id IN (${ids})`, [PHONES]);
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
}
async function sumLedger(uid) { return Number((await query('SELECT COALESCE(sum(amount), 0) AS s FROM credit_ledger WHERE user_id = $1', [uid])).rows[0].s); }
async function setSetting(key, v) { await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(v)]); }

(async () => {
  await cleanup();                                                     // เผื่อค้างจากรอบที่พังกลางทาง
  const adminLineIds = (await query("SELECT line_user_id FROM users WHERE is_admin = true AND status = 'active' AND line_user_id IS NOT NULL AND phone <> ALL($1)", [PHONES])).rows.map((r) => r.line_user_id);
  const baseUsers = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const oldSettings = {};
  for (const k of ['commission_rate', 'idle_timeout_min']) oldSettings[k] = (await query('SELECT value FROM app_settings WHERE key = $1', [k])).rows[0];
  await setSetting('commission_rate', 20);
  await setSetting('idle_timeout_min', 5);

  const mk = async (name, phone) => (await query("INSERT INTO users (phone, pin_hash, name) VALUES ($1, 'x', $2) RETURNING id", [phone, name])).rows[0].id;
  const owner = await mk('เจ้าของ เครดิต', PHONES[0]);
  const asker = await mk('ผู้ถาม เครดิต', PHONES[1]);
  const admin = await mk('แอดมิน เครดิต', PHONES[2]);
  await query("UPDATE users SET is_admin = true, line_user_id = 'Utest-credits-admin' WHERE id = $1", [admin]);

  // ---------- เติมเงิน ----------
  check('เติมต่ำกว่าขั้นต่ำ → ปฏิเสธ', !!(await rejects(() => credits.createTopup(asker, 1, slip(), 'image/jpeg'))));
  check('ไม่แนบสลิป → ปฏิเสธ', !!(await rejects(() => credits.createTopup(asker, 100, '', 'image/jpeg'))));
  check('ชนิดไฟล์ไม่ใช่รูป → ปฏิเสธ', !!(await rejects(() => credits.createTopup(asker, 100, slip(), 'text/html'))));
  check('สลิปใหญ่เกินเพดาน → ปฏิเสธ', !!(await rejects(() => credits.createTopup(asker, 100, 'A'.repeat(2 * 1024 * 1024 + 10), 'image/jpeg'))));

  const s1 = slip();
  const t1 = await credits.createTopup(asker, 100, s1, 'image/jpeg');
  check('ส่งสลิปได้ + AI อ่านยอดมาด้วย', !!t1.topupId && t1.slipAmountRead === 100);
  check('แอดมินที่ผูกไลน์ได้รับแจ้งเตือนสลิปใหม่ (รวมแอดมินจริงทุกคน — ตัวส่งเป็นตัวจำลอง ไม่ยิงจริง)', sent.length === adminLineIds.length + 1 && sent.some((m) => m.body.to === 'Utest-credits-admin' && m.body.messages[0].text.includes('100')));
  check('สลิปใบเดิมส่งซ้ำไม่ได้', !!(await rejects(() => credits.createTopup(asker, 100, s1, 'image/jpeg'))));
  check('ยังไม่อนุมัติ → ยอดยังเป็น 0', (await credits.getBalance(asker)) === 0);

  const t2 = await credits.createTopup(asker, 50, slip(), 'image/jpeg');
  const t3 = await credits.createTopup(asker, 50, slip(), 'image/jpeg');
  check('ค้างรอตรวจครบ 3 รายการ → ส่งเพิ่มไม่ได้', !!(await rejects(() => credits.createTopup(asker, 50, slip(), 'image/jpeg'))));

  const ap = await credits.approveTopup(admin, t1.topupId, 100);
  check('อนุมัติ → เครดิตเข้า 100', ap.amount === 100 && (await credits.getBalance(asker)) === 100);
  check('อนุมัติซ้ำไม่ได้ (ไม่เครดิตซ้ำ)', !!(await rejects(() => credits.approveTopup(admin, t1.topupId, 100))) && (await credits.getBalance(asker)) === 100);
  check('แอดมินแก้ยอดตอนอนุมัติได้ (สลิปจริง 40 ไม่ใช่ 50)', (await credits.approveTopup(admin, t2.topupId, 40)).amount === 40 && (await credits.getBalance(asker)) === 140);
  await credits.rejectTopup(admin, t3.topupId, 'สลิปไม่ตรง');
  check('ปฏิเสธ → ยอดไม่เปลี่ยน', (await credits.getBalance(asker)) === 140);
  check('ปฏิเสธไปแล้วอนุมัติไม่ได้', !!(await rejects(() => credits.approveTopup(admin, t3.topupId, 50))));
  check('ยอดอนุมัติเกินเพดานต่อครั้ง → ปฏิเสธ', !!(await rejects(async () => { const t = await credits.createTopup(asker, 50, slip(), 'image/jpeg'); await credits.approveTopup(admin, t.topupId, 99999999); })));

  // ---------- เส้นทาง HTTP ----------
  const login = async (id) => { const jwt = require('jsonwebtoken'); const secret = process.env.JWT_SECRET || 'dev-secret-change-me'; const u = (await query('SELECT * FROM users WHERE id = $1', [id])).rows[0]; return 'aq_token=' + jwt.sign({ id: u.id, phone: u.phone, name: u.name, isAdmin: !!u.is_admin }, secret, { expiresIn: '5m' }); };
  const askerCookie = await login(asker); const adminCookie = await login(admin);
  check('ดูเครดิตโดยไม่ล็อกอิน → 401', (await call('GET', '/api/credits/me')).status === 401);
  const me = await call('GET', '/api/credits/me', null, askerCookie);
  check('ดูยอดของฉันได้', me.status === 200 && me.json.balance === 140 && me.json.ledger.length >= 2);
  const qr = await call('GET', '/api/credits/payment-qr', null, askerCookie);
  check('ผู้ล็อกอินดูรูป QR ได้ (เป็นรูป)', qr.status === 200 && qr.type.startsWith('image/'));
  check('ไม่ล็อกอินดู QR ไม่ได้', (await call('GET', '/api/credits/payment-qr')).status === 401);
  const bigSlip = 'A'.repeat(1500000);
  check('ส่งสลิปผ่าน HTTP (ขนาด ~1.1MB ไม่ติดเพดาน body) ', (await call('POST', '/api/credits/topups', { amount: 60, slip: Buffer.from(bigSlip).toString('base64').slice(0, 1500000), mimeType: 'image/png' }, askerCookie)).status === 200);
  const q = await call('GET', '/api/admin/topups?status=pending', null, adminCookie);
  const mine = q.json.topups && q.json.topups.find((x) => x.user_name === 'ผู้ถาม เครดิต');
  check('แอดมินเห็นคิวรอตรวจ + ยอดที่ AI อ่าน', q.status === 200 && !!mine && mine.slip_amount_read === 100);
  check('ผู้ใช้ทั่วไปดูคิวของแอดมินไม่ได้', (await call('GET', '/api/admin/topups', null, askerCookie)).status === 403);
  check('แอดมินเปิดรูปสลิปได้', (await call('GET', `/api/admin/topups/${mine.id}/slip`, null, adminCookie)).type.startsWith('image/'));
  check('ผู้ใช้ทั่วไปอนุมัติเองไม่ได้', (await call('POST', `/api/admin/topups/${mine.id}/approve`, { amount: 60 }, askerCookie)).status === 403);
  check('แอดมินอนุมัติผ่าน HTTP ได้ (ยอด 140→200)', (await call('POST', `/api/admin/topups/${mine.id}/approve`, { amount: 60 }, adminCookie)).status === 200 && (await credits.getBalance(asker)) === 200);
  check('ผู้ใช้เปลี่ยน QR ไม่ได้', (await call('PUT', '/api/admin/payment-qr', { mimeType: 'image/png', data: 'AAAA' }, askerCookie)).status === 403);

  // ---------- ถามหมวดเสียเงิน (ต่อคำถาม) ----------
  await memory.saveMemory(owner, 'วิชาการ', 'ข้อมูลทดสอบ');
  await sharing.setCategoryVisibility(owner, 'วิชาการ', 'paid', 'question', 10);
  const rq = await sharing.requestAccess(asker, owner, 'วิชาการ');
  await sharing.decideRequest(owner, rq.requestId, 'approve');

  const r1 = await sharing.askSharedCategory(asker, rq.requestId, 'คำถามที่ 1');
  check('ถามต่อคำถาม: หัก 10 เหลือ 190', r1.creditsCharged === 10 && near(await credits.getBalance(asker), 190));
  check('เจ้าของได้ 8 (หักส่วนแบ่ง 20%)', near(await credits.getBalance(owner), 8));
  const sess = (await query('SELECT credits_charged, platform_fee, owner_earned, ask_count, commission_rate FROM access_sessions WHERE requester_id = $1', [asker])).rows[0];
  check('บันทึกรอบ: หัก 10 / แพลตฟอร์ม 2 / เจ้าของ 8', near(sess.credits_charged, 10) && near(sess.platform_fee, 2) && near(sess.owner_earned, 8) && sess.ask_count === 1 && near(sess.commission_rate, 20));
  await setSetting('commission_rate', 30);
  await sharing.askSharedCategory(asker, rq.requestId, 'คำถามที่ 2');
  check('เปลี่ยนส่วนแบ่งกลางรอบ → รอบเดิมใช้อัตราตอนเปิดรอบ (20%) ไม่เพี้ยน', near(await credits.getBalance(owner), 16));
  await setSetting('commission_rate', 20);

  // เครดิตไม่พอ = ไม่หักอะไร
  await query('UPDATE credit_balances SET balance = 5 WHERE user_id = $1', [asker]);
  await query("INSERT INTO credit_ledger (user_id, amount, type, note, balance_after) VALUES ($1, -175, 'adjust', 'ปรับยอดทดสอบ', 5)", [asker]);
  const before = await credits.getBalance(asker);
  const poorMsg = await rejects(() => sharing.askSharedCategory(asker, rq.requestId, 'คำถามที่ 3'));
  check('เครดิตไม่พอ (มี 5 ต้อง 10) → ถามไม่ได้ ไม่หักอะไร', !!poorMsg && poorMsg.includes('เครดิตไม่พอ') && near(await credits.getBalance(asker), before));
  const cnt = (await query('SELECT sum(ask_count)::int AS n FROM access_sessions WHERE requester_id = $1', [asker])).rows[0].n;
  check('ถามไม่สำเร็จ → ไม่นับเป็นครั้งที่ถาม', cnt === 2);

  // AI พังหลังหักเงิน → คืนเงินครบ
  await query('UPDATE credit_balances SET balance = 100 WHERE user_id = $1', [asker]);
  await query("INSERT INTO credit_ledger (user_id, amount, type, note, balance_after) VALUES ($1, 95, 'adjust', 'ปรับยอดทดสอบ', 100)", [asker]);
  const ownerBefore = await credits.getBalance(owner);
  modelFails = true;
  const boom = await rejects(() => sharing.askSharedCategory(asker, rq.requestId, 'คำถามที่ 4'));
  modelFails = false;
  check('AI พัง → ได้ error', boom === 'boom');
  check('AI พัง → คืนเครดิตผู้ถามครบ และดึงรายได้เจ้าของกลับ', near(await credits.getBalance(asker), 100) && near(await credits.getBalance(owner), ownerBefore));

  // ---------- ถามหมวดเสียเงิน (ต่อชั่วโมง) ----------
  await sharing.setCategoryVisibility(owner, 'วิชาการ', 'paid', 'hour', 60);
  await query("UPDATE access_sessions SET ended_at = now() WHERE requester_id = $1", [asker]);   // ปิดรอบเก่า ให้เริ่มรอบใหม่
  const b0 = await credits.getBalance(asker);
  await sharing.askSharedCategory(asker, rq.requestId, 'ชั่วโมงที่ 1');
  check('ต่อชั่วโมง 60/ชม.: ถามครั้งแรกจ่ายก้อนแรก 5 นาที = 5 เครดิต', near(await credits.getBalance(asker), b0 - 5));
  await sharing.askSharedCategory(asker, rq.requestId, 'ชั่วโมงที่ 2');
  check('ถามต่อทันทีในก้อนที่จ่ายแล้ว → ไม่หักเพิ่ม', near(await credits.getBalance(asker), b0 - 5));
  await query("UPDATE access_sessions SET started_at = now() - interval '6 minutes', last_activity_at = now() WHERE requester_id = $1 AND ended_at IS NULL", [asker]);
  await sharing.askSharedCategory(asker, rq.requestId, 'ชั่วโมงที่ 3');
  check('ผ่านไป 6 นาที (เกินก้อนแรก) → จ่ายก้อนที่สองอีก 5 เครดิต', near(await credits.getBalance(asker), b0 - 10));

  // ---------- สมุดบัญชีต้องตรงกับยอดเสมอ ----------
  for (const [name, uid] of [['ผู้ถาม', asker], ['เจ้าของ', owner]]) {
    check(`สมุดบัญชีรวม = ยอดคงเหลือ (${name})`, near(await sumLedger(uid), await credits.getBalance(uid)), `${await sumLedger(uid)} vs ${await credits.getBalance(uid)}`);
  }
  check('ข้อความไลน์ทั้งหมดไปที่แอดมินทดสอบเท่านั้น (ไม่หลุดไปหาผู้ใช้ทั่วไป)', sent.length > 0 && sent.every((m) => m.body.to === 'Utest-credits-admin' || adminLineIds.includes(m.body.to)));
  const ov = await call('GET', '/api/admin/overview', null, adminCookie);
  check('ภาพรวมแอดมินมีจำนวนสลิปรอตรวจ', ov.status === 200 && typeof ov.json.pendingTopups === 'number');

  // ---------- คืนค่า + เก็บกวาด ----------
  for (const k of Object.keys(oldSettings)) if (oldSettings[k]) await setSetting(k, oldSettings[k].value);
  await cleanup();
  const left = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  check('ลบข้อมูลทดสอบหมดเกลี้ยง', left === baseUsers, `ก่อน ${baseUsers} หลัง ${left}`);
  server.close(); await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error('ทดสอบพังกลางทาง:', e); try { await cleanup(); } catch { /* ignore */ } process.exit(1); });
