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

let synthCalls = 0; let lastVoice = ''; let lastStyle = null; let fakeSeconds = 2;
tts.setSynthForTests(async (text, voice, style) => {
  synthCalls++; lastVoice = voice; lastStyle = style;
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
// การบันทึกใช้/หักเครดิตทำตามหลังส่งเสียงกลับ (เพื่อให้เสียงดังเร็วขึ้น) — รอให้เสร็จก่อนตรวจฐานข้อมูล
let expectRows = 0; let uidForWait = null;
const waitRows = async (n) => {
  expectRows += n;
  for (let i = 0; i < 80; i++) {
    const c = (await query('SELECT count(*)::int n FROM tts_usage WHERE user_id = $1', [uidForWait])).rows[0].n;
    if (c >= expectRows) return;
    await new Promise((r) => setTimeout(r, 100));
  }
};
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
  uidForWait = uidA;

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
  check('หน้าแอดมินเห็นสถานะสิทธิ์เสียงและนาทีที่ใช้ของแต่ละคน (เดือนนี้ + รวมตั้งแต่เริ่ม + เครดิตที่หักรวม)', ul && ul.tts_enabled === true && ul.tts_seconds === 0 && ul.tts_seconds_total === 0 && ul.tts_credits_total === 0, JSON.stringify(ul && { e: ul.tts_enabled, s: ul.tts_seconds, t: ul.tts_seconds_total }));

  // ---------- โควตาฟรี ----------
  const st1 = await call('GET', '/api/chat/tts/status', null, A.cookie);
  check('มีสิทธิ์แล้ว: เหลือโควตาฟรีเต็ม 300 วินาที เสียงเริ่มต้น Kore', st1.json.allowed && st1.json.available && st1.json.freeSecondsLeft === 300 && st1.json.voice === 'Kore', JSON.stringify(st1.json));
  fakeSeconds = 2;
  const ok1 = await call('POST', '/api/chat/tts', { text: 'สวัสดีค่ะ น้องครีมพร้อมช่วยแล้ว' }, A.cookie);
  check('ขอเสียงสำเร็จ: ได้ไฟล์ WAV จริง (หัว RIFF) พร้อมบอกวินาที/โควตาที่เหลือ', ok1.status === 200 && ok1.type.includes('audio/wav') && ok1.buf.toString('ascii', 0, 4) === 'RIFF' && ok1.headers.get('x-tts-seconds') === '2' && ok1.headers.get('x-tts-free-left') === '298' && lastVoice === 'Kore');
  await waitRows(1);
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
  await waitRows(1);
  const payRow = (await query('SELECT free_seconds, credits_charged FROM tts_usage WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [uidA])).rows[0];
  check('เกินโควตาฟรี: ใช้ฟรีที่เหลือ 1 วิ ส่วนที่เกินหักเครดิต 0.03', pay.status === 200 && pay.headers.get('x-tts-free-left') === '0' && Number(payRow.free_seconds) === 1 && Number(payRow.credits_charged) === 0.03, JSON.stringify([pay.status, payRow]));
  const led = (await query("SELECT amount, type, ref_type, balance_after FROM credit_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [uidA])).rows[0];
  check('สมุดบัญชีเครดิตมีรายการ spend ref=tts และยอดคงเหลือถูก (4.97)', led && led.type === 'spend' && led.ref_type === 'tts' && Number(led.amount) === -0.03 && Number(led.balance_after) === 4.97, JSON.stringify(led));

  // ---------- ขึ้นเดือนใหม่ ----------
  await query("UPDATE users SET tts_seconds_used = 999, tts_seconds_month = '2020-01' WHERE id = $1", [uidA]);
  const stM = await call('GET', '/api/chat/tts/status', null, A.cookie);
  check('ขึ้นเดือนใหม่ → โควตาฟรีรีเซ็ตเต็ม 300 วินาที', stM.json.freeSecondsLeft === 300, String(stM.json.freeSecondsLeft));
  await call('POST', '/api/chat/tts', { text: 'สวัสดี' }, A.cookie);
  await waitRows(1);
  const r2 = (await query('SELECT tts_seconds_used, tts_seconds_month FROM users WHERE id = $1', [uidA])).rows[0];
  check('ใช้ในเดือนใหม่ → เริ่มนับจากศูนย์ (ไม่บวกทับของเดือนเก่า)', Number(r2.tts_seconds_used) === 2 && r2.tts_seconds_month === tts.monthNow(), JSON.stringify(r2));

  // ---------- ขอหลายท่อนพร้อมกัน (หน้าจอขอทุกท่อนขนาน) ต้องไม่หักโควตาฟรีซ้ำซ้อน/ขาดหาย ----------
  await query('UPDATE users SET tts_seconds_used = 290, tts_seconds_month = $2 WHERE id = $1', [uidA, tts.monthNow()]);
  await query('UPDATE credit_balances SET balance = 5 WHERE user_id = $1', [uidA]);
  const beforeLedger = (await query("SELECT COALESCE(sum(-amount), 0) AS c FROM credit_ledger WHERE user_id = $1 AND ref_type = 'tts'", [uidA])).rows[0].c;
  fakeSeconds = 6;
  const par = await Promise.all([1, 2, 3].map((n) => call('POST', '/api/chat/tts', { text: 'ท่อนที่ ' + n + ' ข้อความทดสอบความขนาน' }, A.cookie)));
  await waitRows(3);
  const afterU = (await query('SELECT tts_seconds_used FROM users WHERE id = $1', [uidA])).rows[0];
  const afterLedger = (await query("SELECT COALESCE(sum(-amount), 0) AS c FROM credit_ledger WHERE user_id = $1 AND ref_type = 'tts'", [uidA])).rows[0].c;
  const chargedPar = Math.round((Number(afterLedger) - Number(beforeLedger)) * 100) / 100;
  // ใช้ไปรวม 18 วินาที: โควตาฟรีเหลือ 10 วินาที → จ่ายเครดิตสำหรับ 8 วินาที = 8/60 นาที × 2 = 0.27 เครดิต
  check('ขอ 3 ท่อนพร้อมกัน (6 วินาทีต่อท่อน): ทั้งหมดสำเร็จ นับเวลารวม 18 วินาที ใช้ฟรีแค่ 10 ที่เหลือ ส่วนเกินหักเครดิตถูกต้อง (≈0.27)', par.every((x) => x.status === 200) && Number(afterU.tts_seconds_used) === 308 && Math.abs(chargedPar - 0.27) <= 0.02, JSON.stringify({ status: par.map((x) => x.status), used: afterU.tts_seconds_used, charged: chargedPar }));
  fakeSeconds = 2;
  await query('UPDATE users SET tts_seconds_used = 0, tts_seconds_month = $2 WHERE id = $1', [uidA, tts.monthNow()]);

  // ---------- เลือกเสียงโดยแอดมิน ----------
  await setSetting('tts_voice_index', 3);
  await call('POST', '/api/chat/tts', { text: 'ทดสอบเสียง' }, A.cookie);
  await waitRows(1);
  check('แอดมินเปลี่ยนเสียง (เลข 3 = Leda) → ใช้เสียงใหม่', lastVoice === 'Leda', lastVoice);
  await setSetting('tts_voice_index', 0);

  // ---------- ลักษณะเสียงที่ผู้ใช้เลือกเอง: เสียง (หญิง/ชาย) + สไตล์ที่ติ๊ก ----------
  const st2 = await call('GET', '/api/chat/tts/status', null, A.cookie);
  check('สถานะมีตัวเลือกให้วาดช่องติ๊ก (เสียงหญิง 4 / ชาย 2, สไตล์ 5) และค่าเริ่มต้น = ไม่ได้เลือก', st2.json.voiceOptions.female.length === 4 && st2.json.voiceOptions.male.length === 2 && st2.json.styleOptions.length === 5 && st2.json.prefs.voice === null && st2.json.prefs.styles.length === 0, JSON.stringify(st2.json.prefs));
  check('ยังไม่ล็อกอินบันทึกลักษณะเสียงไม่ได้', (await call('PUT', '/api/chat/tts/prefs', { voice: 'Puck', styles: [] })).status === 401);
  const sv = await call('PUT', '/api/chat/tts/prefs', { voice: 'Puck', styles: ['calm', 'brisk', 'cheerful', 'ใส่คำสั่งแปลกๆ ให้โมเดลอ่าน', 'calm'] }, A.cookie);
  check('บันทึกลักษณะเสียง: ตัดสไตล์ที่ไม่อยู่ในรายการ/ซ้ำ/ขัดกัน (ช้ากับเร็วขัดกัน อันแรกชนะ) → เหลือ ช้า + สดใส', sv.status === 200 && sv.json.prefs.voice === 'Puck' && JSON.stringify(sv.json.prefs.styles) === JSON.stringify(['calm', 'cheerful']), JSON.stringify(sv.json));
  lastStyle = null; await call('POST', '/api/chat/tts', { text: 'ทดสอบสไตล์เสียง' }, A.cookie);
  check('ตอนสร้างเสียงใช้เสียงที่เลือก (Puck) และส่งสไตล์ที่ติ๊กเป็นคำบรรยายให้โมเดล (ไม่ใช่ข้อความที่ผู้ใช้พิมพ์เอง)', lastVoice === 'Puck' && /speaking slowly/.test(lastStyle) && /cheerful/.test(lastStyle) && !/แปลก/.test(lastStyle), JSON.stringify({ lastVoice, lastStyle }));
  await call('PUT', '/api/chat/tts/prefs', { voice: 'EvilVoice', styles: [] }, A.cookie);
  lastStyle = 'x'; await call('POST', '/api/chat/tts', { text: 'ทดสอบเสียงมาตรฐาน' }, A.cookie);
  check('ชื่อเสียงที่ไม่อยู่ในรายการ → ถูกทิ้ง ใช้เสียงเริ่มต้นของแอดมิน (Kore) และไม่ติ๊กสไตล์ = มาตรฐาน (ไม่ส่งสไตล์)', lastVoice === 'Kore' && lastStyle === '', JSON.stringify({ lastVoice, lastStyle }));
  await waitRows(2);

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
  const ul2 = (await call('GET', '/api/admin/users', null, Adm.cookie)).json.users.find((u) => u.id === uidA);
  check('ยอดรวมต่อคนถูก: เดือนนี้ = 2 วินาทีล่าสุด แต่ "รวมตั้งแต่เริ่ม" บวกทุกครั้งทุกเดือน (2+2+2+2+2... ต้องมากกว่าเดือนนี้) และมีเครดิตที่หัก', ul2.tts_seconds_total > ul2.tts_seconds && ul2.tts_seconds_total >= 8 && ul2.tts_credits_total >= 0.03, JSON.stringify({ month: ul2.tts_seconds, total: ul2.tts_seconds_total, credits: ul2.tts_credits_total }));
  check('สรุปของแอดมินมียอดรวมทั้งระบบตั้งแต่เริ่ม', summary.json.allTime && summary.json.allTime.seconds >= 8 && summary.json.allTime.credits >= 0.03, JSON.stringify(summary.json.allTime));
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
