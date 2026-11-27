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
  check('หน้าตั้งค่าเริ่มเกม: ชนิดกุ้ง/ระบบเลี้ยง/ความหนาแน่น/จังหวัด/โหมด', ['fName', 'fSpecies', 'fSystem', 'fSalinity', 'fSize', 'fStock', 'fLevel', 'fProvince', 'fMode', 'startBtn'].every((k) => sim.text.includes('id="' + k + '"')));

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

  const p3 = await get('/pond3d.js'); const th = await get('/vendor/three.min.js');
  ok = true; why = ''; try { new vm.Script(p3.text, { filename: 'pond3d.js' }); } catch (e) { ok = false; why = e.message; }
  check('pond3d.js คอมไพล์ผ่าน + three.js เสิร์ฟได้ + หน้ามี 3 มุมมอง (ท็อป/ตัด/สำรวจ)', ok && th.status === 200 && th.text.length > 100000 && ['data-p3="top"', 'data-p3="section"', 'data-p3="explore"'].every((k) => sim.text.includes(k)), why);
  const mj = await get('/music.js'); const pl = JSON.parse((await get('/music/playlist.json')).text);
  const ctxm = { window: {}, Uint8Array, Math, Error, String, Number }; vm.createContext(ctxm); vm.runInContext(mj.text, ctxm);
  let songsOk = pl.length === 3; const counts = [];
  for (const it of pl) { const r = await fetch(BASE + '/music/' + encodeURIComponent(it.file)); const b = await r.arrayBuffer(); try { const s = ctxm.window.SimMidi.parseMidi(b); counts.push(s.notes.length + 'โน้ต/' + Math.round(s.length) + 'วิ'); if (s.notes.length < 100 || s.length < 30) songsOk = false; } catch (e) { songsOk = false; counts.push(e.message); } }
  check('เพลงประกอบ: music.js อ่านไฟล์ .mid ได้ครบ 3 เพลง (มีโน้ต ยาว >30 วิ)', songsOk && /id="musicBtn"/.test(sim.text) && /\/music\.js/.test(sim.text), counts.join(', '));
  // ตัวจัดคิวเพลงต้องไม่ค้าง: จำลองเวลา 300 วินาทีทุก 0.25 วิ (เหมือน setInterval จริง) ต้องวนเพลงหลายรอบและส่งโน้ตครบพอดี ไม่ซ้ำ ไม่วนไม่รู้จบ
  {
    const song = ctxm.window.SimMidi.parseMidi(await (await fetch(BASE + '/music/' + encodeURIComponent(pl[0].file))).arrayBuffer());
    const period = song.length + 1.5, me = { t0: 0.15, idx: 0, loop: 0 }; let emitted = 0, ok2 = true, last = -1;
    const t0 = Date.now();
    for (let now = 0; now <= 300; now += 0.25) ctxm.window.SimMidi.schedule(me, song, period, now, 1.2, (n, when) => { emitted++; if (when < last - 1e-6 && n.t > 0 && false) ok2 = false; last = when; });
    let expected = 0; for (let L = 0; ; L++) { const c = song.notes.filter((n) => 0.15 + L * period + n.t <= 300 + 1.2).length; if (!c) break; expected += c; }
    check('เพลงวนซ้ำไม่ค้าง (จำลอง 300 วินาที)', Date.now() - t0 < 2000 && me.loop >= 4 && emitted === expected && ok2, 'วน ' + me.loop + ' รอบ, ส่ง ' + emitted + '/' + expected + ' โน้ต, ใช้เวลา ' + (Date.now() - t0) + ' มิลลิวินาที');
  }
  const home = await get('/');
  check('หน้าหลักยังเป็นหน้าเลขา (ไม่ถูก /sim แย่ง)', home.status === 200 && /id="menuBtn"/.test(home.text));
  const other = await get('/something-else');
  check('เส้นทางอื่นยังตกไปหน้าเลขาเหมือนเดิม', /id="menuBtn"/.test(other.text));

  server.close();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทั้งหมด');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e.message); process.exit(1); });
