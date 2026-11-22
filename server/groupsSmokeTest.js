// ทดสอบกลุ่มสนทนา: สร้าง (คนละ ≤2), ขอเข้าร่วม → ผู้สร้างอนุญาต (ผ่าน API และปุ่มไลน์), แชทแสดงชื่อ+รูปคนส่ง, สิทธิ์เฉพาะสมาชิก
//   node server/groupsSmokeTest.js   (ไลน์เป็นตัวจำลอง ไม่ส่งจริง • ผู้ใช้ทดสอบเบอร์ 09999 ลบทิ้งเมื่อจบ)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.LINE_CHANNEL_SECRET = 'test-secret-for-groups-test';
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'test-token';
const crypto = require('crypto');
const app = require('./index');
const line = require('./line');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900061', '0999900062', '0999900063'];
const LINE_A = 'Utest-group-a', LINE_B = 'Utest-group-b';
const sent = [];
line.setSenderForTests(async (path, body) => { sent.push({ path, body }); });

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const sign = (obj) => crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(JSON.stringify(obj)).digest('base64');
let seq = 0;
async function press(lineUserId, data) {
  const body = { events: [{ type: 'postback', replyToken: 'rt' + (++seq), webhookEventId: 'ev-group-' + Date.now() + '-' + seq, source: { userId: lineUserId }, postback: { data } }] };
  await fetch(BASE + '/api/line/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) }, body: JSON.stringify(body) });
  await new Promise((r) => setTimeout(r, 1500));
}
const lastReply = () => { const r = sent.filter((s) => s.path === '/message/reply').pop(); return r ? r.body.messages[0].text : ''; };

(async () => {
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const reg = (name, phone) => call('POST', '/api/auth/register', { name, phone, pin: '111222' });
  const A = await reg('ผู้สร้าง เอ', PHONES[0]);
  const B = await reg('สมาชิก บี', PHONES[1]);
  const C = await reg('คนนอก ซี', PHONES[2]);
  await query('UPDATE users SET line_user_id = $2, line_picture_url = $3 WHERE phone = $1', [PHONES[0], LINE_A, 'https://profile.line-scdn.net/abc123/pic-a']);
  await query('UPDATE users SET line_user_id = $2, call_name = $3 WHERE phone = $1', [PHONES[1], LINE_B, 'บี']);
  const uidB = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[1]])).rows[0].id;
  check('สมัครผู้ใช้ทดสอบ 3 คน', A.status === 200 && B.status === 200 && C.status === 200);
  check('ไม่ล็อกอินเข้าถึงกลุ่มไม่ได้ (401)', (await call('GET', '/api/groups')).status === 401);

  // ---------- สร้างกลุ่ม (คนละไม่เกิน 2) ----------
  const g1 = await call('POST', '/api/groups', { name: 'ชาวบ่อกุ้ง ทดสอบ', description: 'คุยเรื่องกุ้ง' }, A.cookie);
  const g2 = await call('POST', '/api/groups', { name: 'กลุ่มสอง ทดสอบ' }, A.cookie);
  const g3 = await call('POST', '/api/groups', { name: 'กลุ่มสาม ทดสอบ' }, A.cookie);
  check('สร้างได้ 2 กลุ่ม แต่กลุ่มที่ 3 ถูกปฏิเสธ (สร้างได้แค่ 2 กลุ่ม)', g1.status === 200 && g2.status === 200 && g3.status === 400 && /ไม่เกิน 2 กลุ่ม/.test(g3.json.error || ''), g3.json.error);
  const gid = g1.json.group.id;
  check('ผู้สร้างเป็นแอดมินกลุ่มโดยอัตโนมัติ', (await query("SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = (SELECT id FROM users WHERE phone = $2)", [gid, PHONES[0]])).rows[0].role === 'admin');
  check('ชื่อซ้ำ (ไม่สนตัวพิมพ์) / ชื่อสั้นไป / ชื่อมีอักขระต้องห้าม → ถูกปฏิเสธ', (await call('POST', '/api/groups', { name: 'ชาวบ่อกุ้ง ทดสอบ' }, B.cookie)).status === 400 && (await call('POST', '/api/groups', { name: 'ก' }, B.cookie)).status === 400 && (await call('POST', '/api/groups', { name: 'x<b>' }, B.cookie)).status === 400);
  // สร้างพร้อมกันหลายคำขอ ต้องไม่เกิน 2 (B สร้าง 4 พร้อมกัน)
  const burst = await Promise.all([1, 2, 3, 4].map((i) => call('POST', '/api/groups', { name: 'แข่งกันสร้าง ' + i }, B.cookie)));
  check('B สร้างพร้อมกัน 4 คำขอ → สำเร็จได้ไม่เกิน 2 กลุ่ม', burst.filter((x) => x.status === 200).length === 2, String(burst.filter((x) => x.status === 200).length));

  // ---------- ดูกลุ่มทั้งหมด + ขอเข้าร่วม ----------
  const listC = await call('GET', '/api/groups', null, C.cookie);
  const seen = listC.json.groups.find((g) => g.id === gid);
  check('ดูกลุ่มทั้งหมดได้ (ชื่อ/คำอธิบาย/จำนวนสมาชิก/ผู้สร้าง) และสถานะของ C = ยังไม่เข้าร่วม', seen && seen.members === 1 && seen.description === 'คุยเรื่องกุ้ง' && seen.myRole === null && seen.pending === false && seen.ownerName === 'ผู้สร้าง เอ', JSON.stringify(seen));
  check('คนนอกอ่านแชท/ข้อมูลกลุ่ม/ส่งข้อความไม่ได้', (await call('GET', `/api/groups/${gid}/messages`, null, C.cookie)).status === 403 && (await call('GET', `/api/groups/${gid}`, null, C.cookie)).status === 403 && (await call('POST', `/api/groups/${gid}/messages`, { content: 'แอบ' }, C.cookie)).status === 400);
  const j1 = await call('POST', `/api/groups/${gid}/join`, {}, B.cookie);
  const j2 = await call('POST', `/api/groups/${gid}/join`, {}, B.cookie);
  const reqRows = (await query("SELECT id, status FROM chat_group_requests WHERE group_id = $1 AND user_id = $2", [gid, uidB])).rows;
  check('ขอเข้าร่วม → pending (ขอซ้ำไม่สร้างซ้ำ)', j1.json.status === 'pending' && j2.json.alreadyExisted === true && reqRows.length === 1 && reqRows[0].status === 'pending');
  const pushed = sent.filter((s) => s.path === '/message/push' && s.body.to === LINE_A);
  check('ส่งไลน์หาผู้สร้างพร้อมปุ่ม อนุญาต/ไม่อนุญาต', pushed.length === 1 && pushed[0].body.messages[0].template.actions.some((a) => a.data.startsWith('act=group&d=approve&id=')));
  check('B ยังเข้าแชทไม่ได้ระหว่างรออนุญาต', (await call('GET', `/api/groups/${gid}/messages`, null, B.cookie)).status === 403);
  const ginfo = await call('GET', `/api/groups/${gid}`, null, A.cookie);
  check('แอดมินกลุ่มเห็นคำขอที่รออยู่ (ชื่อ B)', ginfo.json.isAdmin === true && ginfo.json.requests.length === 1 && ginfo.json.requests[0].name === 'บี');
  const listA = await call('GET', '/api/groups', null, A.cookie);
  check('รายการกลุ่มของผู้สร้างบอกจำนวนคำขอที่รอ', listA.json.groups.find((g) => g.id === gid).pendingRequests === 1 && listA.json.createdByMe === 2 && listA.json.maxCreate === 2);

  // ---------- ผู้สร้างอนุญาต ----------
  check('B (ไม่ใช่ผู้สร้าง) อนุญาตให้ตัวเองไม่ได้', (await call('POST', `/api/groups/requests/${reqRows[0].id}/decide`, { approve: true }, B.cookie)).status === 400);
  await press(LINE_B, `act=group&d=approve&id=${reqRows[0].id}`);
  check('ปุ่มไลน์ของคนที่ไม่ใช่ผู้สร้างใช้ไม่ได้', lastReply().includes('เฉพาะผู้สร้างกลุ่ม') && (await query("SELECT status FROM chat_group_requests WHERE id = $1", [reqRows[0].id])).rows[0].status === 'pending', lastReply());
  await press(LINE_A, `act=group&d=approve&id=${reqRows[0].id}`);
  check('ผู้สร้างกดอนุญาตในไลน์ → B เป็นสมาชิก + แจ้ง B ทางไลน์', (await query("SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2", [gid, uidB])).rows[0].role === 'member' && sent.some((s) => s.path === '/message/push' && s.body.to === LINE_B));
  await press(LINE_A, `act=group&d=deny&id=${reqRows[0].id}`);
  check('กดซ้ำหลังตัดสินแล้ว ไม่เปลี่ยนผล', (await query("SELECT status FROM chat_group_requests WHERE id = $1", [reqRows[0].id])).rows[0].status === 'approved');

  // ---------- แชทกลุ่ม แสดงรูปโปรไฟล์ของแต่ละคน ----------
  const m1 = await call('POST', `/api/groups/${gid}/messages`, { content: 'สวัสดีครับทุกคน' }, A.cookie);
  const m2 = await call('POST', `/api/groups/${gid}/messages`, { content: 'สวัสดีครับ ผมบี' }, B.cookie);
  const msgs = await call('GET', `/api/groups/${gid}/messages`, null, B.cookie);
  const ma = msgs.json.messages.find((m) => m.content === 'สวัสดีครับทุกคน'); const mb = msgs.json.messages.find((m) => m.content === 'สวัสดีครับ ผมบี');
  check('ส่ง/อ่านข้อความในกลุ่มได้ เรียงเก่า→ใหม่', m1.status === 200 && m2.status === 200 && msgs.json.messages.length === 2 && msgs.json.messages[0].id < msgs.json.messages[1].id);
  check('แต่ละข้อความแนบชื่อและรูปโปรไฟล์คนส่ง (รูปไลน์ของ A, B ไม่มีรูป, ชื่อที่ให้เรียกของ B)', ma.name === 'ผู้สร้าง เอ' && ma.picture === 'https://profile.line-scdn.net/abc123/pic-a' && mb.name === 'บี' && mb.picture === null && mb.mine === true && ma.mine === false);
  const afterId = msgs.json.messages[1].id;
  await call('POST', `/api/groups/${gid}/messages`, { content: 'ข้อความใหม่' }, A.cookie);
  const inc = await call('GET', `/api/groups/${gid}/messages?after=${afterId}`, null, B.cookie);
  check('ดึงเฉพาะข้อความใหม่ (after=id) ได้ (ใช้ polling)', inc.json.messages.length === 1 && inc.json.messages[0].content === 'ข้อความใหม่');
  await query("UPDATE users SET line_picture_url = 'https://evil.example.com/x.png' WHERE phone = $1", [PHONES[0]]);
  const evil = (await call('GET', `/api/groups/${gid}/messages`, null, B.cookie)).json.messages.find((m) => m.content === 'สวัสดีครับทุกคน');
  check('รูปจากโดเมนนอก LINE ไม่ถูกส่งต่อ (กันโหลดรูปจากที่ไม่รู้จัก)', evil.picture === null);
  check('ข้อความว่าง/ยาวเกิน 1000 ตัวอักษร → ปฏิเสธ', (await call('POST', `/api/groups/${gid}/messages`, { content: '   ' }, A.cookie)).status === 400 && (await call('POST', `/api/groups/${gid}/messages`, { content: 'ก'.repeat(1001) }, A.cookie)).status === 400);
  // สแปม: 20 ข้อความ/นาที/คน (A ส่งไปแล้ว 3)
  let blocked = false; for (let i = 0; i < 25; i++) { const r = await call('POST', `/api/groups/${gid}/messages`, { content: 'สแปม ' + i }, A.cookie); if (r.status === 400 && /ถี่/.test(r.json.error || '')) { blocked = true; break; } }
  check('ส่งถี่เกินกำหนดต่อนาที → ถูกจำกัด', blocked);
  const gB = await call('GET', `/api/groups/${gid}`, null, B.cookie);
  check('สมาชิกเห็นรายชื่อสมาชิก (ชื่อ+รูป) แต่ไม่เห็นคำขอของกลุ่ม', gB.status === 200 && gB.json.members.length === 2 && gB.json.isAdmin === false && gB.json.requests.length === 0);

  // ---------- เชิญเข้ากลุ่ม (แอดมินเลือกจากรายชื่อทั้งระบบ → ผู้ถูกเชิญตอบรับเอง) ----------
  const LINE_C = 'Utest-group-c';
  await query('UPDATE users SET line_user_id = $2 WHERE phone = $1', [PHONES[2], LINE_C]);
  const idC0 = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[2]])).rows[0].id;
  check('สมาชิกทั่วไปดูรายชื่อที่เชิญได้/เชิญคนไม่ได้ (เฉพาะแอดมินกลุ่ม)', (await call('GET', `/api/groups/${gid}/invite-candidates`, null, B.cookie)).status === 403 && (await call('POST', `/api/groups/${gid}/invites`, { userId: idC0 }, B.cookie)).status === 400);
  const cand = await call('GET', `/api/groups/${gid}/invite-candidates?q=${encodeURIComponent('คนนอก')}`, null, A.cookie);
  check('แอดมินค้นรายชื่อจากทั้งระบบด้วยชื่อได้ (เห็นชื่อ+รูป)', cand.status === 200 && cand.json.users.length === 1 && cand.json.users[0].name === 'คนนอก ซี' && 'picture' in cand.json.users[0] && cand.json.users[0].invited === false, JSON.stringify(cand.json.users));
  const candAll = await call('GET', `/api/groups/${gid}/invite-candidates`, null, A.cookie);
  const allStr = JSON.stringify(candAll.json);
  check('รายชื่อไม่รวมตัวเอง/สมาชิกอยู่แล้ว และไม่เผยเบอร์โทร/PIN/ไลน์ไอดี', !candAll.json.users.some((u) => u.name === 'ผู้สร้าง เอ' || u.name === 'บี') && !PHONES.some((ph) => allStr.includes(ph)) && !allStr.includes('line_user_id') && !allStr.includes('pin') && candAll.json.users.every((u) => !u.userId || true));
  const inv1 = await call('POST', `/api/groups/${gid}/invites`, { userId: idC0 }, A.cookie);
  const pushC = sent.filter((x) => x.path === '/message/push' && x.body.to === LINE_C);
  check('เชิญ C → ส่งไลน์หา C พร้อมปุ่ม ตอบรับ/ปฏิเสธ', inv1.status === 200 && pushC.length === 1 && pushC[0].body.messages[0].template.actions.some((x) => x.data.startsWith('act=ginvite&d=accept&id=')) && pushC[0].body.messages[0].template.actions.some((x) => x.data.startsWith('act=ginvite&d=decline&id=')));
  check('เชิญซ้ำตอนยังรออยู่ไม่ได้ / เชิญตัวเอง / เชิญสมาชิกเดิม / ผู้ใช้ที่ไม่มีจริง → ปฏิเสธ', (await call('POST', `/api/groups/${gid}/invites`, { userId: idC0 }, A.cookie)).status === 400
    && (await call('POST', `/api/groups/${gid}/invites`, { userId: (await query('SELECT id FROM users WHERE phone = $1', [PHONES[0]])).rows[0].id }, A.cookie)).status === 400
    && (await call('POST', `/api/groups/${gid}/invites`, { userId: uidB }, A.cookie)).status === 400
    && (await call('POST', `/api/groups/${gid}/invites`, { userId: '00000000-0000-0000-0000-000000000000' }, A.cookie)).status === 400);
  check('รายชื่อบอกว่า C ถูกเชิญค้างอยู่ (invited = true)', (await call('GET', `/api/groups/${gid}/invite-candidates?q=${encodeURIComponent('คนนอก')}`, null, A.cookie)).json.users[0].invited === true);
  const mine = await call('GET', '/api/groups/invites', null, C.cookie);
  check('C เห็นคำเชิญ (ชื่อกลุ่ม + ผู้เชิญ)', mine.json.invites.length === 1 && mine.json.invites[0].groupName === 'ชาวบ่อกุ้ง ทดสอบ' && mine.json.invites[0].inviterName === 'ผู้สร้าง เอ' && 'inviterPicture' in mine.json.invites[0], JSON.stringify(mine.json.invites));
  const invId = mine.json.invites[0].id;
  check('คนอื่น (B) ตอบคำเชิญของ C แทนไม่ได้ และไม่เห็นคำเชิญของ C', (await call('POST', `/api/groups/invites/${invId}/respond`, { accept: true }, B.cookie)).status === 400 && (await call('GET', '/api/groups/invites', null, B.cookie)).json.invites.length === 0);
  check('C ปฏิเสธคำเชิญได้ → ไม่เป็นสมาชิก และตอบซ้ำไม่ได้', (await call('POST', `/api/groups/invites/${invId}/respond`, { accept: false }, C.cookie)).status === 200 && !(await query('SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [gid, idC0])).rows[0] && (await call('POST', `/api/groups/invites/${invId}/respond`, { accept: true }, C.cookie)).status === 400);
  await call('POST', `/api/groups/${gid}/invites`, { userId: idC0 }, A.cookie);
  const pushC2 = sent.filter((x) => x.path === '/message/push' && x.body.to === LINE_C).pop();
  const acceptData = pushC2.body.messages[0].template.actions.find((x) => x.data.includes('d=accept')).data;
  await press(LINE_B, acceptData);
  check('ปุ่มไลน์ของคนอื่นตอบรับแทน C ไม่ได้', !(await query('SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [gid, idC0])).rows[0] && /ไม่ใช่ของคุณ/.test(lastReply()), lastReply());
  await press(LINE_C, acceptData);
  check('C กดตอบรับในไลน์ → เป็นสมาชิก และเข้าแชทกลุ่มได้', (await query("SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2", [gid, idC0])).rows[0].role === 'member' && (await call('GET', `/api/groups/${gid}/messages`, null, C.cookie)).status === 200);
  check('เป็นสมาชิกแล้วหายจากรายชื่อที่เชิญได้ และไม่มีคำเชิญค้าง', !(await call('GET', `/api/groups/${gid}/invite-candidates`, null, A.cookie)).json.users.some((u) => u.name === 'คนนอก ซี') && (await call('GET', '/api/groups/invites', null, C.cookie)).json.invites.length === 0);
  await query("UPDATE users SET status = 'suspended' WHERE phone = $1", [PHONES[2]]);
  check('บัญชีที่ถูกระงับไม่อยู่ในรายชื่อที่เชิญได้', !(await call('GET', `/api/groups/${g2.json.group.id}/invite-candidates?q=${encodeURIComponent('คนนอก')}`, null, A.cookie)).json.users.length);
  await query("UPDATE users SET status = 'active' WHERE phone = $1", [PHONES[2]]);

  // ---------- ออก/ลบกลุ่ม ----------
  check('ผู้สร้างออกจากกลุ่มตัวเองไม่ได้', (await call('POST', `/api/groups/${gid}/leave`, {}, A.cookie)).status === 400);
  check('สมาชิกออกจากกลุ่มได้ และเข้าแชทไม่ได้อีก', (await call('POST', `/api/groups/${gid}/leave`, {}, B.cookie)).status === 200 && (await call('GET', `/api/groups/${gid}/messages`, null, B.cookie)).status === 403);
  check('คนอื่นลบกลุ่มของผู้สร้างไม่ได้', (await call('DELETE', `/api/groups/${gid}`, null, B.cookie)).status === 400);
  check('ผู้สร้างลบกลุ่มได้ (ข้อความหายหมด) และคืนโควตาให้สร้างใหม่ได้', (await call('DELETE', `/api/groups/${gid}`, null, A.cookie)).status === 200 && (await query('SELECT count(*)::int n FROM chat_group_messages WHERE group_id = $1', [gid])).rows[0].n === 0 && (await call('POST', '/api/groups', { name: 'กลุ่มใหม่หลังลบ' }, A.cookie)).status === 200);

  // ---------- เข้าร่วมกลุ่มได้ไม่เกิน 3 กลุ่ม (ไม่นับกลุ่มที่ตัวเองสร้าง) ----------
  const owned = (await query("SELECT g.id, g.owner_id, u.phone FROM chat_groups g JOIN users u ON u.id = g.owner_id WHERE u.phone = ANY($1) ORDER BY g.created_at", [[PHONES[0], PHONES[1]]])).rows;
  const ckFor = (phone) => (phone === PHONES[0] ? A.cookie : B.cookie);
  check('มีกลุ่มของคนอื่น 4 กลุ่มให้ C ลองขอเข้าร่วม', owned.length === 4, String(owned.length));
  for (const g of owned) await call('POST', `/api/groups/${g.id}/join`, {}, C.cookie);
  const idC = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[2]])).rows[0].id;
  const pendC = (await query("SELECT r.id, r.group_id FROM chat_group_requests r WHERE r.user_id = $1 AND r.status = 'pending' ORDER BY r.created_at", [idC])).rows;
  const approveRes = [];
  for (const rq of pendC) { const owner = owned.find((g) => g.id === rq.group_id); approveRes.push((await call('POST', `/api/groups/requests/${rq.id}/decide`, { approve: true }, ckFor(owner.phone))).status); }
  check('อนุมัติคำขอของ C ได้ 3 กลุ่มแรก กลุ่มที่ 4 ถูกปฏิเสธ (เกินเพดานเข้าร่วม 3 กลุ่ม)', approveRes.filter((x) => x === 200).length === 3 && approveRes.filter((x) => x === 400).length === 1, JSON.stringify(approveRes));
  const lastPending = pendC[approveRes.findIndex((x) => x === 400)];
  check('คำขอที่เกินเพดานยังรออยู่ (ผู้สร้างกดไม่อนุญาตได้) และ C ไม่ได้เป็นสมาชิกกลุ่มนั้น', (await query("SELECT status FROM chat_group_requests WHERE id = $1", [lastPending.id])).rows[0].status === 'pending' && !(await query('SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [lastPending.group_id, idC])).rows[0]);
  await call('POST', `/api/groups/requests/${lastPending.id}/decide`, { approve: false }, ckFor(owned.find((g) => g.id === lastPending.group_id).phone));
  const joinedList = await call('GET', '/api/groups', null, C.cookie);
  check('รายการกลุ่มของ C บอกจำนวนที่เข้าร่วม 3/3', joinedList.json.joinedByMe === 3 && joinedList.json.maxJoin === 3 && joinedList.json.createdByMe === 0, JSON.stringify([joinedList.json.joinedByMe, joinedList.json.maxJoin]));
  const ownerOfLast = owned.find((g) => g.id === lastPending.group_id);
  check('คนที่เข้าร่วมครบ 3 กลุ่มแล้วถูกเชิญไม่ได้ (บอกเหตุผล)', await (async () => { const r = await call('POST', `/api/groups/${lastPending.group_id}/invites`, { userId: idC }, ckFor(ownerOfLast.phone)); return r.status === 400 && /ครบ 3 กลุ่ม/.test(r.json.error || ''); })());
  const extra = owned.find((g) => !(g.id === lastPending.group_id) && false) || { id: lastPending.group_id };
  const again = await call('POST', `/api/groups/${extra.id}/join`, {}, C.cookie);
  check('ครบ 3 กลุ่มแล้วขอเข้ากลุ่มที่ 4 ไม่ได้ (ตั้งแต่ตอนขอ)', again.status === 400 && /ไม่เกิน 3 กลุ่ม/.test(again.json.error || ''), again.json.error);
  const someC = joinedList.json.groups.find((g) => g.myRole === 'member');
  await call('POST', `/api/groups/${someC.id}/leave`, {}, C.cookie);
  check('ออกจากกลุ่มหนึ่งแล้วขอเข้ากลุ่มใหม่ได้อีก (คืนโควตาเข้าร่วม)', (await call('POST', `/api/groups/${extra.id}/join`, {}, C.cookie)).status === 200);

  // ---------- เก็บกวาด ----------
  await new Promise((r) => setTimeout(r, 300));
  const del = await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const left = (await query("SELECT (SELECT count(*)::int FROM users WHERE phone = ANY($1)) AS u, (SELECT count(*)::int FROM chat_groups WHERE name LIKE '%ทดสอบ%' OR name LIKE 'แข่งกันสร้าง%' OR name = 'กลุ่มใหม่หลังลบ') AS g", [PHONES])).rows[0];
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (ผู้ใช้ + กลุ่มที่ผูกอยู่)', del.rowCount === 3 && left.u === 0 && left.g === 0, JSON.stringify(left));

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]); } catch { /* ignore */ }
  process.exit(1);
});
