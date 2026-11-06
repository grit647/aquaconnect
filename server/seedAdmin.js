// รันครั้งเดียวหลังตั้งค่า .env เสร็จแล้ว:
//   npm run seed:admin
// สร้าง header row ของแท็บ Users (ถ้ายังไม่มี/ไม่ตรง) + สร้างบัญชีแอดมิน 1 คน
// รันซ้ำได้ปลอดภัย — ถ้ามีแอดมินเบอร์นั้นอยู่แล้วจะข้ามการสร้างใหม่ ไม่ทับรหัสเดิม
//
// เบอร์โทร/PIN ของแอดมินตั้งผ่านตัวแปรแวดล้อม ไม่ hardcode ในไฟล์นี้
// (repo นี้เป็น public repo — hardcode ค่าจริงในโค้ดจะรั่วไหลเข้า git
// history ถาวร) เพิ่ม 2 บรรทัดนี้ใน .env (ไฟล์ local เท่านั้น, ไม่ push
// ขึ้น GitHub) ก่อนรัน:
//   SEED_ADMIN_PHONE=<เบอร์โทร 9-10 หลัก>
//   SEED_ADMIN_PIN=<PIN ตัวเลข 6 หลัก>
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { readTab, writeTabHeaders, appendRow } = require('./sheets');

const USERS_TAB = 'Users';
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE;
const ADMIN_PIN = process.env.SEED_ADMIN_PIN;
const USER_HEADERS = ['id', 'phone', 'pinHash', 'name', 'province', 'roles', 'roleDetails', 'status', 'registeredDate'];

async function run() {
  if (!/^\d{9,10}$/.test(ADMIN_PHONE || '')) {
    throw new Error('ตั้งค่า SEED_ADMIN_PHONE ใน .env ให้เป็นเบอร์โทร 9-10 หลักก่อน');
  }
  if (!/^\d{6}$/.test(ADMIN_PIN || '')) {
    throw new Error('ตั้งค่า SEED_ADMIN_PIN ใน .env ให้เป็นตัวเลข 6 หลักก่อน');
  }

  const { headers, rows: users } = await readTab(USERS_TAB);

  if (headers.length === 0) {
    console.log('แท็บ Users ยังไม่มี header — กำลังสร้างให้...');
    await writeTabHeaders(USERS_TAB, USER_HEADERS);
  } else {
    const missing = USER_HEADERS.filter((h) => !headers.includes(h));
    if (missing.length) {
      console.warn('⚠️  แท็บ Users ขาดคอลัมน์: ' + missing.join(', ') + ' — กรุณาเพิ่มคอลัมน์เหล่านี้เองในชีตก่อน แล้วรันสคริปต์นี้ใหม่');
      process.exit(1);
    }
  }

  const effectiveHeaders = headers.length ? headers : USER_HEADERS;

  const existing = users.find((u) => u.phone === ADMIN_PHONE);
  if (existing) {
    console.log(`บัญชีแอดมิน (เบอร์ ${ADMIN_PHONE}) มีอยู่แล้ว ข้ามการสร้างใหม่`);
    return;
  }

  const pinHash = await bcrypt.hash(ADMIN_PIN, 10);
  await appendRow(USERS_TAB, effectiveHeaders, {
    id: 'U00000',
    phone: ADMIN_PHONE,
    pinHash,
    name: 'แอดมิน',
    province: '',
    roles: 'admin',
    roleDetails: '{}',
    status: 'active',
    registeredDate: new Date().toISOString(),
  });
  console.log(`✅ สร้างบัญชีแอดมินสำเร็จ — เบอร์ ${ADMIN_PHONE}`);
}

run().catch((err) => {
  console.error('❌ seed:admin ล้มเหลว:', err.message);
  process.exit(1);
});
