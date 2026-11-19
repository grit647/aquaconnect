// รันใบสั่งสร้างตาราง (server/migrations/*.sql) ตามลำดับชื่อไฟล์ — ไฟล์ที่เคยรันแล้วจะข้าม
//   npm run db:migrate
// แต่ละไฟล์รันเป็นก้อนเดียว ถ้าพังกลางทางจะย้อนกลับทั้งไฟล์ ไม่ทิ้งตารางครึ่งๆ กลางๆ
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool, withTransaction } = require('./db');

const DIR = path.join(__dirname, 'migrations');

async function run() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
  // ตารางจดประวัติเองก็ต้องปิดจากคนนอกเหมือนตารางข้อมูลอื่น (Supabase เปิด API สาธารณะให้สคีมา public)
  await pool.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');

  const done = new Set((await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

  let applied = 0;
  for (const f of files) {
    if (done.has(f)) { console.log('ข้าม (เคยรันแล้ว):', f); continue; }
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
    });
    console.log('✅ รันสำเร็จ:', f);
    applied++;
  }
  console.log(applied ? `เสร็จ — รันใหม่ ${applied} ไฟล์` : 'ไม่มีไฟล์ใหม่ให้รัน');
  await pool.end();
}

run().catch((err) => {
  console.error('❌ migrate ล้มเหลว:', err.message);
  process.exit(1);
});
