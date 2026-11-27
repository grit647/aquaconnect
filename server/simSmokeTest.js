// ทดสอบหน้าโมเดลจำลองการเลี้ยงกุ้ง (ต้นแบบหน้าจอ): เส้นทาง /sim, โครงหน้า, ค่าน้ำ 10 ตัว, เมนูในหน้าเลขา
//   node server/simSmokeTest.js   (ไม่ใช้ฐานข้อมูล)
process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'x';
const vm = require('vm');
const app = require('./index');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() }; };

(async () => {
  const sim = await get('/sim');
  check('/sim ตอบหน้า sim.html (ไม่ใช่หน้าเลขา)', sim.status === 200 && /ฟาร์มกุ้งจำลอง/.test(sim.text) && !/id="menuBtn"/.test(sim.text));
  check('หน้าแยกจอแนวนอน: มีเวที #stage และข้อความแนะนำให้หมุนมือถือ (ไม่มีหน้ากั้น)', /id="stage"/.test(sim.text) && /id="rotHint"/.test(sim.text) && !/id="rotate"/.test(sim.text) && /หมุนมือถือเป็นแนวนอน/.test(sim.text));
  check('มีระบบบ่อ 3 ส่วน (คลอง/บ่อพัก/บ่อเลี้ยง)', ['data-pond="canal"', 'data-pond="reservoir"', 'data-pond="culture"'].every((k) => sim.text.includes(k)));
  check('มี 3 แท็บแดชบอร์ด น้ำ/กุ้ง/ต้นทุน', ['data-tab="water"', 'data-tab="shrimp"', 'data-tab="cost"'].every((k) => sim.text.includes(k)));
  check('ปุ่มจัดการครบ 9 ปุ่ม', (sim.text.match(/data-act="/g) || []).length === 9);
  check('หน้าตั้งค่าเริ่มเกม: ชนิดกุ้ง/ระบบเลี้ยง/ความหนาแน่น/จังหวัด/โหมด', ['fSpecies', 'fSystem', 'fDensity', 'fProvince', 'fMode', 'startBtn'].every((k) => sim.text.includes('id="' + k + '"')));

  const js = await get('/sim.js'); const css = await get('/sim.css');
  let ok = true; let why = '';
  try { new vm.Script(js.text, { filename: 'sim.js' }); } catch (e) { ok = false; why = e.message; }
  check('sim.js คอมไพล์ผ่าน', js.status === 200 && ok, why);
  check('sim.css: ถือแนวตั้ง = หมุนเวทีตะแคง 90° (ไม่บังคับให้ผู้ใช้หมุนจอ)', css.status === 200 && /orientation:\s*portrait/.test(css.text) && /rotate\(90deg\)/.test(css.text) && /width:\s*100dvh/.test(css.text));
  const keys = ['ph', 'alk', 'temp', 'ca', 'mg', 'sal', 'tan', 'no2', 'secchi', 'do'];
  check('ค่าน้ำบนแดชบอร์ดครบ 10 ตัว (pH อัลคาไลน์ อุณหภูมิ Ca Mg ความเค็ม แอมโมเนีย ไนไตรท์ ความขุ่นใส DO)', keys.every((k) => js.text.includes(`key: '${k}'`)) && (js.text.match(/\{ key: '/g) || []).length === 10);

  const ai = await get('/ai.js');
  ok = true; why = '';
  try { new vm.Script(ai.text, { filename: 'ai.js' }); } catch (e) { ok = false; why = e.message; }
  check('ai.js ยังคอมไพล์ผ่านหลังเพิ่มเมนู', ok, why);
  check('เมนู ☰ มี "🦐 โมเดลจำลอง" และ popup "การเลี้ยงกุ้งเสมือนจริง" ที่พาไป /sim', /🦐 โมเดลจำลอง/.test(ai.text) && /การเลี้ยงกุ้งเสมือนจริง/.test(ai.text) && /location\.href = '\/sim'/.test(ai.text));
  check('เมนูโมเดลจำลองเปิดเฉพาะแอดมินไว้ก่อน (สวิตช์ SIM_MENU_ADMIN_ONLY)', /SIM_MENU_ADMIN_ONLY = true/.test(ai.text) && /!SIM_MENU_ADMIN_ONLY \|\| \(me && me\.isAdmin\)/.test(ai.text));

  const home = await get('/');
  check('หน้าหลักยังเป็นหน้าเลขา (ไม่ถูก /sim แย่ง)', home.status === 200 && /id="menuBtn"/.test(home.text));
  const other = await get('/something-else');
  check('เส้นทางอื่นยังตกไปหน้าเลขาเหมือนเดิม', /id="menuBtn"/.test(other.text));

  server.close();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทั้งหมด');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e.message); process.exit(1); });
