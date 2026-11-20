// ทดสอบไฟล์ติดตั้งแอปลงหน้าจอหลัก (PWA): manifest, ไอคอน PNG, service worker, ลิงก์ในหน้าเว็บ
//   node server/pwaSmokeTest.js   (ไม่ใช้ฐานข้อมูล)
process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'x';
const app = require('./index');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) }; };

(async () => {
  const m = await get('/manifest.webmanifest');
  const man = JSON.parse(m.buf.toString('utf8'));
  check('manifest เสิร์ฟได้ ชนิดไฟล์ถูกต้อง', m.status === 200 && /manifest\+json|json/.test(m.type), m.type);
  check('manifest: ชื่อ/ไทย/เปิดแบบแอปเต็มจอ', man.name && man.short_name === 'เลขา' && man.lang === 'th' && man.display === 'standalone' && man.start_url === '/' && man.scope === '/');
  check('manifest: สีพื้น/ธีมตรงกับหน้าเว็บ', man.theme_color === '#0b0f1e' && man.background_color === '#0b0f1e');
  check('manifest: ทางลัด "คุยด้วยเสียง" ชี้ /?mode=voice', man.shortcuts && man.shortcuts[0].url === '/?mode=voice');
  const sizes = new Set(man.icons.map((i) => i.sizes));
  check('manifest: มีไอคอน 192 และ 512 (ทั้ง any และ maskable)', sizes.has('192x192') && sizes.has('512x512') && man.icons.some((i) => i.purpose === 'maskable') && man.icons.some((i) => i.purpose === 'any'));

  for (const icon of man.icons) {
    const r = await get(icon.src);
    const isPng = r.buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const w = r.buf.readUInt32BE(16); const h = r.buf.readUInt32BE(20);
    check(`ไอคอน ${icon.src} (${icon.purpose}) เป็น PNG ขนาดตรงตามที่ประกาศ`, r.status === 200 && isPng && icon.sizes === `${w}x${h}` && /image\/png/.test(r.type), `${w}x${h}`);
  }

  const sw = await get('/sw.js');
  check('service worker เสิร์ฟได้เป็น JavaScript และมี fetch handler (เงื่อนไขให้ติดตั้งแอปได้)', sw.status === 200 && /javascript/.test(sw.type) && sw.buf.toString().includes("addEventListener('fetch'"));
  check('service worker ไม่เก็บแคชไฟล์ใดๆ (กันได้หน้าเก่าค้าง)', !/caches\.(open|put|addAll)/.test(sw.buf.toString()));

  const html = (await get('/ai.html')).buf.toString('utf8');
  check('หน้าเว็บเชื่อม manifest + ไอคอน + ตั้งค่าแอปมือถือ', html.includes('rel="manifest" href="/manifest.webmanifest"') && html.includes('apple-touch-icon') && html.includes('mobile-web-app-capable'));
  check('หน้าสนทนาเสียงมีครบ: ปุ่มไมค์กลางจอ ปุ่มจบ ข้อความสถานะ คำบรรยาย', ['id="voiceScreen"', 'id="vMic"', 'id="vExit"', 'id="vState"', 'id="vReply"'].every((x) => html.includes(x)));
  check('ปุ่มสลับ "โหมดปกติ/เรียลไทม์" เดิมถูกเอาออกแล้ว (เหลือไมค์ปุ่มเดียว)', !html.includes('realtimeMicToggle'));
  check('เส้นทางแปลก (ไม่ใช่ไฟล์) ยังตกไปหน้าแอป ไม่กระทบ', (await get('/something-random')).buf.toString('utf8').includes('id="voiceScreen"'));

  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  server.close(() => process.exit(failures ? 1 : 0));
})().catch((e) => { console.error('ทดสอบพังกลางทาง:', e); process.exit(1); });
