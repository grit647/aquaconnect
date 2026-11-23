// ทดสอบ "เสียงเลขาพรีเมียม (Gemini TTS)": สิทธิ์รายคน โควตาฟรี หักเครดิต งบรวมรายเดือน และไม่เสียเงินจริงตอนทดสอบ (ใช้เสียงจำลอง)
//   node server/ttsSmokeTest.js   (ผู้ใช้ทดสอบ 09999 ลบทิ้งหมดตอนจบ และคืนค่าตั้งระบบที่แก้ไว้)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake';

const app = require('./index');
const tts = require('./tts');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900061', '0999900062'];
const KEYS = ['tts_free_seconds_per_month', 'tts_credits_per_minute', 'tts_cost_thb_per_minute', 'tts_monthly_budget_thb', 'tts_voice_index'];

let synthCalls = 0; let lastVoice = ''; let fakeSeconds = 2;
tts.setSynthForTests(async (text, voice) => {
  synthCalls++; lastVoice = voice;
  const pcm = Buffer.alloc(Math.round(24000 * 2 * fakeSeconds));   // เสียงเงียบ 24kHz 16-bit mono ยาว fakeSeconds วินาที
  return { wav: tts.pcmToWav(pcm, 24000), seconds: fakeSeconds };
});

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  let json = {}; let buf = null;
  if (type.includes('json')) { try { json = await r.json(); } catch { /* ไม่มี body */ } } else buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, json, buf, type, headers: r.headers, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const setSetting = (k, v) => query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, JSON.stringify(v)]);

async function cleanup() {
  const ids = 'SELECT id FROM users WHERE phone = ANY($1)';
  await query(`DELETE FROM credit_ledger WHERE user_id IN (${ids})`, [PHONES]);
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
}

(async () => {
  await cleanup();
  const saved = {};
  for (const k of KEYS) saved[k] = (await query('SELECT value FROM app_settings WHERE key = $1', [k])).rows[0];
  await setSetting('tts_free_seconds_per_month', 300); await setSetting('tts_credits_per_minute', 2); await setSetting('tts_cost_thb_per_minute', 0.5); await setSetting('tts_monthly_budget_thb', 100000); await setSetting('tts_voice_index', 0);

  // ---------- เครื่องมือแปลงเสียง ----------
  const w = tts.pcmToWav(Buffer.alloc(48000 * 3), 24000);
  check('อ่านความยาวเสียงจาก WAV ได้ถูก (144000 ไบต์ที่ 24kHz 16 บิต = 3 วินาที)', Math.abs(tts.wavInfo(w).seconds - 3) < 0.001, String(tts.wavInfo(w).seconds));
  check('ไฟล์ที่ไม่ใช่ WAV → อ่านความยาวไม่ได้ (คืน null)', tts.wavInfo(Buffer.from('not a wav file at all, just text...........')) === null);

  const A = await call('POST', '/api/auth/register', { name: 'ทดสอบ เสียง', phone: PHONES[0], pin: '111222' });
  const Adm = await call('POST', '/api/auth/register', { name: 'ทดสอบ แอดมิน', phone: PHONES[1], pin: '333444' });
  check('สมัครผู้ใช้ทดสอบ 2 คน', A.status === 200 && Adm.status === 200);
  await query('UPDATE users SET is_admin = true WHERE phone = $1', [PHONES[1]]);
  const uidA = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[0]])).rows[0].id;

  // ---------- ต้องมีสิทธิ์ ----------
  check('ยังไม่ล็อกอิน ขอเสียงไม่ได้', (await call('POST', '/api/chat/tts', { text: 'สวัสดี' })).status === 401);
  const st0 = await call('GET', '/api/chat/tts/status', null, A.cookie);
  check('ผู้ใช้ใหม่: ยังไม่มีสิทธิ์เสียงพรีเมียม (ค่าเริ่มต้นปิด)', st0.json.allowed === false && st0.json.available === false, JSON.stringify(st0.json));
  const d0 = await call('POST', '/api/chat/tts', { text: 'สวัสดีค่ะ' }, A.cookie);
  check('ไม่มีสิทธิ์ → 403 และไม่ได้เรียกโมเดลเสียง (ไม่เสียเงิน)', d0.status === 403 && d0.json.code === 'not_allowed' && synthCalls === 0, JSON.stringify(d0.json));
  check('ผู้ใช้ทั่วไปเปิดสิทธิ์ให้ตัวเองไม่ได้', (await call('PATCH', `/api/admin/users/${uidA}/tts`, { enabled: true }, A.cookie)).status === 403);
  const en = await call('PATCH', `/api/admin/users/${uidA}/tts`, { enabled: true }, Adm.cookie);
  check('แอดมินเปิดสิทธิ์ให้รายคนได้', en.status === 200 && en.json.user.tts_enabled === true);
  const ul = (await call('GET', '/api/admin/users', null, Adm.cookie)).json.users.find((u) => u.id === uidA);
  check('หน้าแอดมินเห็นสถานะสิทธิ์เสียงและนาทีที่ใช้ของแต่ละคน', ul && ul.tts_enabled === true && ul.tts_seconds === 0, JSON.stringify(ul && { e: ul.tts_enabled, s: ul.tts_seconds }));

  // ---------- โควตาฟรี ----------
  const st1 = await call('GET', '/api/chat/tts/status', null, A.cookie);
  check('มีสิทธิ์แล้ว: เหลือโควตาฟรีเต็ม 300 วินาที เสียงเริ่มต้น Kore', st1.json.allowed && st1.json.available && st1.json.freeSecondsLeft === 300 && st1.json.voice === 'Kore', JSON.stringify(st1.json));
  fakeSeconds = 2;
  const ok1 = await call('POST', '/api/chat/tts', { text: 'สวัสดีค่ะ น้องครีมพร้อมช่วยแล้ว' }, A.cookie);
  check('ขอเสียงสำเร็จ: ได้ไฟล์ WAV จริง (หัว RIFF) พร้อมบอกวินาที/โควตาที่เหลือ', ok1.status === 200 && ok1.type.includes('audio/wav') && ok1.buf.toString('ascii', 0, 4) === 'RIFF' && ok1.headers.get('x-tts-seconds') === '2' && ok1.headers.get('x-tts-free-left') === '298' && ok1.headers.get('x-tts-credits') === '0' && lastVoice === 'Kore');
  const row = (await query('SELECT tts_seconds_used FROM users WHERE id = $1', [uidA])).rows[0];
  const usage = (await query('SELECT chars, seconds, free_seconds, credits_charged, cost_thb FROM tts_usage WHERE user_id = $1', [uidA])).rows;
  check('ใช้โควตาฟรีก่อน ไม่หักเครดิต + บันทึกการใช้ (ไม่เก็บตัวข้อความ)', Number(row.tts_seconds_used) === 2 && usage.length === 1 && Number(usage[0].free_seconds) === 2 && Number(usage[0].credits_charged) === 0 && Math.abs(Number(usage[0].cost_thb) - (2 / 60) * 0.5) < 0.001 && !JSON.stringify(usage).includes('สวัสดี'), JSON.stringify(usage));
  check('ข้อความว่าง → 400', (await call('POST', '/api/chat/tts', { text: '   ' }, A.cookie)).status === 400);
  const long = await call('POST', '/api/chat/tts', { text: 'ก'.repeat(tts.MAX_CHARS + 1) }, A.cookie);
  check('ข้อความยาวเกินเพดาน → 413 (หน้าจอจะถอยไปใช้เสียงเบราว์เซอร์)', long.status === 413 && long.json.code === 'too_long');

  // ---------- เกินโควตาฟรี → หักเครดิต ----------
  await query('UPDATE users SET tts_seconds_used = 299, tts_seconds_month = $2 WHERE id = $1', [uidA, tts.monthNow()]);
  const calls0 = synthCalls;
  const nc = await call('POST', '/api/chat/tts', { text: 'ข้อความยี่สิบตัวอักษร' }, A.cookie);
  check('โควตาฟรีเหลือ 1 วิ และไม่มีเครดิต → 402 no_credit ก่อนเรียกโมเดล (ไม่เสียเงิน)', nc.status === 402 && nc.json.code === 'no_credit' && synthCalls === calls0, JSON.stringify(nc.json));
  await query("INSERT INTO credit_balances (user_id, balance) VALUES ($1, 5) ON CONFLICT (user_id) DO UPDATE SET balance = 5", [uidA]);
  const pay = await call('POST', '/api/chat/tts', { text: 'ข้อความยี่สิบตัวอักษร' }, A.cookie);
  // เสียง 2 วินาที: ฟรี 1 + จ่าย 1 วินาที = 1/60 นาที × 2 เครดิต = 0.03 เครดิต
  check('เกินโควตาฟรี: ใช้ฟรีที่เหลือ 1 วิ ส่วนที่เกินหักเครดิต 0.03', pay.status === 200 && pay.headers.get('x-tts-free-left') === '0' && pay.headers.get('x-tts-credits') === '0.03', JSON.stringify([pay.status, pay.headers.get('x-tts-credits')]));
  const led = (await query("SELECT amount, type, ref_type, balance_after FROM credit_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [uidA])).rows[0];
  check('สมุดบัญชีเครดิตมีรายการ spend ref=tts และยอดคงเหลือถูก (4.97)', led && led.type === 'spend' && led.ref_type === 'tts' && Number(led.amount) === -0.03 && Number(led.balance_after) === 4.97, JSON.stringify(led));

  // ---------- ขึ้นเดือนใหม่ ----------
  await query("UPDATE users SET tts_seconds_used = 999, tts_seconds_month = '2020-01' WHERE id = $1", [uidA]);
  const stM = await call('GET', '/api/chat/tts/status', null, A.cookie);
  check('ขึ้นเดือนใหม่ → โควตาฟรีรีเซ็ตเต็ม 300 วินาที', stM.json.freeSecondsLeft === 300, String(stM.json.freeSecondsLeft));
  await call('POST', '/api/chat/tts', { text: 'สวัสดี' }, A.cookie);
  const r2 = (await query('SELECT tts_seconds_used, tts_seconds_month FROM users WHERE id = $1', [uidA])).rows[0];
  check('ใช้ในเดือนใหม่ → เริ่มนับจากศูนย์ (ไม่บวกทับของเดือนเก่า)', Number(r2.tts_seconds_used) === 2 && r2.tts_seconds_month === tts.monthNow(), JSON.stringify(r2));

  // ---------- เลือกเสียงโดยแอดมิน ----------
  await setSetting('tts_voice_index', 3);
  await call('POST', '/api/chat/tts', { text: 'ทดสอบเสียง' }, A.cookie);
  check('แอดมินเปลี่ยนเสียง (เลข 3 = Leda) → ใช้เสียงใหม่', lastVoice === 'Leda', lastVoice);
  await setSetting('tts_voice_index', 0);

  // ---------- งบรวมของแพลตฟอร์ม ----------
  const spent = await tts.monthSpentThb();
  await setSetting('tts_monthly_budget_thb', Math.max(0.0001, spent.thb));   // ใช้ไปเท่างบพอดี = เต็ม
  const calls1 = synthCalls;
  const bud = await call('POST', '/api/chat/tts', { text: 'สวัสดีค่ะ' }, A.cookie);
  const stB = await call('GET', '/api/chat/tts/status', null, A.cookie);
  check('งบรวมของแพลตฟอร์มเต็ม → 402 budget ก่อนเรียกโมเดล และสถานะ available = false', bud.status === 402 && bud.json.code === 'budget' && synthCalls === calls1 && stB.json.available === false && stB.json.budgetOk === false, JSON.stringify(bud.json));
  await setSetting('tts_monthly_budget_thb', 0);
  check('ตั้งงบ 0 = ปิดเสียงพรีเมียมทั้งระบบ', (await call('POST', '/api/chat/tts', { text: 'สวัสดี' }, A.cookie)).json.code === 'budget');
  await setSetting('tts_monthly_budget_thb', 100000);
  const summary = await call('GET', '/api/admin/tts-usage', null, Adm.cookie);
  check('แอดมินดูสรุปเสียงเดือนนี้ได้ (นาที/ต้นทุน/งบ/เครดิตที่หัก/จำนวนคนที่เปิดสิทธิ์)', summary.status === 200 && summary.json.spentThb >= 0 && summary.json.budgetThb === 100000 && summary.json.enabledUsers >= 1 && summary.json.creditsCharged >= 0.03, JSON.stringify(summary.json));
  check('ผู้ใช้ทั่วไปดูสรุปของแอดมินไม่ได้', (await call('GET', '/api/admin/tts-usage', null, A.cookie)).status === 403);
  const off = await call('PATCH', `/api/admin/users/${uidA}/tts`, { enabled: false }, Adm.cookie);
  const d1 = await call('POST', '/api/chat/tts', { text: 'สวัสดี' }, A.cookie);
  check('แอดมินปิดสิทธิ์ → ขอเสียงไม่ได้อีก (403)', off.status === 200 && d1.status === 403);

  // ---------- เก็บกวาด ----------
  for (const k of KEYS) {
    if (saved[k]) await query('UPDATE app_settings SET value = $2::jsonb WHERE key = $1', [k, JSON.stringify(saved[k].value)]);
  }
  await cleanup();
  const left = (await query('SELECT (SELECT count(*)::int FROM users WHERE phone = ANY($1)) AS u, (SELECT count(*)::int FROM tts_usage WHERE user_id = $2) AS t', [PHONES, uidA])).rows[0];
  const settingsBack = (await query('SELECT value FROM app_settings WHERE key = $1', ['tts_monthly_budget_thb'])).rows[0];
  check('ลบข้อมูลทดสอบหมดเกลี้ยง และคืนค่าตั้งงบเดิม', left.u === 0 && left.t === 0 && JSON.stringify(settingsBack.value) === JSON.stringify(saved.tts_monthly_budget_thb.value), JSON.stringify({ left, settingsBack }));

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await cleanup(); } catch { /* ignore */ }
  process.exit(1);
});
