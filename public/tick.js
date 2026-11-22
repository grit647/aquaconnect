// เสียงประมวลผล: ติ๊กๆ แบบเมโทรนอมตอนเลขากำลังคิด + ปุ่มฟันเฟืองมุมขวาล่างปรับความดัง
(function () {
  'use strict';
  var KEY = 'aq_tick_vol';
  var vol = 0.5;
  try { var v = localStorage.getItem(KEY); if (v !== null && !isNaN(parseFloat(v))) vol = Math.min(1, Math.max(0, parseFloat(v))); } catch (e) { /* ไม่เป็นไร */ }
  var ctx = null, timer = null;

  function click() {
    if (vol <= 0) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 1500;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.25), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.06);
    } catch (e) { /* ไม่เป็นไร */ }
  }
  function start() { if (timer) return; click(); timer = setInterval(click, 650); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  window.aqTick = { set: function (thinking) { if (thinking) start(); else stop(); } };

  // ---------- ปุ่มฟันเฟือง + หน้าต่างปรับความดัง ----------
  var btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'tickGear'; btn.title = 'เสียงประมวลผล'; btn.setAttribute('aria-label', 'เสียงประมวลผล'); btn.textContent = '⚙️';
  var pop = document.createElement('div');
  pop.id = 'tickPop'; pop.hidden = true;
  var title = document.createElement('div'); title.className = 'tt'; title.textContent = '🔊 เสียงประมวลผล';
  var note = document.createElement('div'); note.className = 'tn'; note.textContent = 'เสียงติ๊กๆ ตอนเลขากำลังคิด (เลื่อนไปซ้ายสุด = ปิดเสียง)';
  var rng = document.createElement('input'); rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.value = String(Math.round(vol * 100));
  var lab = document.createElement('div'); lab.className = 'tv';
  function paint() { lab.textContent = vol <= 0 ? 'ปิดเสียง' : 'ความดัง ' + Math.round(vol * 100) + '%'; }
  paint();
  rng.addEventListener('input', function () {
    vol = parseInt(rng.value, 10) / 100; paint();
    try { localStorage.setItem(KEY, String(vol)); } catch (e) { /* ไม่เป็นไร */ }
  });
  rng.addEventListener('change', click); // ลองฟังเสียงตัวอย่างตอนปล่อยแถบเลื่อน
  pop.append(title, note, rng, lab);
  btn.addEventListener('click', function () { pop.hidden = !pop.hidden; });
  document.addEventListener('click', function (e) { if (!pop.hidden && e.target !== btn && !pop.contains(e.target)) pop.hidden = true; });
  document.body.append(btn, pop);
})();
