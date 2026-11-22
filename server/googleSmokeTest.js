// ทดสอบ "เลขาค้นข้อมูลภายนอกด้วย Google": สิทธิ์ที่แอดมินกำหนด, คำร้องขอสิทธิ์ทางไลน์, ค้นได้เฉพาะที่ได้รับอนุญาต,
// ข้อมูลจาก Google ห้ามถูกบันทึกเป็นความจำส่วนตัว — โมเดล/ไลน์/ตัวค้น เป็นของจำลองทั้งหมด (ไม่เสียเงิน ไม่ส่งจริง)
//   node server/googleSmokeTest.js   (ผู้ใช้ทดสอบเบอร์ 09999 ลบทิ้งเมื่อจบ)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake';
process.env.LINE_CHANNEL_SECRET = 'test-secret-for-google-test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'test-token';
const crypto = require('crypto');
const app = require('./index');
const ai = require('./ai');
const line = require('./line');
const reflect = require('./reflect');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900051', '0999900052', '0999900053'];
const LINE_ADMIN = 'Utest-google-admin', LINE_U = 'Utest-google-u', LINE_V = 'Utest-google-v';

const sent = [];
line.setSenderForTests(async (path, body) => { sent.push({ path, body }); });

let searchCalls = [];
let topicsSeen = [];
ai.setGoogleSearchForTests(async (q, topic) => { searchCalls.push(q); topicsSeen.push(topic || ''); return { text: 'ราคากุ้งขนาด 50 ตัวต่อกิโลกรัมอยู่ที่ราว 160 บาท', sources: [{ title: 'ตัวอย่าง', uri: 'https://example.com' }] }; });

let lastContents = []; let lastPrompt = ''; let reflectSeen = null;
ai.setCallModelForTests(async ({ systemPrompt, contents }) => {
  if (systemPrompt.startsWith('คุณคือเลขาส่วนตัวที่กำลังทบทวน')) { reflectSeen = contents; return { parts: [{ text: '{"items":[]}' }], usage: {} }; }
  lastPrompt = systemPrompt; lastContents = contents;
  const last = contents[contents.length - 1];
  const fr = last.parts.find((p) => p.functionResponse);
  if (fr) {
    if (fr.functionResponse.name === 'search_the_web' && fr.functionResponse.response && fr.functionResponse.response.ok && lastText(contents).includes('แล้วจำไว้')) {
      return { parts: [{ functionCall: { name: 'save_memory', args: { category: 'ทั่วไป', content: 'ราคากุ้งจาก Google 160 บาท' } } }], usage: {} };
    }
    return { parts: [{ text: 'สรุปให้แล้วค่ะ' }], usage: {} };
  }
  const text = (last.parts[0] && last.parts[0].text) || '';
  if (text.includes('ค้นเลย')) return { parts: [{ functionCall: { name: 'search_the_web', args: { query: 'ราคากุ้งวันนี้' } } }], usage: {} };
  if (text.includes('ค้นสั้น')) return { parts: [{ functionCall: { name: 'search_the_web', args: { query: 'ab' } } }], usage: {} };
  return { parts: [{ text: 'สวัสดีค่ะ' }], usage: {} };
});
function lastText(contents) {
  for (let i = contents.length - 1; i >= 0; i--) { const p = contents[i].parts.find((x) => x.text); if (contents[i].role === 'user' && p) return p.text; }
  return '';
}

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const sign = (obj) => crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(JSON.stringify(obj)).digest('base64');
let evSeq = 0;
async function press(lineUserId, data) {
  const body = { events: [{ type: 'postback', replyToken: 'rt' + (++evSeq), webhookEventId: 'ev-google-' + Date.now() + '-' + evSeq, source: { userId: lineUserId }, postback: { data } }] };
  const r = await fetch(BASE + '/api/line/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) }, body: JSON.stringify(body) });
  await new Promise((res) => setTimeout(res, 1500));
  return r.status;
}
const lastReply = () => { const r = sent.filter((s) => s.path === '/message/reply').pop(); return r ? r.body.messages[0].text : ''; };

(async () => {
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const reg = async (name, phone) => call('POST', '/api/auth/register', { name, phone, pin: '111222' });
  const Ad = await reg('แอดมินทดสอบ', PHONES[0]);
  const U = await reg('ผู้ใช้ ยู', PHONES[1]);
  const V = await reg('ผู้ใช้ วี', PHONES[2]);
  await query('UPDATE users SET is_admin = true, line_user_id = $2 WHERE phone = $1', [PHONES[0], LINE_ADMIN]);
  await query('UPDATE users SET line_user_id = $2 WHERE phone = $1', [PHONES[1], LINE_U]);
  await query('UPDATE users SET line_user_id = $2 WHERE phone = $1', [PHONES[2], LINE_V]);
  await query('UPDATE users SET google_search_enabled = false WHERE phone = ANY($1)', [[PHONES[1], PHONES[2]]]);   // ค่าเริ่มต้นเปิดให้ทุกคนแล้ว — ปิดไว้ก่อนเพื่อทดสอบขั้นตอนขอสิทธิ์
  const uid = async (ph) => (await query('SELECT id FROM users WHERE phone = $1', [ph])).rows[0].id;
  const idU = await uid(PHONES[1]); const idV = await uid(PHONES[2]);
  check('สมัครผู้ใช้ทดสอบ 3 คน', Ad.status === 200 && U.status === 200 && V.status === 200);

  const mkConv = async (cookie) => (await call('POST', '/api/chat/conversations', {}, cookie)).json.conversation;
  const say = (cookie, conv, content) => call('POST', `/api/chat/conversations/${conv.id}/messages`, { content }, cookie);
  const convU = await mkConv(U.cookie);

  check('prompt มีกรอบ: ข้อมูลไม่พอต้องถามก่อนค้น Google + ค้นเฉพาะเรื่อง + ห้ามบันทึกข้อมูลจาก Google', await (async () => {
    await say(U.cookie, convU, 'สวัสดี');
    return lastPrompt.includes('จะให้เลขาหาข้อมูลเพิ่มเติมทาง Google ไหมคะ') && lastPrompt.includes('เฉพาะเรื่องที่ผู้ใช้ต้องการหา') && lastPrompt.includes('ห้ามบันทึกข้อมูลจาก Google ลงความจำเด็ดขาด') && lastPrompt.includes('แสดงความคิดเห็น');
  })());

  // ---------- ยังไม่ได้รับสิทธิ์ → ส่งคำร้องไปทางไลน์ให้แอดมิน ----------
  const r1 = await say(U.cookie, convU, 'ค้นเลย');
  const reqs = (await query("SELECT id, status, topic FROM google_requests WHERE user_id = $1", [idU])).rows;
  const pushToAdmin = sent.filter((s) => s.path === '/message/push' && s.body.to === LINE_ADMIN);
  const btn = pushToAdmin[0] && pushToAdmin[0].body.messages[0].template.actions.map((a) => a.data);
  check('ยังไม่ได้รับสิทธิ์ → ไม่ค้นจริง แต่สร้างคำร้อง 1 รายการ (pending)', searchCalls.length === 0 && reqs.length === 1 && reqs[0].status === 'pending' && reqs[0].topic === 'ราคากุ้งวันนี้', JSON.stringify(reqs));
  check('ส่งคำร้องเข้าไลน์แอดมินพร้อมปุ่ม อนุญาต/ไม่อนุญาต', pushToAdmin.length === 1 && btn && btn.some((d) => d.startsWith('act=google&d=approve&id=')) && btn.some((d) => d.startsWith('act=google&d=deny&id=')));
  check('ผู้ใช้ได้คำตอบปกติ ไม่พัง', r1.status === 200 && r1.json.reply === 'สรุปให้แล้วค่ะ');
  await say(U.cookie, convU, 'ค้นเลย');
  check('ขอซ้ำตอนยังรออยู่ → ไม่สร้างคำร้องซ้ำ ไม่ส่งไลน์ซ้ำ', (await query("SELECT count(*)::int n FROM google_requests WHERE user_id = $1", [idU])).rows[0].n === 1 && sent.filter((s) => s.path === '/message/push' && s.body.to === LINE_ADMIN).length === 1);

  // ---------- คนที่ไม่ใช่แอดมินกดอนุญาตเองไม่ได้ ----------
  const reqId = reqs[0].id;
  await press(LINE_U, `act=google&d=approve&id=${reqId}`);
  check('ผู้ใช้ทั่วไปกดอนุญาตให้ตัวเองไม่ได้', (await query('SELECT google_search_enabled FROM users WHERE id = $1', [idU])).rows[0].google_search_enabled === false && lastReply().includes('เฉพาะแอดมิน'), lastReply());
  // ---------- แอดมินอนุญาต ----------
  await press(LINE_ADMIN, `act=google&d=approve&id=${reqId}`);
  const afterAp = (await query('SELECT google_search_enabled FROM users WHERE id = $1', [idU])).rows[0].google_search_enabled;
  check('แอดมินกดอนุญาตในไลน์ → เปิดสิทธิ์ให้ผู้ขอ', afterAp === true);
  check('แจ้งผู้ขอทางไลน์ว่าอนุญาตแล้ว', sent.some((s) => s.path === '/message/push' && s.body.to === LINE_U && JSON.stringify(s.body).includes('อนุญาต')));
  await press(LINE_ADMIN, `act=google&d=deny&id=${reqId}`);
  check('คำร้องที่ตัดสินแล้ว กดซ้ำไม่ได้ (ไม่เปลี่ยนผล)', (await query("SELECT status FROM google_requests WHERE id = $1", [reqId])).rows[0].status === 'approved' && (await query('SELECT google_search_enabled FROM users WHERE id = $1', [idU])).rows[0].google_search_enabled === true);

  // ---------- ได้รับสิทธิ์แล้ว → ค้นได้เลย ไม่ต้องส่งคำร้อง ----------
  const pushesBefore = sent.filter((s) => s.path === '/message/push').length;
  const r2 = await say(U.cookie, convU, 'ค้นเลย');
  const msgs = (await query("SELECT role, source FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 2", [convU.id])).rows;
  check('มีสิทธิ์แล้ว → ค้นจริง 1 ครั้ง ด้วยคำค้นที่เลขาตั้ง', searchCalls.length === 1 && searchCalls[0] === 'ราคากุ้งวันนี้', JSON.stringify(searchCalls));
  check('ไม่ส่งคำร้อง/ไลน์ซ้ำอีก ตอนที่เปิดสิทธิ์อยู่แล้ว', sent.filter((s) => s.path === '/message/push').length === pushesBefore && (await query("SELECT count(*)::int n FROM google_requests WHERE user_id = $1", [idU])).rows[0].n === 1);
  check('นับจำนวนครั้งที่ค้น (1) + ข้อความเลขาติดป้าย source = google', (await query('SELECT google_search_count FROM users WHERE id = $1', [idU])).rows[0].google_search_count === 1 && msgs.find((m) => m.role === 'assistant').source === 'google');
  const sum = await call('GET', '/api/me/summary', null, U.cookie);
  check('แถบในโปรไฟล์เห็นจำนวนครั้งที่ใช้', sum.json.google.enabled === true && sum.json.google.count === 1);

  // ---------- ข้อมูลจาก Google ห้ามถูกบันทึกเป็นความจำ ----------
  const memBefore = (await query('SELECT count(*)::int n FROM memories WHERE owner_id = $1', [idU])).rows[0].n;
  await say(U.cookie, convU, 'ค้นเลย แล้วจำไว้');
  const memAfter = (await query('SELECT count(*)::int n FROM memories WHERE owner_id = $1', [idU])).rows[0].n;
  check('หลังได้ข้อมูลจาก Google ในรอบเดียวกัน → save_memory ถูกบล็อก ไม่มีความจำใหม่', memAfter === memBefore && !(await query("SELECT 1 FROM memories WHERE owner_id = $1 AND content LIKE '%Google%'", [idU])).rows[0], `${memBefore}→${memAfter}`);
  await say(U.cookie, convU, 'สวัสดี');
  const flat = JSON.stringify(lastContents);
  check('รอบถัดไปโมเดลเห็นป้าย "[ข้อมูลจาก Google" ที่ข้อความเลขาเดิม (รู้ว่าเป็นข้อมูลภายนอก)', flat.includes('[ข้อมูลจาก Google'));
  const hist = await call('GET', `/api/chat/conversations/${convU.id}/messages`, null, U.cookie);
  check('ผู้ใช้เห็นข้อความเดิมในแอป ไม่มีป้ายแปะ', hist.json.messages.every((m) => !m.content.includes('[ข้อมูลจาก Google')));
  reflectSeen = null;
  await reflect.reflectConversation(idU, convU.id);
  check('ตอนเลขาไตร่ตรองบทสนทนา ข้อความจาก Google ถูกติดป้ายห้ามบันทึก', reflectSeen && JSON.stringify(reflectSeen).includes('ข้อมูลภายนอกจาก Google ห้ามบันทึก'));

  // ---------- ค้นตามหัวข้อ: เลือกหมวดไว้ → ค้นเฉพาะเรื่องที่เกี่ยวกับหมวดนั้น / ไม่เลือก → อิสระ ----------
  topicsSeen = [];
  await call('POST', `/api/chat/conversations/${convU.id}/messages`, { content: 'ค้นเลย', focusCategory: 'กุ้ง' }, U.cookie);
  await say(U.cookie, convU, 'ค้นเลย');
  check('เลือกหมวดไว้ → ส่งหัวข้อไปกำกับการค้น / ไม่เลือก → ค้นอิสระ (ไม่มีหัวข้อกำกับ)', topicsSeen.length === 2 && topicsSeen[0] === 'กุ้ง' && topicsSeen[1] === '', JSON.stringify(topicsSeen));
  check('prompt: ผลค้นยาว → สรุปเป็นข้อ 1-5 ไม่เกิน 5 ข้อก่อน แล้วค่อยสนทนาลงลึก', lastPrompt.includes('ไม่เกิน 5 ข้อ ก่อน') && lastPrompt.includes('ขยายความข้อไหนต่อ'));
  check('prompt: ผู้ใช้สั่งค้นเอง = ยืนยันในตัว ไม่ต้องถามซ้ำ + มีกฎค้นเฉพาะหัวข้อที่เลือก', lastPrompt.includes('ถือว่าเป็นการยืนยันในตัวแล้ว') && lastPrompt.includes('ค้นเฉพาะข้อมูลที่เกี่ยวข้องกับหัวข้อนั้นเท่านั้น'));
  // ป้ายภายในที่โมเดลเลียนแบบ ต้องถูกตัดก่อนแสดงผู้ใช้ — จำลองโดยดูผ่านคำตอบจริงจากเซิร์ฟเวอร์ไม่ได้ จึงทดสอบ regex เดียวกัน
  check('ตัดป้ายภายใน "[ข้อมูลจาก Google …]" ออกจากต้นคำตอบ', '[ข้อมูลจาก Google — ข้อมูลภายนอก ห้ามบันทึกลงความจำ] ราคากุ้ง 160'.replace(/^\s*\[ข้อมูลจาก Google[^\]]*\]\s*/, '') === 'ราคากุ้ง 160');

  // ---------- โควตา/คำค้นไม่ผ่าน ----------
  const calls2 = searchCalls.length;
  await say(U.cookie, convU, 'ค้นสั้น');
  check('คำค้นสั้นเกินไป → ไม่ค้น ไม่นับ', searchCalls.length === calls2);
  const cnt = (await query('SELECT google_search_count FROM users WHERE id = $1', [idU])).rows[0].google_search_count;
  const monthNow = require('./webSearch').currentMonth();
  await query('UPDATE users SET google_search_count = 100000, google_search_month = $2 WHERE id = $1', [idU, monthNow]);
  await say(U.cookie, convU, 'ค้นเลย');
  check('ใช้ครบโควตา → ไม่ค้นเพิ่ม', searchCalls.length === calls2);
  await query('UPDATE users SET google_search_count = $2 WHERE id = $1', [idU, cnt]);
  // รายเดือน: ตัวนับของเดือนเก่าถือเป็น 0 (รีเซ็ตเองตอนขึ้นเดือนใหม่) แล้วเริ่มนับที่ 1
  await query("UPDATE users SET google_search_count = 100000, google_search_month = '2020-01' WHERE id = $1", [idU]);
  const sumOld = await call('GET', '/api/me/summary', null, U.cookie);
  check('ตัวนับของเดือนเก่า → แถบโปรไฟล์ขึ้น 0 (รีเซ็ตแล้ว)', sumOld.json.google.count === 0, String(sumOld.json.google.count));
  const callsBefore = searchCalls.length;
  await say(U.cookie, convU, 'ค้นเลย');
  const rowM = (await query('SELECT google_search_count, google_search_month FROM users WHERE id = $1', [idU])).rows[0];
  check('ขึ้นเดือนใหม่ → ค้นได้อีก และเริ่มนับที่ 1 ของเดือนนี้', searchCalls.length === callsBefore + 1 && rowM.google_search_count === 1 && rowM.google_search_month === monthNow, JSON.stringify(rowM));

  // ---------- แอดมินปฏิเสธ + ขอซ้ำเร็วเกินไป ----------
  const convV = await mkConv(V.cookie);
  await say(V.cookie, convV, 'ค้นเลย');
  const reqV = (await query("SELECT id FROM google_requests WHERE user_id = $1 AND status = 'pending'", [idV])).rows[0];
  await press(LINE_ADMIN, `act=google&d=deny&id=${reqV.id}`);
  check('แอดมินกดไม่อนุญาต → ไม่เปิดสิทธิ์', (await query('SELECT google_search_enabled FROM users WHERE id = $1', [idV])).rows[0].google_search_enabled === false && (await query("SELECT status FROM google_requests WHERE id = $1", [reqV.id])).rows[0].status === 'denied');
  const pushN = sent.filter((s) => s.path === '/message/push' && s.body.to === LINE_ADMIN).length;
  await say(V.cookie, convV, 'ค้นเลย');
  check('ถูกปฏิเสธไปไม่นาน ขอซ้ำ → ไม่ส่งไลน์รบกวนแอดมินอีก และไม่ค้น', sent.filter((s) => s.path === '/message/push' && s.body.to === LINE_ADMIN).length === pushN && searchCalls.length === callsBefore + 1);

  // ---------- เก็บกวาด ----------
  await new Promise((r) => setTimeout(r, 300));
  const del = await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const left = (await query('SELECT (SELECT count(*)::int FROM users WHERE phone = ANY($1)) AS u, (SELECT count(*)::int FROM google_requests WHERE user_id = ANY($2)) AS r', [PHONES, [idU, idV]])).rows[0];
  check('ลบข้อมูลทดสอบหมดเกลี้ยง', del.rowCount === 3 && left.u === 0 && left.r === 0, JSON.stringify(left));

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]); } catch { /* ignore */ }
  process.exit(1);
});
