// Memory Pack ของผู้ใช้แต่ละคน — หมวดหมู่ + ความจำ (ตาราง memory_categories / memories)
// ทุกฟังก์ชันรับ userId จากฝั่งเซิร์ฟเวอร์เสมอ (ไม่เคยรับจาก AI/ผู้ใช้โดยตรง) กันเข้าถึงข้อมูลคนอื่น
const { query, withTransaction } = require('./db');

const MAX_ITEMS_PER_CATEGORY = 5;     // ใส่เข้า prompt หมวดละกี่รายการล่าสุด
const SELF_ITEMS_IN_PROMPT = 15;      // หมวดตัวเลขาใส่มากกว่า (เลขาต้อง "มองเห็น" สิ่งที่ถูกสอนครบ ไม่งั้นถูกสอนซ้ำ)
const MAX_PENDING_PROPOSALS = 5;
const MAX_CONTEXT_CHARS = 6000;       // เพดานความยาวความจำที่ใส่เข้า prompt ต่อครั้ง (คุมค่า token)
const MAX_CONTENT_CHARS = 4000;
const MAX_CATEGORY_NAME = 40;

// 2 หมวดหลักที่ทุกคนมีตั้งแต่เริ่มใช้งาน: "ทั่วไป" (ความจำทั่วไป) และ "ความสามารถเลขา" (สิ่งที่เจ้าของสอนเลขา:
// ตัวตน/บทเรียน/ความฝัน) — หมวดความสามารถเลขาเป็นส่วนตัวเสมอ ห้ามเปิดแชร์/ขาย
const GENERAL_CATEGORY = 'ทั่วไป';
const SKILL_CATEGORY = 'ความสามารถเลขา';
const MAIN_CATEGORIES = [GENERAL_CATEGORY, SKILL_CATEGORY];
const SELF_NAMES = [SKILL_CATEGORY];
const SELF_KINDS = { persona: 'ตัวตน', lesson: 'บทเรียน', dream: 'ความฝัน' };
const isSelfCategory = (name) => SELF_NAMES.some((n) => n.toLowerCase() === String(name || '').trim().toLowerCase());

async function ensureMainCategories(userId) {
  for (const name of MAIN_CATEGORIES) {
    await query('INSERT INTO memory_categories (owner_id, name) VALUES ($1, $2) ON CONFLICT (owner_id, name) DO NOTHING', [userId, name]);
  }
}

function cleanCategoryName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('ต้องระบุชื่อหมวด');
  if (name.length > MAX_CATEGORY_NAME) throw new Error(`ชื่อหมวดยาวเกิน ${MAX_CATEGORY_NAME} ตัวอักษร`);
  return name;
}

// ความจำล่าสุดของผู้ใช้ จัดเป็นข้อความพร้อมแปะใน system prompt ('' ถ้ายังไม่มี)
// หมวดตัวเลขา (สิ่งที่เจ้าของสอน) มาก่อนและใส่ได้มากกว่า — เป็นสิ่งที่เลขาต้องทำตามทุกครั้งที่คุย
async function getMemoryContext(userId) {
  const r = await query(
    `SELECT c.name, m.content
       FROM (SELECT *, row_number() OVER (PARTITION BY category_id ORDER BY created_at DESC) AS rn
               FROM memories WHERE owner_id = $1) m
       JOIN memory_categories c ON c.id = m.category_id
      WHERE m.rn <= CASE WHEN c.name = ANY($3) THEN $4::int ELSE $2::int END
      ORDER BY c.name, m.created_at DESC`,
    [userId, MAX_ITEMS_PER_CATEGORY, SELF_NAMES, SELF_ITEMS_IN_PROMPT]
  );
  if (!r.rows.length) return '';

  const byCat = new Map();
  for (const row of r.rows) {
    if (!byCat.has(row.name)) byCat.set(row.name, []);
    byCat.get(row.name).push(row.content);
  }
  const entries = [...byCat.entries()].sort((a, b) => Number(isSelfCategory(b[0])) - Number(isSelfCategory(a[0])));
  let out = '';
  for (const [name, items] of entries) {
    const head = isSelfCategory(name) ? `[สิ่งที่เจ้าของสอนคุณ — หมวด: ${name} — ทำตามเสมอ]` : `[หมวด: ${name}]`;
    const block = `${head}\n${items.map((i) => `- ${i}`).join('\n')}\n\n`;
    if (out.length + block.length > MAX_CONTEXT_CHARS) { out += '(ความจำเก่ากว่านี้มีอีก ใช้เครื่องมือ recall_memories ดึงเพิ่มได้)\n'; break; }
    out += block;
  }
  return out.trim();
}

// บันทึกความจำลงหมวด — ถ้ายังไม่มีหมวดนี้จะสร้างให้เป็น "ส่วนตัว" เสมอ (เปิดให้คนอื่นเห็นได้ต่อเมื่อเจ้าของสั่งเท่านั้น)
async function saveMemory(userId, categoryName, content, conversationId) {
  const name = cleanCategoryName(categoryName);
  const text = String(content || '').trim();
  if (!text) throw new Error('เนื้อหาความจำห้องว่าง');
  if (text.length > MAX_CONTENT_CHARS) throw new Error(`เนื้อหายาวเกิน ${MAX_CONTENT_CHARS} ตัวอักษร`);

  return withTransaction(async (c) => {
    let created = false;
    let cat = await c.query('SELECT id, name FROM memory_categories WHERE owner_id = $1 AND lower(name) = lower($2)', [userId, name]);
    if (!cat.rows[0]) {
      cat = await c.query(
        `INSERT INTO memory_categories (owner_id, name) VALUES ($1, $2)
         ON CONFLICT (owner_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name`,
        [userId, name]
      );
      created = true;
    }
    const m = await c.query(
      'INSERT INTO memories (category_id, owner_id, content, source_conversation_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [cat.rows[0].id, userId, text, conversationId || null]
    );
    return { memoryId: m.rows[0].id, category: cat.rows[0].name, createdCategory: created };
  });
}

async function listCategories(userId) {
  const r = await query(
    `SELECT c.name, c.visibility, count(m.id)::int AS memories
       FROM memory_categories c LEFT JOIN memories m ON m.category_id = c.id
      WHERE c.owner_id = $1
      GROUP BY c.id ORDER BY c.name`,
    [userId]
  );
  return r.rows;
}

// ดึงความจำของหมวดหนึ่ง (หรือทุกหมวดถ้าไม่ระบุ) ล่าสุดก่อน — ไว้ให้ AI เรียกเมื่อความจำเยอะเกินที่ใส่ใน prompt ได้
async function recallMemories(userId, categoryName, limit = 20) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const params = [userId, n];
  let where = 'm.owner_id = $1';
  if (categoryName) {
    params.push(cleanCategoryName(categoryName));
    where += ' AND lower(c.name) = lower($3)';
  }
  const r = await query(
    `SELECT c.name AS category, m.content, m.created_at
       FROM memories m JOIN memory_categories c ON c.id = m.category_id
      WHERE ${where} ORDER BY m.created_at DESC LIMIT $2`,
    params
  );
  return r.rows;
}

// ---------- ข้อเสนอให้จำ (เลขาไตร่ตรองแล้วเสนอ เจ้าของยืนยันก่อนบันทึกจริง) ----------
const oneLine = (s) => String(s || '').split(/\s+/).join(' ').trim();
const normText = (s) => oneLine(s).toLowerCase();

async function listPendingProposals(userId) {
  const r = await query(
    "SELECT id, category, content, created_at FROM memory_proposals WHERE owner_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT 10",
    [userId]
  );
  return r.rows;
}

// items: [{ category: 'persona'|'lesson'|'dream', summary }] — กรองหมวดแปลก/ซ้ำ/สั้นหรือยาวเกิน และจำกัดจำนวนที่ค้างรอ
async function createProposals(userId, conversationId, items) {
  const pending = await listPendingProposals(userId);
  const existing = await query(
    `SELECT m.content FROM memories m JOIN memory_categories c ON c.id = m.category_id
      WHERE m.owner_id = $1 AND c.name = ANY($2)`,
    [userId, SELF_NAMES]
  );
  const seen = new Set([...pending.map((p) => normText(p.content)), ...existing.rows.map((x) => normText(x.content))]);
  const created = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (pending.length + created.length >= MAX_PENDING_PROPOSALS) break;
    const kind = SELF_KINDS[String(it && it.category)];
    const raw = oneLine(it && (it.summary || it.content));
    if (!kind || raw.length < 8 || raw.length > 480) continue;
    const category = SKILL_CATEGORY;
    const text = `[${kind}] ${raw}`;
    if (seen.has(normText(text))) continue;
    seen.add(normText(text));
    const r = await query(
      'INSERT INTO memory_proposals (owner_id, category, content, source_conversation_id) VALUES ($1, $2, $3, $4) RETURNING id, category, content',
      [userId, category, text, conversationId || null]
    );
    created.push(r.rows[0]);
  }
  return created;
}

// ยืนยัน (accept=true → บันทึกเป็นความจำในหมวดส่วนตัวของเจ้าของ) หรือปฏิเสธ — ตัดสินได้เฉพาะข้อเสนอของตัวเองที่ยังรออยู่
async function decideProposal(userId, proposalId, accept) {
  const r = await query(
    `UPDATE memory_proposals SET status = $3, decided_at = now()
      WHERE id = $1 AND owner_id = $2 AND status = 'pending'
      RETURNING category, content, source_conversation_id`,
    [proposalId, userId, accept ? 'accepted' : 'rejected']
  );
  if (!r.rows[0]) throw new Error('ไม่พบข้อเสนอนี้ หรือตัดสินไปแล้ว');
  if (accept) await saveMemory(userId, r.rows[0].category, r.rows[0].content, r.rows[0].source_conversation_id);
  return { category: r.rows[0].category, accepted: !!accept };
}

module.exports = {
  getMemoryContext, saveMemory, listCategories, recallMemories,
  GENERAL_CATEGORY, SKILL_CATEGORY, MAIN_CATEGORIES, SELF_NAMES, isSelfCategory, ensureMainCategories, listPendingProposals, createProposals, decideProposal,
};
