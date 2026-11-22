// กลุ่มสนทนาบนแพลตฟอร์ม: ทุกฟังก์ชันรับ userId จากเซสชันฝั่งเซิร์ฟเวอร์เสมอ (ไม่รับจากผู้ใช้/AI)
// กติกา (เจ้าของกำหนด): ผู้สร้างเป็นแอดมินกลุ่ม • สร้างได้คนละไม่เกิน 2 กลุ่ม • คนอื่นต้องขอเข้าร่วมและผู้สร้างกดอนุญาต • แชทแสดงรูปโปรไฟล์คนส่ง
const { query, withTransaction } = require('./db');
const line = require('./line');

const MAX_GROUPS_PER_USER = 2;   // สร้างกลุ่มได้คนละกี่กลุ่ม
const MAX_JOINED_PER_USER = 3;   // เข้าร่วมกลุ่มของคนอื่นได้คนละกี่กลุ่ม (ไม่นับกลุ่มที่ตัวเองสร้าง)
const MAX_MESSAGE_CHARS = 1000;
const MSG_PER_MIN = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneLine = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').split(/\s+/).join(' ').trim();
// ชื่อที่โชว์ในกลุ่ม = ชื่อที่ผู้ใช้ตั้งให้เรียก (ถ้ามี) ไม่งั้นชื่อที่สมัคร; รูป = รูปโปรไฟล์ไลน์ (เฉพาะโดเมนรูปของ LINE)
const DISPLAY = "COALESCE(NULLIF(u.call_name, ''), u.name)";
const picOf = (u) => line.safePictureUrl(u) || null;

function cleanGroupName(raw) {
  const n = oneLine(raw);
  if (n.length < 2) throw new Error('ชื่อกลุ่มต้องมีอย่างน้อย 2 ตัวอักษร');
  if (n.length > 40) throw new Error('ชื่อกลุ่มยาวเกิน 40 ตัวอักษร');
  if (/[<>`{}"\\]/.test(n)) throw new Error('ชื่อกลุ่มมีตัวอักษรที่ใช้ไม่ได้');
  return n;
}

async function createGroup(userId, rawName, rawDesc) {
  const name = cleanGroupName(rawName);
  const desc = oneLine(rawDesc).slice(0, 200) || null;
  return withTransaction(async (c) => {
    // ล็อกแถวผู้ใช้กันสร้างพร้อมกันหลายคำขอแล้วเกิน 2 กลุ่ม
    await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const n = await c.query('SELECT count(*)::int AS n FROM chat_groups WHERE owner_id = $1', [userId]);
    if (n.rows[0].n >= MAX_GROUPS_PER_USER) throw new Error(`สร้างกลุ่มได้คนละไม่เกิน ${MAX_GROUPS_PER_USER} กลุ่ม (ลบกลุ่มเดิมก่อนถ้าอยากสร้างใหม่)`);
    const dup = await c.query('SELECT 1 FROM chat_groups WHERE lower(name) = lower($1)', [name]);
    if (dup.rows[0]) throw new Error('มีกลุ่มชื่อนี้อยู่แล้ว ลองตั้งชื่ออื่น');
    const g = await c.query('INSERT INTO chat_groups (name, description, owner_id) VALUES ($1, $2, $3) RETURNING id, name, description', [name, desc, userId]);
    await c.query("INSERT INTO chat_group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')", [g.rows[0].id, userId]);
    return g.rows[0];
  });
}

// กลุ่มทั้งหมด + สถานะของฉัน (member/admin/pending/none) + จำนวนสมาชิก + ชื่อผู้สร้าง
async function listGroups(userId) {
  const r = await query(
    `SELECT g.id, g.name, g.description, g.owner_id, ${DISPLAY} AS owner_name,
            (SELECT count(*)::int FROM chat_group_members m WHERE m.group_id = g.id) AS members,
            (SELECT role FROM chat_group_members m WHERE m.group_id = g.id AND m.user_id = $1) AS my_role,
            EXISTS (SELECT 1 FROM chat_group_requests q WHERE q.group_id = g.id AND q.user_id = $1 AND q.status = 'pending') AS pending,
            (SELECT count(*)::int FROM chat_group_requests q WHERE q.group_id = g.id AND q.status = 'pending' AND g.owner_id = $1) AS pending_requests
       FROM chat_groups g JOIN users u ON u.id = g.owner_id
      ORDER BY (g.owner_id = $1) DESC, g.created_at DESC LIMIT 200`,
    [userId]
  );
  const mine = r.rows.filter((g) => g.owner_id === userId).length;
  const joined = r.rows.filter((g) => g.my_role === 'member').length;
  return {
    groups: r.rows.map((g) => ({ id: g.id, name: g.name, description: g.description, ownerName: g.owner_name, members: g.members, myRole: g.my_role || null, pending: g.pending, pendingRequests: g.pending_requests, isOwner: g.owner_id === userId })),
    createdByMe: mine, maxCreate: MAX_GROUPS_PER_USER, joinedByMe: joined, maxJoin: MAX_JOINED_PER_USER,
  };
}

async function notifyLine(lineUserId, send) {
  try { if (lineUserId && line.isConfigured()) await send(); } catch (err) { console.error('group line notify failed:', err.message); }
}

async function joinedCount(userId) {
  const r = await query("SELECT count(*)::int AS n FROM chat_group_members WHERE user_id = $1 AND role = 'member'", [userId]);
  return r.rows[0].n;
}

async function requestJoin(userId, groupId) {
  if (!UUID_RE.test(String(groupId))) throw new Error('ไม่พบกลุ่มนี้');
  const g = await query(`SELECT g.id, g.name, g.owner_id, o.line_user_id AS owner_line, ${DISPLAY} AS me_name
                           FROM chat_groups g JOIN users o ON o.id = g.owner_id JOIN users u ON u.id = $2 WHERE g.id = $1`, [groupId, userId]);
  if (!g.rows[0]) throw new Error('ไม่พบกลุ่มนี้');
  const already = await query('SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  if (already.rows[0]) throw new Error('คุณเป็นสมาชิกกลุ่มนี้อยู่แล้ว');
  const pend = await query("SELECT id FROM chat_group_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'", [groupId, userId]);
  if (pend.rows[0]) return { status: 'pending', alreadyExisted: true };
  if ((await joinedCount(userId)) >= MAX_JOINED_PER_USER) throw new Error(`เข้าร่วมกลุ่มได้ไม่เกิน ${MAX_JOINED_PER_USER} กลุ่ม (ออกจากกลุ่มเดิมก่อนถ้าอยากเข้ากลุ่มใหม่)`);
  const r = await query('INSERT INTO chat_group_requests (group_id, user_id) VALUES ($1, $2) RETURNING id', [groupId, userId]);
  const text = `${g.rows[0].me_name} ขอเข้าร่วมกลุ่ม "${g.rows[0].name}" ของคุณ กดอนุญาตเพื่อให้เข้ากลุ่มได้ค่ะ`;
  await notifyLine(g.rows[0].owner_line, () => line.pushButtons(g.rows[0].owner_line, text, text, [
    { label: 'อนุญาต', data: `act=group&d=approve&id=${r.rows[0].id}` },
    { label: 'ไม่อนุญาต', data: `act=group&d=deny&id=${r.rows[0].id}` },
  ]));
  return { status: 'pending', alreadyExisted: false };
}

// ผู้สร้างกลุ่ม (เท่านั้น) ตัดสินคำขอเข้าร่วม
async function decideJoin(deciderId, requestId, approve) {
  if (!UUID_RE.test(String(requestId))) throw new Error('ไม่พบคำขอนี้');
  const out = await withTransaction(async (c) => {
    const q = await c.query(
      `SELECT r.id, r.user_id, g.id AS group_id, g.name, g.owner_id FROM chat_group_requests r JOIN chat_groups g ON g.id = r.group_id
        WHERE r.id = $1 AND r.status = 'pending' FOR UPDATE OF r`, [requestId]);
    const row = q.rows[0];
    if (!row) throw new Error('ไม่พบคำขอนี้ หรือตัดสินไปแล้ว');
    if (row.owner_id !== deciderId) throw new Error('เฉพาะผู้สร้างกลุ่มเท่านั้นที่อนุญาตได้');
    if (approve) {   // ตรวจเพดานอีกรอบตอนอนุมัติ (ล็อกแถวผู้ขอกันอนุมัติพร้อมกันจากหลายกลุ่ม)
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [row.user_id]);
      const n = await c.query("SELECT count(*)::int AS n FROM chat_group_members WHERE user_id = $1 AND role = 'member'", [row.user_id]);
      if (n.rows[0].n >= MAX_JOINED_PER_USER) throw new Error(`ผู้ขอเข้าร่วมกลุ่มครบ ${MAX_JOINED_PER_USER} กลุ่มแล้ว อนุญาตไม่ได้ (กด ไม่อนุญาต ได้)`);
    }
    await c.query('UPDATE chat_group_requests SET status = $2, decided_at = now() WHERE id = $1', [requestId, approve ? 'approved' : 'denied']);
    if (approve) await c.query("INSERT INTO chat_group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING", [row.group_id, row.user_id]);
    return row;
  });
  const u = await query('SELECT line_user_id FROM users WHERE id = $1', [out.user_id]);
  const text = approve ? `ผู้สร้างกลุ่มอนุญาตให้คุณเข้ากลุ่ม "${out.name}" แล้วค่ะ เปิดแอปแล้วเข้าแชทกลุ่มได้เลย` : `ผู้สร้างกลุ่ม "${out.name}" ยังไม่อนุญาตให้เข้ากลุ่มในตอนนี้ค่ะ`;
  await notifyLine(u.rows[0] && u.rows[0].line_user_id, () => line.pushText(u.rows[0].line_user_id, text));
  return { approved: !!approve, groupId: out.group_id };
}

async function memberRole(userId, groupId) {
  if (!UUID_RE.test(String(groupId))) return null;
  const r = await query('SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return r.rows[0] ? r.rows[0].role : null;
}

// ข้อมูลกลุ่ม: เฉพาะสมาชิกดูได้ — รายชื่อสมาชิก (ชื่อ+รูป) และ (ถ้าเป็นแอดมิน) คำขอที่รออยู่
async function getGroup(userId, groupId) {
  const role = await memberRole(userId, groupId);
  if (!role) throw new Error('คุณไม่ได้เป็นสมาชิกกลุ่มนี้');
  const g = await query('SELECT id, name, description FROM chat_groups WHERE id = $1', [groupId]);
  const members = await query(
    `SELECT m.user_id, m.role, ${DISPLAY} AS name, u.line_picture_url AS picture FROM chat_group_members m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $1 ORDER BY (m.role = 'admin') DESC, m.joined_at ASC LIMIT 300`, [groupId]);
  let requests = [];
  if (role === 'admin') {
    const q = await query(
      `SELECT r.id, ${DISPLAY} AS name, u.line_picture_url AS picture, r.created_at FROM chat_group_requests r JOIN users u ON u.id = r.user_id
        WHERE r.group_id = $1 AND r.status = 'pending' ORDER BY r.created_at ASC LIMIT 50`, [groupId]);
    requests = q.rows.map((x) => ({ id: x.id, name: x.name, picture: picOf(x.picture), createdAt: x.created_at }));
  }
  return {
    group: g.rows[0], myRole: role, isAdmin: role === 'admin',
    members: members.rows.map((m) => ({ userId: m.user_id, role: m.role, name: m.name, picture: picOf(m.picture) })),
    requests,
  };
}

const sentLog = new Map();   // userId -> เวลาที่ส่งข้อความล่าสุด (กันสแปมกลุ่ม)
function checkRate(userId) {
  const now = Date.now();
  const list = (sentLog.get(userId) || []).filter((t) => now - t < 60000);
  if (list.length >= MSG_PER_MIN) throw new Error('ส่งข้อความถี่เกินไป รอสักครู่แล้วลองใหม่');
  list.push(now); sentLog.set(userId, list);
}

async function postMessage(userId, groupId, raw) {
  if (!(await memberRole(userId, groupId))) throw new Error('คุณไม่ได้เป็นสมาชิกกลุ่มนี้');
  const text = String(raw || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!text) throw new Error('ข้อความว่าง');
  if (text.length > MAX_MESSAGE_CHARS) throw new Error(`ข้อความยาวเกิน ${MAX_MESSAGE_CHARS} ตัวอักษร`);
  checkRate(userId);
  const r = await query('INSERT INTO chat_group_messages (group_id, user_id, content) VALUES ($1, $2, $3) RETURNING id, created_at', [groupId, userId, text]);
  return { id: Number(r.rows[0].id), createdAt: r.rows[0].created_at };
}

// ข้อความ: ครั้งแรก 50 ข้อความล่าสุด / afterId = เฉพาะที่ใหม่กว่านั้น (ใช้ polling) — แต่ละข้อความแนบชื่อ+รูปโปรไฟล์คนส่ง
async function listMessages(userId, groupId, afterId) {
  if (!(await memberRole(userId, groupId))) throw new Error('คุณไม่ได้เป็นสมาชิกกลุ่มนี้');
  const after = Number(afterId);
  const sql = Number.isFinite(after) && after > 0
    ? `SELECT m.id, m.user_id, m.content, m.created_at, ${DISPLAY} AS name, u.line_picture_url AS picture FROM chat_group_messages m JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT 100`
    : `SELECT * FROM (SELECT m.id, m.user_id, m.content, m.created_at, ${DISPLAY} AS name, u.line_picture_url AS picture FROM chat_group_messages m JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 AND $2::bigint IS NOT NULL ORDER BY m.id DESC LIMIT 50) t ORDER BY id ASC`;
  const r = await query(sql, [groupId, Number.isFinite(after) && after > 0 ? after : 0]);
  return r.rows.map((m) => ({ id: Number(m.id), userId: m.user_id, name: m.name, picture: picOf(m.picture), content: m.content, createdAt: m.created_at, mine: m.user_id === userId }));
}

// สมาชิกออกจากกลุ่ม (ผู้สร้างออกไม่ได้ ต้องลบกลุ่ม)
async function leaveGroup(userId, groupId) {
  const role = await memberRole(userId, groupId);
  if (!role) throw new Error('คุณไม่ได้เป็นสมาชิกกลุ่มนี้');
  if (role === 'admin') throw new Error('ผู้สร้างกลุ่มออกจากกลุ่มไม่ได้ ถ้าไม่ต้องการแล้วให้ลบกลุ่ม');
  await query('DELETE FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return { left: true };
}

// ผู้สร้างลบกลุ่ม (ข้อความและสมาชิกหายหมด) — คืนโควตาสร้างกลุ่ม
async function deleteGroup(userId, groupId) {
  if (!UUID_RE.test(String(groupId))) throw new Error('ไม่พบกลุ่มนี้');
  const r = await query('DELETE FROM chat_groups WHERE id = $1 AND owner_id = $2 RETURNING name', [groupId, userId]);
  if (!r.rows[0]) throw new Error('ไม่พบกลุ่มนี้ หรือคุณไม่ใช่ผู้สร้างกลุ่ม');
  return { deleted: r.rows[0].name };
}

module.exports = { createGroup, listGroups, requestJoin, decideJoin, getGroup, postMessage, listMessages, leaveGroup, deleteGroup, MAX_GROUPS_PER_USER, MAX_JOINED_PER_USER, MAX_MESSAGE_CHARS };
