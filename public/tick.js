// เสียงแจ้งสถานะเลขา (ใช้ตอนเสียบหูฟังไม่ได้ดูจอ):
//  - ติ๊กๆ แบบเมโทรนอม ตอนเลขากำลังคิด
//  - ตี๊ดๆ (2 จังหวะ) ตอนเลขาพูดจบ = ถึงตาเราพูดได้แล้ว
// ตั้งค่าความดังได้ในหน้าต่างกลางจอ (กดรูปเลขา AI) — จำค่าไว้ในเครื่อง
(function () {
  'use strict';
  var KEY = 'aq_tick_vol';
  var vol = 0.5;
  try { var v = localStorage.getItem(KEY); if (v !== null && !isNaN(parseFloat(v))) vol = Math.min(1, Math.max(0, parseFloat(v))); } catch (e) { /* ไม่เป็นไร */ }
  var ctx = null, timer = null;

  function beep(freq, at, dur, gainMul) {
    if (vol <= 0) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + (at || 0), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * (gainMul || 0.25)), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* ไม่เป็นไร */ }
  }
  function click() { beep(1500, 0, 0.05); }
  function doneBeep() { beep(1100, 0, 0.09, 0.3); beep(1500, 0.16, 0.12, 0.3); } // ตี๊ด-ดึ๊ด
  function start() { if (timer) return; click(); timer = setInterval(click, 650); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  var pop = null, overlay = null;
  function open() {
    if (overlay) return;
    overlay = document.createElement('div'); overlay.id = 'tickOverlay';
    pop = document.createElement('div'); pop.id = 'tickPop';
    var title = document.createElement('div'); title.className = 'tt'; title.textContent = '🔊 เสียงประมวลผล';
    var note = document.createElement('div'); note.className = 'tn';
    note.textContent = 'ติ๊กๆ = เลขากำลังคิด · ตี๊ดๆ = เลขาพูดจบ ถึงตาคุณพูดได้แล้ว (เลื่อนไปซ้ายสุด = ปิดเสียง)';
    var rng = document.createElement('input'); rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.value = String(Math.round(vol * 100));
    var lab = document.createElement('div'); lab.className = 'tv';
    function paint() { lab.textContent = vol <= 0 ? 'ปิดเสียง' : 'ความดัง ' + Math.round(vol * 100) + '%'; }
    paint();
    rng.addEventListener('input', function () {
      vol = parseInt(rng.value, 10) / 100; paint();
      try { localStorage.setItem(KEY, String(vol)); } catch (e) { /* ไม่เป็นไร */ }
    });
    var row = document.createElement('div'); row.className = 'tb';
    function mk(t, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.addEventListener('click', fn); return b; }
    row.append(mk('ลองฟังติ๊ก', function () { click(); setTimeout(click, 300); setTimeout(click, 600); }), mk('ลองฟังตี๊ด', doneBeep), mk('ปิด', close));
    pop.append(title, note, rng, lab, row);
    overlay.appendChild(pop);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }
  function close() { if (overlay) { overlay.remove(); overlay = null; pop = null; } }

  window.aqTick = {
    open: open,
    // เรียกทุกครั้งที่สถานะบอทเปลี่ยน
    state: function (prev, next) {
      if (next === 'thinking') start(); else stop();
      if (prev === 'speaking' && (next === 'idle' || next === 'listening')) doneBeep();
    }
  };
})();
