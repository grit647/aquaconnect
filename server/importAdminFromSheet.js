// รันครั้งเดียว: ย้ายบัญชีแอดมินจาก Google Sheet (แท็บ Users เดิม) เข้าฐานข้อมูล Postgres ใหม่
//   node server/importAdminFromSheet.js
// คัดลอกค่า PIN ที่ hash แล้วมาตรงๆ (ไม่ต้องรู้ PIN จริง) — เบอร์/PIN เดิมใช้ล็อกอินได้เหมือนเดิม
// อ่านจาก Sheet อย่างเดียว ไม่แก้อะไรใน Sheet, รันซ้ำได้ปลอดภัย (ถ้ามีเบอร์นี้แล้วจะข้าม)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { readTab } = require('./sheets');
const { query, getPool } = require('./db');

async function run() {
  const { rows } = await readTab('Users');
  const admins = rows.filter((u) => String(u.roles || '').split(',').includes('admin') && u.pinHash);
  console.log(`พบแอดมินใน Sheet: ${admins.length} บัญชี`);

  for (const a of admins) {
    const r = await query(
      `INSERT INTO users (phone, pin_hash, name, is_admin)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (phone) DO NOTHING
       RETURNING id`,
      [a.phone, a.pinHash, a.name || 'แอดมิน']
    );
    if (r.rows[0]) {
      await query('INSERT INTO credit_balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [r.rows[0].id]);
      console.log(`✅ ย้ายแล้ว: ${String(a.phone).slice(0, 3)}***${String(a.phone).slice(-2)}`);
    } else {
      console.log(`ข้าม (มีเบอร์นี้ในฐานข้อมูลใหม่แล้ว): ${String(a.phone).slice(0, 3)}***${String(a.phone).slice(-2)}`);
    }
  }
  await getPool().end();
}

run().catch((err) => {
  console.error('❌ ย้ายแอดมินล้มเหลว:', err.message);
  process.exit(1);
});
