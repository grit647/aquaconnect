// สร้างเมนูไลน์ (Rich Menu) ของ OA แล้วตั้งเป็นเมนูเริ่มต้นของทุกคน
//   node server/setupRichMenu.js
// ต้องตั้งค่าใน .env ก่อน: LINE_CHANNEL_ACCESS_TOKEN, LIFF_ID
// รันซ้ำได้ปลอดภัย: ลบเมนูเก่าที่ชื่อขึ้นต้นด้วย "AquaConnect เมนูหลัก" ของสคริปต์นี้ก่อนสร้างใหม่ (ไม่แตะเมนูอื่น)
// ภาพเมนูอยู่ที่ richmenu/richmenu.png (เรนเดอร์จาก richmenu/richmenu.html ด้วย Edge)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.LIFF_ID;
const NAME_PREFIX = 'AquaConnect เมนูหลัก';
const IMAGE = path.join(__dirname, '..', 'richmenu', 'richmenu.png');

async function api(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function run() {
  if (!TOKEN) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน .env');
  if (!LIFF_ID) throw new Error('ยังไม่ได้ตั้งค่า LIFF_ID ใน .env');
  if (!fs.existsSync(IMAGE)) throw new Error('ไม่พบภาพเมนู richmenu/richmenu.png');

  // 1) ลบเมนูเก่าของเราที่เคยสร้างไว้ (กันเมนูซ้ำสะสม)
  const { richmenus } = await api('GET', 'https://api.line.me/v2/bot/richmenu/list');
  for (const m of richmenus || []) {
    if (String(m.name).startsWith(NAME_PREFIX)) {
      await api('DELETE', `https://api.line.me/v2/bot/richmenu/${m.richMenuId}`);
      console.log('ลบเมนูเก่า:', m.richMenuId);
    }
  }

  // 2) สร้างเมนู: ปุ่มซ้าย (กว้าง) เปิดหน้า AI ผ่าน LIFF / ปุ่มขวา ส่งข้อความ "วิธีใช้" ให้บอทตอบ
  const created = await api('POST', 'https://api.line.me/v2/bot/richmenu', {
    size: { width: 2500, height: 843 },
    selected: true,
    name: `${NAME_PREFIX} ${new Date().toISOString().slice(0, 10)}`,
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 1667, height: 843 }, action: { type: 'uri', label: 'คุยกับเลขา', uri: `https://liff.line.me/${LIFF_ID}` } },
      { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'message', label: 'วิธีใช้', text: 'วิธีใช้' } },
    ],
  });
  const id = created.richMenuId;
  console.log('สร้างเมนูแล้ว:', id);

  // 3) อัปโหลดภาพ
  await api('POST', `https://api-data.line.me/v2/bot/richmenu/${id}/content`, fs.readFileSync(IMAGE), { 'Content-Type': 'image/png' });
  console.log('อัปโหลดภาพแล้ว');

  // 4) ตั้งเป็นเมนูเริ่มต้นของทุกคน
  await api('POST', `https://api.line.me/v2/bot/user/all/richmenu/${id}`);
  console.log('✅ ตั้งเป็นเมนูเริ่มต้นเรียบร้อย — เปิดแชท OA ในไลน์จะเห็นเมนู (ถ้ายังไม่เห็น ลองปิดเปิดแชทใหม่)');
}

run().catch((err) => {
  console.error('❌ ตั้งเมนูไม่สำเร็จ:', err.message.replace(/Bearer\s+\S+/g, 'Bearer [hidden]'));
  process.exit(1);
});
