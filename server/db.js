// เชื่อมต่อฐานข้อมูล Postgres (Supabase) — ใช้ร่วมกันทั้งแอป
//
// รองรับ 2 วิธีตั้งค่า (ไฟล์ .env):
//   วิธี A (แนะนำ): แยกเป็นช่อง DB_HOST / DB_PORT / DB_USER / DB_NAME / DB_PASSWORD
//     — รหัสผ่านใส่อักขระพิเศษอะไรก็ได้ (@ # / ? ฯลฯ) ไม่ต้องแปลงรหัส (percent-encode)
//   วิธี B: DATABASE_URL บรรทัดเดียว (รหัสผ่านที่มีอักขระพิเศษต้องแปลงเองก่อน)
// ถ้ามีครบวิธี A จะใช้วิธี A ก่อนเสมอ
const { Pool } = require('pg');

function buildConfig() {
  const { DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD, DATABASE_URL } = process.env;
  if (DB_HOST && DB_USER && DB_PASSWORD) {
    return {
      host: DB_HOST,
      port: Number(DB_PORT) || 5432,
      user: DB_USER,
      database: DB_NAME || 'postgres',
      password: DB_PASSWORD,
    };
  }
  if (DATABASE_URL) return { connectionString: DATABASE_URL };
  throw new Error('ยังไม่ได้ตั้งค่าฐานข้อมูลใน .env (ต้องมี DB_HOST/DB_USER/DB_PASSWORD หรือ DATABASE_URL)');
}

let pool = null;
function getPool() {
  if (pool) return pool;
  pool = new Pool({
    ...buildConfig(),
    // Supabase บังคับเชื่อมต่อแบบเข้ารหัส (SSL) — ใบรับรองของ pooler ไม่อยู่ในรายการที่ Node รู้จัก จึงปิดการตรวจใบรับรองเฉพาะจุดนี้
    ssl: { rejectUnauthorized: false },
    max: 5, // เชื่อมต่อพร้อมกันได้ไม่เกิน 5 สาย (แผนฟรีมีจำกัด)
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('[db] pool error:', err.message));
  return pool;
}

// ยิงคำสั่ง SQL 1 คำสั่ง — ใช้พารามิเตอร์ $1,$2 เสมอ ห้ามต่อสตริงข้อมูลผู้ใช้เข้าคำสั่งโดยตรง (กัน SQL injection)
function query(text, params) {
  return getPool().query(text, params);
}

// ทำหลายคำสั่งเป็นก้อนเดียว (เช่น หักเครดิตคนถาม + เพิ่มเครดิตเจ้าของข้อมูล) — ถ้าพังกลางทางจะย้อนกลับทั้งหมด
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, withTransaction };
