// สร้างเพลง MIDI มาตรฐาน 3 เพลงสำหรับหน้าโมเดลจำลอง (เพลงแต่งเองแบบง่าย ไม่มีลิขสิทธิ์)
//   node tools/make-sim-midi.js   → public/music/*.mid
// อยากเปลี่ยนเพลง: เอาไฟล์ .mid/.kar ใส่โฟลเดอร์ public/music แล้วเพิ่มบรรทัดใน public/music/playlist.json
const fs = require('fs'); const path = require('path');
const PPQ = 480;
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
function song({ bpm, notes, programs }) {
  const ev = [];
  ev.push({ t: 0, b: [0xff, 0x51, 3, ...[(60000000 / bpm) >> 16 & 255, (60000000 / bpm) >> 8 & 255, (60000000 / bpm) & 255]] });
  Object.entries(programs).forEach(([ch, p]) => ev.push({ t: 0, b: [0xc0 | ch, p] }));
  notes.forEach(([ch, pitch, startBeat, durBeat, vel]) => {
    const s = Math.round(startBeat * PPQ), e = Math.round((startBeat + durBeat) * PPQ);
    ev.push({ t: s, b: [0x90 | ch, pitch, vel] }); ev.push({ t: e, b: [0x80 | ch, pitch, 0], off: 1 });
  });
  const end = Math.max(...ev.map((x) => x.t)) + PPQ;
  ev.push({ t: end, b: [0xff, 0x2f, 0] });
  ev.sort((a, b) => a.t - b.t || (b.off ? 1 : 0) - (a.off ? 1 : 0) || 0);
  let last = 0; const body = [];
  ev.forEach((x) => { body.push(...vlq(x.t - last), ...x.b); last = x.t; });
  const head = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, PPQ >> 8, PPQ & 255]);
  const trk = Buffer.concat([Buffer.from([0x4d, 0x54, 0x72, 0x6b]), Buffer.from([(body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255]), Buffer.from(body)]);
  return Buffer.concat([head, trk]);
}
const rep = (n, f) => { for (let i = 0; i < n; i++) f(i); };

// 1) บ่อสงบ — C เมเจอร์ ช้า อาร์เพจิโอเปียโน + แพด + ฟลุต
(function () {
  const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]], mel = [[[76, 2], [74, 1], [72, 1]], [[72, 2], [74, 1], [76, 1]], [[77, 2], [76, 1], [74, 1]], [[74, 2], [72, 1], [67, 1]]];
  const notes = [];
  rep(16, (bar) => {
    const c = chords[bar % 4], b0 = bar * 4;
    notes.push([1, c[0] + 12, b0, 4, 40], [1, c[1] + 12, b0, 4, 40], [1, c[2] + 12, b0, 4, 40]);
    [c[0] + 12, c[1] + 12, c[2] + 12, c[0] + 24, c[2] + 12, c[1] + 12, c[0] + 24, c[1] + 12].forEach((p, i) => notes.push([0, p, b0 + i * 0.5, 0.5, 52]));
    if (bar >= 4 && bar < 12) { let t = b0; mel[bar % 4].forEach(([p, d]) => { notes.push([2, p, t, d, 62]); t += d; }); }
  });
  fs.writeFileSync(path.join(__dirname, '../public/music/song1-calm.mid'), song({ bpm: 72, notes, programs: { 0: 0, 1: 89, 2: 73 } }));
})();
// 2) เช้าที่ฟาร์ม — G เมเจอร์ สดใส เบส + กีตาร์คอร์ด + ลีด
(function () {
  const chords = [[55, 59, 62], [50, 54, 57], [52, 55, 59], [48, 52, 55]], roots = [43, 38, 40, 36];
  const mel = [[[79, .5], [81, .5], [83, 1], [81, 1], [79, 1]], [[78, .5], [79, .5], [81, 1], [78, 1], [74, 1]], [[76, .5], [79, .5], [83, 1], [79, 1], [76, 1]], [[79, 1], [76, .5], [74, .5], [72, 2]]];
  const notes = [];
  rep(16, (bar) => {
    const c = chords[bar % 4], b0 = bar * 4;
    [0, 1, 2, 3].forEach((i) => notes.push([3, roots[bar % 4] + (i % 2 ? 7 : 0), b0 + i, 0.9, 70]));
    [0.5, 1.5, 2.5, 3.5].forEach((o) => c.forEach((p) => notes.push([0, p + 12, b0 + o, 0.4, 48])));
    if (bar >= 2 && bar < 14) { let t = b0; mel[bar % 4].forEach(([p, d]) => { notes.push([2, p, t, d * 0.95, 66]); t += d; }); }
  });
  fs.writeFileSync(path.join(__dirname, '../public/music/song2-morning.mid'), song({ bpm: 104, notes, programs: { 0: 24, 2: 80, 3: 32 } }));
})();
// 3) คลื่นยามค่ำ — A ไมเนอร์ ช้ามาก แพด + ระฆังเป็นระยะ + เสียงต่ำ
(function () {
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], roots = [33, 29, 36, 31], bells = [[81, 76, 72, 69], [77, 72, 69, 65], [79, 76, 72, 67], [79, 74, 71, 67]];
  const notes = [];
  rep(16, (bar) => {
    const c = chords[bar % 4], b0 = bar * 4;
    c.forEach((p) => notes.push([1, p, b0, 4, 46]));
    notes.push([3, roots[bar % 4], b0, 4, 50]);
    [0, 1.5, 3].forEach((o, i) => notes.push([0, bells[bar % 4][i], b0 + o, 1.5, 50]));
  });
  fs.writeFileSync(path.join(__dirname, '../public/music/song3-night.mid'), song({ bpm: 60, notes, programs: { 0: 9, 1: 89, 3: 38 } }));
})();
fs.writeFileSync(path.join(__dirname, '../public/music/playlist.json'), JSON.stringify([
  { file: 'song1-calm.mid', title: '🌿 บ่อสงบ' },
  { file: 'song2-morning.mid', title: '☀️ เช้าที่ฟาร์ม' },
  { file: 'song3-night.mid', title: '🌙 คลื่นยามค่ำ' },
], null, 2));
console.log('ok');
