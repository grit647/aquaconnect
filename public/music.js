// เพลงประกอบหน้าโมเดลจำลอง — เล่นไฟล์ MIDI (.mid / .kar) ด้วยเสียงสังเคราะห์ของเบราว์เซอร์ (ไม่ต้องโหลดไลบรารี)
// เพลงอยู่ที่ public/music/ + รายการ playlist.json — เอาไฟล์ใหม่ใส่แล้วเพิ่มบรรทัดในรายการได้เลย
(function () {
  'use strict';

  // ---------- อ่านไฟล์ MIDI → รายการโน้ต {t วินาที, d ความยาว, n โน้ต, v แรง, ch ช่อง, p โปรแกรม} ----------
  function parseMidi(buf) {
    const u = new Uint8Array(buf); let pos = 0;
    const r32 = () => { const v = (u[pos] * 16777216) + (u[pos + 1] << 16) + (u[pos + 2] << 8) + u[pos + 3]; pos += 4; return v; };
    const r16 = () => { const v = (u[pos] << 8) | u[pos + 1]; pos += 2; return v; };
    const tag = () => String.fromCharCode(u[pos], u[pos + 1], u[pos + 2], u[pos + 3]);
    if (tag() !== 'MThd') throw new Error('ไม่ใช่ไฟล์ MIDI'); pos += 4;
    const hlen = r32(); r16(); const ntrk = r16(); const div = r16(); pos += hlen - 6;
    if (div & 0x8000) throw new Error('ไม่รองรับ SMPTE');
    const events = []; const tempos = [];
    for (let k = 0; k < ntrk && pos < u.length; k++) {
      if (tag() !== 'MTrk') break; pos += 4; const len = r32(); const end = pos + len; let tick = 0, run = 0;
      const vl = () => { let v = 0, b; do { b = u[pos++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
      while (pos < end) {
        tick += vl(); let st = u[pos];
        if (st < 0x80) st = run; else { pos++; if (st < 0xf0) run = st; }
        if (st === 0xff) { const type = u[pos++]; const l = vl(); if (type === 0x51 && l === 3) tempos.push({ tick, us: (u[pos] << 16) | (u[pos + 1] << 8) | u[pos + 2] }); pos += l; }
        else if (st === 0xf0 || st === 0xf7) { pos += vl(); }
        else {
          const type = st & 0xf0, ch = st & 15;
          if (type === 0xc0 || type === 0xd0) { const a = u[pos++]; if (type === 0xc0) events.push({ tick, k: 'p', ch, a }); }
          else { const a = u[pos++], b = u[pos++]; if (type === 0x90 && b > 0) events.push({ tick, k: 'on', ch, a, b }); else if (type === 0x80 || type === 0x90) events.push({ tick, k: 'off', ch, a }); }
        }
      }
      pos = end;
    }
    tempos.sort((a, b) => a.tick - b.tick); if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, us: 500000 });
    const toSec = (tick) => { let s = 0, lastT = 0, us = tempos[0].us; for (let i = 1; i < tempos.length && tempos[i].tick < tick; i++) { s += (tempos[i].tick - lastT) * us / div / 1e6; lastT = tempos[i].tick; us = tempos[i].us; } return s + (tick - lastT) * us / div / 1e6; };
    events.sort((a, b) => a.tick - b.tick);
    const prog = new Array(16).fill(0), open = {}, notes = [];
    events.forEach((e) => {
      if (e.k === 'p') prog[e.ch] = e.a;
      else if (e.k === 'on') { const key = e.ch + ':' + e.a; (open[key] = open[key] || []).push({ tick: e.tick, v: e.b, p: prog[e.ch] }); }
      else { const q = open[e.ch + ':' + e.a]; if (q && q.length) { const o = q.shift(); notes.push({ t: toSec(o.tick), d: Math.max(0.05, toSec(e.tick) - toSec(o.tick)), n: e.a, v: o.v, ch: e.ch, p: o.p }); } }
    });
    notes.sort((a, b) => a.t - b.t);
    const length = notes.length ? Math.max(...notes.map((x) => x.t + x.d)) : 0;
    return { notes, length };
  }
  // ตัวจัดคิวโน้ตล่วงหน้า (ฟังก์ชันล้วน ทดสอบได้): ส่งโน้ตที่ถึงเวลาภายใน lookahead วินาทีข้างหน้า และวนเพลงซ้ำเมื่อจบ
  // (บั๊กเดิม 2026-11-27: คำนวณ horizon นอกลูป พอเพลงจบแล้ววนซ้ำไม่รู้จบ → หน้าเว็บค้างทั้งหน้า — ตอนนี้คำนวณใหม่ทุกรอบ + มีตัวกันวนเกิน)
  function schedule(me, song, period, now, lookahead, emit) {
    for (let guard = 0; guard < 3000; guard++) {
      const horizon = now + lookahead - me.t0 - me.loop * period;
      if (me.idx >= song.notes.length) { if (horizon >= period) { me.loop++; me.idx = 0; continue; } return; }
      const n = song.notes[me.idx]; if (n.t > horizon) return;
      emit(n, me.t0 + me.loop * period + n.t); me.idx++;
    }
  }
  if (typeof window !== 'undefined') window.SimMidi = { parseMidi, schedule };
  if (typeof document === 'undefined' || !document.getElementById('musicBtn')) return;

  // ---------- เครื่องเล่น (เสียงสังเคราะห์ด้วย WebAudio) ----------
  const $ = (id) => document.getElementById(id);
  const KEY = 'simMusic';
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* ไม่มี localStorage ก็ไม่เป็นไร */ }
  const st = { vol: saved.vol == null ? 0.5 : saved.vol, muted: !!saved.muted, track: saved.track || 0, list: [], ctx: null, master: null, cur: null, timer: null, started: false };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ vol: st.vol, muted: st.muted, track: st.track })); } catch (e) { /* ข้าม */ } };

  function timbre(p, ch) { // เลือกลักษณะเสียงตามชนิดเครื่องดนตรีใน MIDI
    if (ch === 9) return null;                                            // กลอง — ข้าม (เสียงสังเคราะห์ยังไม่รองรับ)
    if (p >= 40 && p <= 55 || p >= 88 && p <= 95) return { w: 'sine', a: 0.35, r: 0.6, g: 0.5 };   // เครื่องสาย/แพด
    if (p >= 56 && p <= 79) return { w: 'sine', a: 0.04, r: 0.25, g: 0.7 };                         // เป่า/ทองเหลือง
    if (p >= 24 && p <= 39) return { w: 'triangle', a: 0.01, r: 0.15, g: 0.8, pluck: 1 };           // กีตาร์/เบส
    if (p >= 8 && p <= 15) return { w: 'sine', a: 0.005, r: 1.2, g: 0.6, pluck: 1 };                // ระฆัง
    return { w: 'triangle', a: 0.01, r: 0.3, g: 0.7, pluck: 1 };                                    // เปียโน/อื่นๆ
  }
  function playNote(n, when) {
    const tb = timbre(n.p, n.ch); if (!tb) return;
    const ctx = st.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tb.w; o.frequency.value = 440 * Math.pow(2, (n.n - 69) / 12);
    const peak = (n.v / 127) * 0.22 * tb.g, end = when + n.d;
    g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(peak, when + tb.a);
    if (tb.pluck) g.gain.exponentialRampToValueAtTime(peak * 0.35, when + Math.min(n.d, 1.2));
    if (!tb.pluck) g.gain.setValueAtTime(peak, Math.max(end, when + tb.a)); // เสียงยืด: คงระดับจนจบโน้ตแล้วค่อยจาง
    g.gain.exponentialRampToValueAtTime(0.0001, end + tb.r);
    o.connect(g); g.connect(st.master); o.start(when); o.stop(end + tb.r + 0.05);
  }
  function ensureCtx() {
    if (st.ctx) return st.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    st.ctx = new AC(); const comp = st.ctx.createDynamicsCompressor(); st.master = st.ctx.createGain();
    st.master.gain.value = st.muted ? 0 : st.vol; st.master.connect(comp); comp.connect(st.ctx.destination); return st.ctx;
  }
  function stop() { clearInterval(st.timer); st.timer = null; if (st.cur) st.cur.stopped = true; st.cur = null; }
  async function play(i) {
    const ctx = ensureCtx(); if (!ctx || !st.list.length) return;
    stop(); st.track = ((i % st.list.length) + st.list.length) % st.list.length; save(); render();
    const item = st.list[st.track];
    let song; try { const res = await fetch('/music/' + encodeURIComponent(item.file)); song = parseMidi(await res.arrayBuffer()); } catch (e) { toast('เปิดเพลงไม่ได้: ' + item.title); return; }
    if (ctx.state === 'suspended') await ctx.resume();
    const me = { stopped: false, t0: ctx.currentTime + 0.15, idx: 0, loop: 0, song }; st.cur = me;
    const period = song.length + 1.5;
    const tick = () => { if (!me.stopped) schedule(me, song, period, ctx.currentTime, 1.2, playNote); };
    st.timer = setInterval(tick, 250); tick();
  }
  function toast(m) { const t = $('toast'); if (!t) return; t.textContent = m; t.hidden = false; setTimeout(() => { t.hidden = true; }, 2200); }

  function render() {
    const box = $('musicList'); if (!box) return; box.textContent = '';
    st.list.forEach((it, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pick-opt' + (i === st.track && st.cur ? ' on' : '');
      b.textContent = (i === st.track && st.cur ? '▶ ' : '') + it.title; b.addEventListener('click', () => { st.muted = false; applyVol(); play(i); }); box.appendChild(b);
    });
    $('musicMute').textContent = st.muted ? '🔇 เปิดเสียง' : '🔊 ปิดเสียง';
    $('musicBtn').textContent = st.muted || !st.cur ? '🔇' : '🎵'; $('musicVol').value = String(Math.round(st.vol * 100));
  }
  function applyVol() { if (st.master) st.master.gain.setTargetAtTime(st.muted ? 0 : st.vol, st.ctx.currentTime, 0.05); save(); render(); }

  async function loadList() { try { st.list = await (await fetch('/music/playlist.json')).json(); } catch (e) { st.list = []; } render(); }
  function startIfNeeded() { if (st.started || st.muted || !st.list.length) return; st.started = true; play(st.track); }

  $('musicBtn').addEventListener('click', () => { $('musicBox').hidden = false; render(); });
  $('musicClose').addEventListener('click', () => { $('musicBox').hidden = true; });
  $('musicBox').addEventListener('click', (e) => { if (e.target === $('musicBox')) $('musicBox').hidden = true; });
  $('musicMute').addEventListener('click', () => { st.muted = !st.muted; if (!st.muted && !st.cur) { st.started = true; play(st.track); } applyVol(); });
  $('musicVol').addEventListener('input', () => { st.vol = Number($('musicVol').value) / 100; if (st.muted && st.vol > 0) st.muted = false; applyVol(); });
  $('startBtn').addEventListener('click', startIfNeeded);              // เริ่มเล่นพร้อมกดเริ่มเกม (ต้องมีการแตะก่อน เบราว์เซอร์ถึงยอมให้มีเสียง)
  // ปิดหน้า/ปิดโปรแกรม/สลับไปหน้าอื่น = ปิดระบบเสียงทิ้งทั้งหมด (กันเสียงค้างหลังออกจากเกม)
  const killAudio = () => { stop(); if (st.ctx) { try { st.ctx.close(); } catch (e) { /* ข้าม */ } st.ctx = null; st.master = null; } render(); };
  window.addEventListener('pagehide', killAudio); window.addEventListener('beforeunload', killAudio);
  window.addEventListener('pageshow', (e) => { if (e.persisted && st.started && !st.muted && st.list.length) play(st.track); });   // กลับมาจากแคชหน้า (ปุ่มย้อนกลับ) → เล่นใหม่
  document.addEventListener('visibilitychange', () => { if (!st.ctx) return; if (document.hidden) { st.ctx.suspend(); } else if (!st.muted) st.ctx.resume(); });
  loadList();
})();
