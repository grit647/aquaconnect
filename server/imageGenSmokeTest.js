// ทดสอบ "เจนภาพด้วย AI": สิทธิ์รายคน (ค่าเริ่มต้นปิด) โควตาฟรี หักเครดิต งบรวม ความเป็นส่วนตัวของภาพ และเลขาเรียกเครื่องมือในแชท
//   node server/imageGenSmokeTest.js   (โมเดลจำลอง ไม่เสียเงิน • ผู้ใช้ทดสอบ 09999 ลบทิ้งหมดตอนจบ และคืนค่าตั้งที่แก้ไว้)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake';

const app = require('./index');
const ai = require('./ai');
const imagegen = require('./imagegen');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900081', '0999900082', '0999900083'];
const KEYS = ['imagegen_free_per_month', 'imagegen_credits_per_image', 'imagegen_cost_thb_per_image', 'imagegen_monthly_budget_thb'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let genCalls = 0; let lastPrompt = ''; let genMode = 'ok';
imagegen.setGenerateForTests(async (prompt) => {
  genCalls++; lastPrompt = prompt;
  if (genMode === 'blocked') throw new imagegen.ImageGenError('blocked', 'วาดภาพนี้ไม่ได้ (ทดสอบ)', 422);
  if (genMode === 'crash') throw new Error('Vertex image error (500)');
  return { buf: PNG, mime: 'image/png' };
});

// โมเดลแชทจำลอง: ผู้ใช้ขอ "วาดรูป..." → เรียก generate_image → ตอบตามผลของเครื่องมือ
let toolResults = [];
ai.setCallModelForTests(async ({ contents }) => {
  const last = contents[contents.length - 1];
  const fr = last && last.parts && last.parts.find((p) => p.functionResponse);
  if (!fr) {
    const text = (last.parts[0].text || '');
    if (text.includes('วาดรูป')) return { parts: [{ functionCall: { name: 'generate_image', args: { prompt: 'การ์ตูนกุ้งน้อยใส่หมวกนักบินอวกาศ พื้นหลังสีฟ้า' } } }], usage: {} };
    return { parts: [{ text: 'ค่ะ' }], usage: {} };
  }
  toolResults.push(fr.functionResponse.response);
  return { parts: [{ text: fr.functionResponse.response.ok ? 'วาดให้แล้วค่ะ' : 'วาดไม่ได้: ' + fr.functionResponse.response.error }], usage: {} };
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
async function ask(cid, cookie, text) { toolResults = []; return call('POST', `/api/chat/conversations/${cid}/messages`, { content: text }, cookie); }

(async () => {
  await cleanup();
  const saved = {};
  for (const k of KEYS) saved[k] = (await query('SELECT value FROM app_settings WHERE key = $1', [k])).rows[0];
  await setSetting('imagegen_free_per_month', 2); await setSetting('imagegen_credits_per_image', 3); await setSetting('imagegen_cost_thb_per_image', 1); await setSetting('imagegen_monthly_budget_thb', 100000);

  const A = await call('POST', '/api/auth/register', { name: 'ทดสอบ วาดรูป', phone: PHONES[0], pin: '111222' });
  const Adm = await call('POST', '/api/auth/register', { name: 'ทดสอบ แอดมิน', phone: PHONES[1], pin: '333444' });
  const B = await call('POST', '/api/auth/register', { name: 'ทดสอบ คนอื่น', phone: PHONES[2], pin: '555666' });
  check('สมัครผู้ใช้ทดสอบ 3 คน', A.status === 200 && Adm.status === 200 && B.status === 200);
  await query('UPDATE users SET is_admin = true WHERE phone = $1', [PHONES[1]]);
  const uidA = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[0]])).rows[0].id;
  const conv = await call('POST', '/api/chat/conversations', {}, A.cookie);
  const cid = (conv.json.conversation && conv.json.conversation.id) || conv.json.id;
  const convB = await call('POST', '/api/chat/conversations', {}, B.cookie);
  const cidB = (convB.json.conversation && convB.json.conversation.id) || convB.json.id;

  // ---------- ต้องมีสิทธิ์ ----------
  check('ยังไม่ล็อกอิน ดูสถานะ/ภาพไม่ได้', (await call('GET', '/api/imagegen/status')).status === 401 && (await call('GET', '/api/imagegen/' + uidA + '/image')).status === 401);
  const st0 = await call('GET', '/api/imagegen/status', null, A.cookie);
  check('ผู้ใช้ใหม่: ยังไม่มีสิทธิ์เจนภาพ (ค่าเริ่มต้นปิด)', st0.json.allowed === false && st0.json.available === false, JSON.stringify(st0.json));
  const m0 = await ask(cid, A.cookie, 'วาดรูปกุ้งให้หน่อย');
  check('ไม่มีสิทธิ์ → เครื่องมือปฏิเสธ ไม่เรียกโมเดลเจนภาพ ไม่มีภาพในคำตอบ', m0.status === 200 && toolResults[0] && toolResults[0].ok === false && /สิทธิ์/.test(toolResults[0].error) && genCalls === 0 && m0.json.generated.length === 0, JSON.stringify(toolResults[0]));
  check('ผู้ใช้ทั่วไปเปิดสิทธิ์ให้ตัวเองไม่ได้', (await call('PATCH', `/api/admin/users/${uidA}/imagegen`, { enabled: true }, A.cookie)).status === 403);
  const en = await call('PATCH', `/api/admin/users/${uidA}/imagegen`, { enabled: true }, Adm.cookie);
  check('แอดมินเปิดสิทธิ์ให้ผู้ใช้ได้', en.status === 200 && en.json.user.imagegen_enabled === true);
  const ul = (await call('GET', '/api/admin/users', null, Adm.cookie)).json.users.find((u) => u.id === uidA);
  check('หน้าแอดมินเห็นสิทธิ์ + จำนวนภาพ (0)', ul && ul.imagegen_enabled === true && ul.imagegen_month === 0 && ul.imagegen_total === 0, JSON.stringify(ul && [ul.imagegen_enabled, ul.imagegen_month, ul.imagegen_total]));

  // ---------- โควตาฟรี ----------
  const st1 = await call('GET', '/api/imagegen/status', null, A.cookie);
  check('มีสิทธิ์แล้ว: ใช้ได้ โควตาฟรี 2 ภาพ', st1.json.allowed && st1.json.available && st1.json.freeLeft === 2 && st1.json.freeTotal === 2 && st1.json.costThbPerImage === undefined, JSON.stringify(st1.json));
  const g1 = await ask(cid, A.cookie, 'วาดรูปกุ้งให้หน่อย');
  const id1 = g1.json.generated && g1.json.generated[0];
  check('ขอวาด → เลขาเรียก generate_image สำเร็จ ได้ภาพ (generated) ใช้โควตาฟรี ไม่หักเครดิต', g1.status === 200 && genCalls === 1 && !!id1 && toolResults[0].ok && toolResults[0].usedFree === true && toolResults[0].creditsCharged === 0 && toolResults[0].freeImagesLeftThisMonth === 1 && /กุ้งน้อย/.test(lastPrompt), JSON.stringify(toolResults[0]));
  check('คำตอบที่ส่งกลับไม่มีป้ายภาพหลุด แต่ประวัติแชทเก็บป้าย ⟦gen:id⟧', !/⟦gen/.test(g1.json.reply) && JSON.stringify((await call('GET', `/api/chat/conversations/${cid}/messages`, null, A.cookie)).json).includes('⟦gen:' + id1 + '⟧'));
  const img = await call('GET', `/api/imagegen/${id1}/image`, null, A.cookie);
  check('เจ้าของเปิดภาพได้ (ชนิดไฟล์ถูก ไม่แคชสาธารณะ กันเดาชนิด)', img.status === 200 && img.type === 'image/png' && img.buf.equals(PNG) && /private/.test(img.headers.get('cache-control')) && img.headers.get('x-content-type-options') === 'nosniff', img.type);
  check('คนอื่นเปิดภาพของเราไม่ได้ → 404 / id มั่ว → 404', (await call('GET', `/api/imagegen/${id1}/image`, null, B.cookie)).status === 404 && (await call('GET', '/api/imagegen/not-a-uuid/image', null, A.cookie)).status === 404);
  const g2 = await ask(cid, A.cookie, 'วาดรูปอีกภาพ');
  check('ภาพที่ 2 ยังใช้โควตาฟรี (เหลือ 0)', g2.status === 200 && toolResults[0].usedFree === true && toolResults[0].freeImagesLeftThisMonth === 0, JSON.stringify(toolResults[0]));

  // ---------- เกินโควตาฟรี: เครดิตไม่พอ → ไม่เจน ไม่เสียเงิน ----------
  const before = genCalls;
  const g3 = await ask(cid, A.cookie, 'วาดรูปอีกภาพ');
  check('โควตาฟรีหมด + เครดิตไม่พอ → ไม่เรียกโมเดล (ไม่เสียต้นทุน) และแจ้งให้เติมเครดิต', g3.json.generated.length === 0 && genCalls === before && toolResults[0].ok === false && /เครดิตไม่พอ/.test(toolResults[0].error), JSON.stringify(toolResults[0]));

  // ---------- เกินโควตาฟรี: มีเครดิต → หัก 3 เครดิต ----------
  await query('INSERT INTO credit_balances (user_id, balance) VALUES ($1, 10) ON CONFLICT (user_id) DO UPDATE SET balance = 10', [uidA]);
  const g4 = await ask(cid, A.cookie, 'วาดรูปอีกภาพ');
  const led = (await query("SELECT amount, type, ref_type, balance_after FROM credit_ledger WHERE user_id = $1 AND ref_type = 'imagegen' ORDER BY id DESC LIMIT 1", [uidA])).rows[0];
  check('เกินโควตาฟรี มีเครดิต → วาดได้ หัก 3 เครดิต (สมุดบัญชี spend ref=imagegen ยอดคงเหลือ 7)', g4.json.generated.length === 1 && toolResults[0].usedFree === false && toolResults[0].creditsCharged === 3 && led && led.type === 'spend' && Number(led.amount) === -3 && Number(led.balance_after) === 7, JSON.stringify(led));
  const ul2 = (await call('GET', '/api/admin/users', null, Adm.cookie)).json.users.find((u) => u.id === uidA);
  check('หน้าแอดมินนับภาพถูก (เดือนนี้ 3 / รวม 3)', ul2.imagegen_month === 3 && ul2.imagegen_total === 3, JSON.stringify([ul2.imagegen_month, ul2.imagegen_total]));

  // ---------- เจนไม่สำเร็จ = ไม่คิดเงิน ----------
  genMode = 'blocked';
  const rowsBefore = (await query('SELECT count(*)::int n FROM imagegen_usage WHERE user_id = $1', [uidA])).rows[0].n;
  const gb = await ask(cid, A.cookie, 'วาดรูปแปลกๆ');
  genMode = 'crash';
  const gc = await ask(cid, A.cookie, 'วาดรูปอีกที');
  const rowsAfter = (await query('SELECT count(*)::int n FROM imagegen_usage WHERE user_id = $1', [uidA])).rows[0].n;
  const bal = Number((await query('SELECT balance FROM credit_balances WHERE user_id = $1', [uidA])).rows[0].balance);
  check('ถูกกรองความปลอดภัย/โมเดลล่ม → ไม่มีภาพ ไม่บันทึกการใช้ ไม่หักเครดิต (ยังเหลือ 7) เลขาแจ้งผู้ใช้', gb.json.generated.length === 0 && gc.json.generated.length === 0 && rowsAfter === rowsBefore && bal === 7 && /วาดไม่ได้/.test(gb.json.reply) && /วาดไม่ได้/.test(gc.json.reply), JSON.stringify({ rowsBefore, rowsAfter, bal }));
  genMode = 'ok';

  // ---------- คำสั่งว่าง/สั้นเกิน + ความยาว ----------
  let emptyErr = null; try { await imagegen.generateForUser(uidA, ' ') } catch (e) { emptyErr = e; }
  check('คำสั่งวาดว่างเปล่า → ปฏิเสธ (400) ไม่เรียกโมเดล', emptyErr && emptyErr.code === 'empty');
  await query('INSERT INTO credit_balances (user_id, balance) VALUES ($1, 100) ON CONFLICT (user_id) DO UPDATE SET balance = 100', [uidA]);
  await imagegen.generateForUser(uidA, 'ก'.repeat(5000));
  check('คำสั่งวาดยาวเกิน ถูกตัดที่ 600 ตัวอักษรก่อนส่งโมเดล', lastPrompt.length === 600, String(lastPrompt.length));

  // ---------- งบรวมของแพลตฟอร์ม ----------
  await setSetting('imagegen_monthly_budget_thb', 1);   // ใช้ไปแล้วหลายบาท → เกินงบ
  const gBud = await ask(cid, A.cookie, 'วาดรูปอีกภาพ');
  const stBud = await call('GET', '/api/imagegen/status', null, A.cookie);
  check('งบรวมเต็ม → ปิดเจนภาพทั้งระบบ (available=false) และเลขาบอกผู้ใช้', gBud.json.generated.length === 0 && stBud.json.available === false && stBud.json.budgetOk === false && /งบ/.test(toolResults[0].error), JSON.stringify(toolResults[0]));
  await setSetting('imagegen_monthly_budget_thb', 100000);

  // ---------- ปิดสิทธิ์ ----------
  await call('PATCH', `/api/admin/users/${uidA}/imagegen`, { enabled: false }, Adm.cookie);
  const gOff = await ask(cid, A.cookie, 'วาดรูปอีกภาพ');
  check('แอดมินปิดสิทธิ์ → เจนไม่ได้ทันที', gOff.json.generated.length === 0 && /สิทธิ์/.test(toolResults[0].error));

  // ---------- เลขาของคนอื่นไม่เห็นภาพของเรา / แอดมินสรุป ----------
  const gB = await ask(cidB, B.cookie, 'วาดรูปให้หน่อย');
  check('ผู้ใช้ B (ไม่มีสิทธิ์) ใช้ไม่ได้ และไม่เห็นภาพของ A ในประวัติ', gB.json.generated.length === 0 && !JSON.stringify((await call('GET', `/api/chat/conversations/${cidB}/messages`, null, B.cookie)).json).includes(id1));
  const summary = await call('GET', '/api/admin/imagegen-usage', null, Adm.cookie);
  check('แอดมินดูสรุปการใช้ได้ (จำนวนภาพ ต้นทุน เครดิตที่หัก) / ผู้ใช้ทั่วไปดูไม่ได้', summary.status === 200 && summary.json.images >= 4 && summary.json.creditsCharged >= 3 && summary.json.spentThb >= 4 && (await call('GET', '/api/admin/imagegen-usage', null, A.cookie)).status === 403, JSON.stringify(summary.json));
  const settings = (await call('GET', '/api/admin/settings', null, Adm.cookie)).json.settings || [];
  check('ค่าตั้งเจนภาพทั้ง 4 ตัวแก้ได้ในหน้าแอดมิน', KEYS.every((k) => settings.some((s) => s.key === k)));

  // ---------- เครื่องมือไม่หลุดไปในกลุ่ม/หลังอ่านข้อมูลภายนอก ----------
  const chatSrc = require('fs').readFileSync(require('path').join(__dirname, 'routes', 'chat.js'), 'utf8');
  const okSet = /const TOOLS_OK_WITH_EXTERNAL = new Set\(\[([^\]]*)\]\)/.exec(chatSrc)[1];
  check('generate_image ไม่อยู่ในชุดเครื่องมือที่ใช้ได้ตอนคุยในกลุ่ม/มีไฟล์แนบจากภายนอก (กันสั่งเจนภาพเปลืองเงินผ่านข้อความคนอื่น)', !okSet.includes('generate_image'));

  // ---------- ภาพเก่าถูกลบเมื่อเกิน 60 ภาพ ----------
  await query('UPDATE users SET imagegen_enabled = true WHERE id = $1', [uidA]);
  await setSetting('imagegen_free_per_month', 1000);
  for (let i = 0; i < 58; i++) await imagegen.generateForUser(uidA, 'ภาพทดสอบ ' + i);
  const n = (await query('SELECT count(*)::int n FROM generated_images WHERE owner_id = $1', [uidA])).rows[0].n;
  check('เก็บภาพล่าสุดไม่เกิน 60 ภาพต่อคน (ภาพเก่าสุดถูกลบอัตโนมัติ)', n === 60, String(n));
  check('ภาพแรกสุดถูกลบไปแล้ว (เปิดไม่ได้ → 404)', (await call('GET', `/api/imagegen/${id1}/image`, null, A.cookie)).status === 404);

  // ---------- เก็บกวาด ----------
  for (const k of KEYS) if (saved[k]) await query('UPDATE app_settings SET value = $2::jsonb WHERE key = $1', [k, JSON.stringify(saved[k].value)]);
  await cleanup();
  const left = (await query('SELECT (SELECT count(*) FROM generated_images WHERE owner_id = $1)::int AS g, (SELECT count(*) FROM imagegen_usage WHERE user_id = $1)::int AS u', [uidA])).rows[0];
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (ผู้ใช้ + ภาพ + ประวัติการใช้หายตาม) และคืนค่าตั้งเดิม', left.g === 0 && left.u === 0, JSON.stringify(left));

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await cleanup(); } catch { /* ignore */ }
  process.exit(1);
});
