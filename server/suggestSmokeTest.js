// ทดสอบ "คำแนะนำข้อความถัดไปจากเลขา" + "ข้อความกลุ่มที่ยังไม่อ่าน"
//   node server/suggestSmokeTest.js   (โมเดลจำลอง ไม่เสียเงิน • ผู้ใช้ทดสอบ 09999 ลบทิ้งหมดตอนจบ)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake';

const app = require('./index');
const ai = require('./ai');
const suggest = require('./suggest');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900051', '0999900052'];

let modelReply = 'ได้เลยค่ะ\n<<ข้อความถัดไป: อยากสอนเลขาเรื่องฟาร์มของฉัน>>';
let lastPrompt = '';
ai.setCallModelForTests(async ({ systemPrompt }) => {
  lastPrompt = systemPrompt;
  return { parts: [{ text: modelReply }], usage: {} };
});

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

(async () => {
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);

  // ---------- แกะคำแนะนำออกจากคำตอบ ----------
  const ex = suggest.extractSuggestion;
  let x = ex('ได้เลยค่ะ\n<<ข้อความถัดไป: ตั้งเตือนนัดพรุ่งนี้>>');
  check('แกะบรรทัดคำแนะนำออกจากคำตอบ → คำตอบสะอาด + ได้ข้อความแนะนำ', x.text === 'ได้เลยค่ะ' && x.suggestion === 'ตั้งเตือนนัดพรุ่งนี้', JSON.stringify(x));
  x = ex('ตอบแล้วนะคะ <<ข้อความถัดไป: สอนเลขาเรื่องบ่อ');
  check('โมเดลลืมปิด >> ก็ยังแกะได้ (ไม่หลุดไปให้ผู้ใช้เห็น)', x.text === 'ตอบแล้วนะคะ' && x.suggestion === 'สอนเลขาเรื่องบ่อ', JSON.stringify(x));
  x = ex('ก <<ข้อความถัดไป: อันแรก>> ข <<ข้อความถัดไป: อันสอง>>');
  check('มีหลายบรรทัด → ใช้อันแรก และลบออกหมด', x.suggestion === 'อันแรก' && !x.text.includes('<<'), JSON.stringify(x));
  x = ex('ตอบ\n<<ข้อความถัดไป: **ตัวหนา** "ยาวมาก' + 'ก'.repeat(200) + '">>');
  check('ตัดเครื่องหมาย ** และจำกัดความยาวไม่เกิน 90 ตัว', !x.suggestion.includes('*') && x.suggestion.length <= suggest.MAX_SUGGESTION_CHARS && x.suggestion.endsWith('…'), String(x.suggestion.length));
  x = ex('คำตอบธรรมดาไม่มีคำแนะนำ');
  check('ไม่มีบรรทัดคำแนะนำ → ไม่มีคำแนะนำ คำตอบเหมือนเดิม', x.suggestion === '' && x.text === 'คำตอบธรรมดาไม่มีคำแนะนำ');
  check('บรรทัดว่างเปล่า (<<ข้อความถัดไป: >>) → ไม่นับ', ex('ก <<ข้อความถัดไป:   >>').suggestion === '');
  x = ex('สวัสดีค่ะ <<อยากให้เลขาช่วยอะไรดีคะ>>');
  check('โมเดลเขียนผิดรูปแบบ (ลืมคำนำ) → ไม่ใช้เป็นคำแนะนำ และต้องไม่หลุดไปในคำตอบ', x.suggestion === '' && x.text === 'สวัสดีค่ะ' && !x.text.includes('<<'), JSON.stringify(x));
  x = ex('รับทราบ <<ข้อความถัดไป: ดีค่ะ <<ซ้อนมั่ว');
  check('เครื่องหมายซ้อน/ค้างไม่หลุดไปในคำตอบ', !x.text.includes('<<') && !x.text.includes('>>'), JSON.stringify(x));

  const A = await call('POST', '/api/auth/register', { name: 'ทดสอบ แนะนำ', phone: PHONES[0], pin: '111222' });
  const B = await call('POST', '/api/auth/register', { name: 'ทดสอบ เพื่อน', phone: PHONES[1], pin: '333444' });
  check('สมัครผู้ใช้ทดสอบ 2 คน', A.status === 200 && B.status === 200);
  const uidA = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[0]])).rows[0].id;
  const uidB = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[1]])).rows[0].id;

  // ---------- กติกาตายตัวตอนเปิดแอป ----------
  const r0 = await call('GET', '/api/chat/suggestion', null, A.cookie);
  check('ผู้ใช้ใหม่ ยังไม่มีความจำ → แนะนำให้สอนเลขา', r0.status === 200 && r0.json.suggestion && r0.json.suggestion.text.includes('สอนเลขา') && r0.json.suggestion.kind === 'rule', JSON.stringify(r0.json));
  check('ยังไม่ล็อกอินเรียกคำแนะนำไม่ได้', (await call('GET', '/api/chat/suggestion')).status === 401);

  // คำขอใช้ข้อมูลรออนุมัติ = สำคัญกว่าเรื่องสอนใช้แอป
  const cat = (await query("SELECT id FROM memory_categories WHERE owner_id = $1 AND name = 'ทั่วไป'", [uidA])).rows[0].id;
  await query("INSERT INTO access_requests (requester_id, owner_id, category_id, status) VALUES ($1, $2, $3, 'pending')", [uidB, uidA, cat]);
  const r1 = await call('GET', '/api/chat/suggestion', null, A.cookie);
  check('มีคำขอใช้ข้อมูลรออนุมัติ → แนะนำให้ไปดูคำขอก่อน (ของค้างสำคัญกว่าสอนใช้แอป)', r1.json.suggestion && r1.json.suggestion.text.includes('ขอใช้ข้อมูล'), JSON.stringify(r1.json));
  const logged = (await query('SELECT count(*)::int n FROM suggestion_log WHERE user_id = $1', [uidA])).rows[0].n;
  const r1b = await call('GET', '/api/chat/suggestion', null, A.cookie);
  check('เรียกซ้ำได้คำแนะนำเดิมและไม่เพิ่มแถวบันทึกซ้ำ', r1b.json.suggestion.id === r1.json.suggestion.id && (await query('SELECT count(*)::int n FROM suggestion_log WHERE user_id = $1', [uidA])).rows[0].n === logged);

  // ---------- คำแนะนำที่มากับคำตอบเลขา ----------
  const conv = await call('POST', '/api/chat/conversations', {}, A.cookie);
  const cid = (conv.json.conversation && conv.json.conversation.id) || conv.json.id;
  const m1 = await call('POST', `/api/chat/conversations/${cid}/messages`, { content: 'สวัสดี' }, A.cookie);
  check('คำตอบไม่มีบรรทัดคำแนะนำหลุดมา + ได้ suggestion แยกเป็นฟิลด์', m1.status === 200 && m1.json.reply === 'ได้เลยค่ะ' && m1.json.suggestion && m1.json.suggestion.text === 'อยากสอนเลขาเรื่องฟาร์มของฉัน' && m1.json.suggestion.kind === 'ai', JSON.stringify(m1.json));
  const stored = (await query("SELECT content FROM messages WHERE conversation_id = $1 AND role = 'assistant'", [cid])).rows.map((r) => r.content).join('|');
  check('ประวัติแชทที่เก็บลงฐานข้อมูลไม่มีบรรทัดคำแนะนำ', !stored.includes('<<') && !stored.includes('ข้อความถัดไป'));
  check('prompt ของเลขามีคำสั่งให้แนบคำแนะนำ + ข้อมูลสถานะผู้ใช้ + ลำดับความสำคัญ', lastPrompt.includes('<<ข้อความถัดไป:') && lastPrompt.includes('ระดับการใช้งาน: ผู้ใช้ใหม่') && lastPrompt.includes('คำขอใช้ข้อมูลของผู้ใช้ที่รออนุมัติ 1 คำขอ') && lastPrompt.includes('ของค้างที่ผู้ใช้ควรรู้') && lastPrompt.includes('ชวนให้ผู้ใช้สอน') && lastPrompt.includes('platform_guide'));
  const pend = (await query("SELECT count(*)::int n FROM suggestion_log WHERE user_id = $1 AND accepted IS NULL AND kind = 'ai'", [uidA])).rows[0].n;
  check('คำแนะนำจากเลขาถูกบันทึกเป็นรอผู้ใช้ตัดสินใจ', pend === 1);

  // ผู้ใช้กดรับคำแนะนำ
  modelReply = 'รับทราบค่ะ ไม่มีบรรทัดแนะนำรอบนี้';
  const m2 = await call('POST', `/api/chat/conversations/${cid}/messages`, { content: m1.json.suggestion.text, suggestionId: m1.json.suggestion.id }, A.cookie);
  await new Promise((r) => setTimeout(r, 300));
  const acc = (await query('SELECT accepted FROM suggestion_log WHERE id = $1', [m1.json.suggestion.id])).rows[0];
  check('ผู้ใช้กดใช้คำแนะนำ → บันทึกว่ารับ (accepted = true)', m2.status === 200 && acc.accepted === true);
  check('เลขาไม่แนบคำแนะนำ → suggestion เป็น null (ไม่แต่งเอง)', m2.json.suggestion === null);

  // ผู้ใช้พิมพ์เองแทน = ข้าม
  modelReply = 'ค่ะ\n<<ข้อความถัดไป: อัปเดตราคากุ้งให้หน่อย>>';
  const m3 = await call('POST', `/api/chat/conversations/${cid}/messages`, { content: 'อะไรก็ได้' }, A.cookie);
  modelReply = 'ค่ะ\n<<ข้อความถัดไป: เรื่องอื่น>>';
  const m4 = await call('POST', `/api/chat/conversations/${cid}/messages`, { content: 'พิมพ์เองแทน' }, A.cookie);
  await new Promise((r) => setTimeout(r, 300));
  const skip = (await query('SELECT accepted FROM suggestion_log WHERE id = $1', [m3.json.suggestion.id])).rows[0];
  check('ผู้ใช้พิมพ์เองแทนคำแนะนำ → บันทึกว่าข้าม (accepted = false)', skip.accepted === false);
  const fb = await suggest.buildContext(uidA);
  check('รอบถัดไปเลขาเห็นว่าแบบไหนผู้ใช้รับ/ไม่รับ (เรียนรู้จากผู้ใช้)', fb.includes('เคยกดรับ') && fb.includes('อยากสอนเลขาเรื่องฟาร์มของฉัน') && fb.includes('ไม่เอา') && fb.includes('อัปเดตราคากุ้งให้หน่อย'));
  // ผู้ใช้อื่นกดรับ id ของเราไม่ได้
  const stolen = await call('POST', `/api/chat/conversations/${(await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation?.id || ''}/messages`, { content: 'x', suggestionId: m4.json.suggestion.id }, B.cookie);
  await new Promise((r) => setTimeout(r, 300));
  check('คนอื่นเอา id คำแนะนำของเราไปกดรับแทนไม่ได้', (await query('SELECT accepted FROM suggestion_log WHERE id = $1', [m4.json.suggestion.id])).rows[0].accepted === null, `status ${stolen.status}`);

  // ข้ามอันที่เพิ่งไม่เอาใน 3 วัน ไม่ขึ้นซ้ำทุกครั้งที่เปิดแอป
  await query("UPDATE access_requests SET status = 'denied' WHERE owner_id = $1", [uidA]);
  await query('INSERT INTO suggestion_log (user_id, kind, text, accepted, decided_at) VALUES ($1, $2, $3, false, now())', [uidA, 'rule', 'อยากสอนเลขาเรื่องงานของฉัน']);
  const r2 = await call('GET', '/api/chat/suggestion', null, A.cookie);
  check('คำแนะนำแบบกติกาที่ผู้ใช้เพิ่งข้าม → ไม่เสนอซ้ำ ขยับไปเรื่องถัดไป', r2.json.suggestion && !r2.json.suggestion.text.includes('สอนเลขา') && r2.json.suggestion.text.includes('ตั้งเตือน'), JSON.stringify(r2.json));

  // ---------- ข้อความที่ยังไม่อ่านในกลุ่ม ----------
  const g = await call('POST', '/api/groups', { name: 'กลุ่มทดสอบแจ้งเตือน' }, A.cookie);
  const gid = g.json.group.id;
  await query("INSERT INTO chat_group_members (group_id, user_id, role) VALUES ($1, $2, 'member')", [gid, uidB]);
  const unreadOf = async (cookie) => ((await call('GET', '/api/groups', null, cookie)).json.groups.find((x) => x.id === gid) || {}).unread;
  check('กลุ่มใหม่ ยังไม่มีข้อความ → ยังไม่อ่านเป็น 0', (await unreadOf(A.cookie)) === 0 && (await unreadOf(B.cookie)) === 0);
  await call('POST', `/api/groups/${gid}/messages`, { content: 'สวัสดีครับ' }, B.cookie);
  await call('POST', `/api/groups/${gid}/messages`, { content: 'มีใครอยู่ไหม' }, B.cookie);
  await query("INSERT INTO chat_group_messages (group_id, user_id, content, is_system) VALUES ($1, $2, 'ข้อความระบบ', true)", [gid, uidB]);
  check('เพื่อนส่ง 2 ข้อความ → ผู้ใช้ A เห็นยังไม่อ่าน 2 (ไม่นับข้อความระบบ)', (await unreadOf(A.cookie)) === 2, String(await unreadOf(A.cookie)));
  check('ข้อความของตัวเองไม่นับเป็นยังไม่อ่านของตัวเอง', (await unreadOf(B.cookie)) === 0);
  const r3 = await call('GET', '/api/chat/suggestion', null, A.cookie);
  check('มีข้อความกลุ่มที่ยังไม่อ่าน → คำแนะนำเตือนให้สรุป/อ่านกลุ่ม', r3.json.suggestion && r3.json.suggestion.text.includes('ยังไม่อ่านในกลุ่ม'), JSON.stringify(r3.json));
  await call('GET', `/api/groups/${gid}/messages`, null, A.cookie);
  await new Promise((r) => setTimeout(r, 300));
  check('เปิดห้องอ่านแล้ว → ยังไม่อ่านกลับเป็น 0', (await unreadOf(A.cookie)) === 0);
  await call('POST', `/api/groups/${gid}/messages`, { content: 'ข้อความใหม่หลังอ่าน' }, B.cookie);
  check('มีข้อความใหม่หลังอ่าน → นับเพิ่มเป็น 1', (await unreadOf(A.cookie)) === 1);
  // สมาชิกที่เพิ่งเข้า (ไม่เคยเปิดห้อง) ไม่ต้องเห็นประวัติเก่าเป็น "ยังไม่อ่าน"
  await query("DELETE FROM chat_group_members WHERE group_id = $1 AND user_id = $2", [gid, uidB]);
  await query("INSERT INTO chat_group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'member', now() + interval '1 minute')", [gid, uidB]);
  check('สมาชิกที่เข้ากลุ่มทีหลัง ไม่ต้องเห็นข้อความก่อนวันที่เข้าเป็นยังไม่อ่าน', (await unreadOf(B.cookie)) === 0);

  // ---------- เก็บกวาด ----------
  const del = await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const left = (await query('SELECT (SELECT count(*)::int FROM suggestion_log WHERE user_id = ANY($1)) AS s, (SELECT count(*)::int FROM chat_groups WHERE name = $2) AS g', [[uidA, uidB], 'กลุ่มทดสอบแจ้งเตือน'])).rows[0];
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (ผู้ใช้ บันทึกคำแนะนำ กลุ่ม)', del.rowCount === 2 && left.s === 0 && left.g === 0, JSON.stringify(left));

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]); } catch { /* ignore */ }
  process.exit(1);
});
