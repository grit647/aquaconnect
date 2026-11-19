// Memory Pack ของผู้ใช้แต่ละคน — หมวดหมู่ + ความจำ (ตาราง memory_categories / memories)
// ทุกฟังก์ชันรับ userId จากฝั่งเซิร์ฟเวอร์เสมอ (ไม่เคยรับจาก AI/ผู้ใช้โดยตรง) กันเข้าถึงข้อมูลคนอื่น
const { query, withTransaction } = require('./db');

const MAX_ITEMS_PER_CATEGORY = 5;     // ใส่เข้า prompt หมวดละกี่รายการล่าสุด
const MAX_CONTEXT_CHARS = 6000;       // เพดานความยาวความจำที่ใส่เข้า prompt ต่อครั้ง (คุมค่า token)
const MAX_CONTENT_CHARS = 4000;
const MAX_CATEGORY_NAME = 40;

function cleanCategoryName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('ต้องระบุชื่อหมวด');
  if (name.length > MAX_CATEGORY_NAME) throw new Error(`ชื่อหมวดยาวเกิน ${MAX_CATEGORY_NAME} ตัวอักษร`);
  return name;
}

// ความจำล่าสุดของผู้ใช้ จัดเป็นข้อความพร้อมแปะใน system prompt ('' ถ้ายังไม่มี)
async function getMemoryContext(userId) {
  const r = await query(
    `SELECT c.name, m.content
       FROM (SELECT *, row_number() OVER (PARTITION BY category_id ORDER BY created_at DESC) AS rn
               FROM memories WHERE owner_id = $1) m
       JOIN memory_categories c ON c.id = m.category_id
      WHERE m.rn <= $2
      ORDER BY c.name, m.created_at DESC`,
    [userId, MAX_ITEMS_PER_CATEGORY]
  );
  if (!r.rows.length) return '';

  const byCat = new Map();
  for (const row of r.rows) {
    if (!byCat.has(row.name)) byCat.set(row.name, []);
    byCat.get(row.name).push(row.content);
  }
  let out = '';
  for (const [name, items] of byCat) {
    const block = `[หมวด: ${name}]\n${items.map((i) => `- ${i}`).join('\n')}\n\n`;
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

module.exports = { getMemoryContext, saveMemory, listCategories, recallMemories };
