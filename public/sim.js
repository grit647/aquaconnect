// หน้าโมเดลจำลองการเลี้ยงกุ้ง — ต้นแบบหน้าจอ (ยังไม่มีการคำนวณ ค่าทุกตัวเป็น "–")
// แผนงานเต็ม: D:\shrimp-sim\PLAN.md — แกนจำลองเคมี/ชีววิทยา, แมมแพคสิ่งมีชีวิต, เหตุการณ์, ต้นทุน จะมาแทนค่า "–" ทีหลัง
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ค่าบนแดชบอร์ดน้ำ 10 ตัว (เจ้าของกำหนด 2026-11-27: 9 ตัวแรก + DO เป็นตัวที่ 10)
  const PARAMS = [
    { key: 'ph', label: 'pH', unit: '' },
    { key: 'alk', label: 'อัลคาไลน์', unit: 'มก./ล.' },
    { key: 'temp', label: 'อุณหภูมิ', unit: '°C' },
    { key: 'ca', label: 'แคลเซียม', unit: 'มก./ล.' },
    { key: 'mg', label: 'แมกนีเซียม', unit: 'มก./ล.' },
    { key: 'sal', label: 'ความเค็ม', unit: 'ppt' },
    { key: 'tan', label: 'แอมโมเนีย (TAN)', unit: 'มก./ล.' },
    { key: 'no2', label: 'ไนไตรท์', unit: 'มก./ล.' },
    { key: 'secchi', label: 'ความขุ่นใส', unit: 'ซม.' },
    { key: 'do', label: 'ออกซิเจน (DO)', unit: 'มก./ล.' },
  ];
  const PONDS = { canal: '① คลอง (แหล่งน้ำธรรมชาติ)', reservoir: '② บ่อพัก', culture: '③ บ่อเลี้ยง' };
  const ACTS = {
    feed: 'ให้อาหาร — เร็วๆ นี้ (เลือกปริมาณ/มื้อ ดูถาดเช็คอาหาร)',
    aerator: 'เครื่องตีน้ำ — เร็วๆ นี้ (เลือกจำนวน/ชั่วโมง คิดค่าไฟ)',
    pump: 'สูบ/เติม/ถ่ายน้ำ — เร็วๆ นี้ (คลอง→บ่อพัก→บ่อเลี้ยง คิดค่าไฟ/น้ำมัน)',
    lime: 'ปูน/แร่ธาตุ — เร็วๆ นี้ (เลือกชนิด+ปริมาณ แล้วดูผลต่อค่าน้ำ)',
    probiotic: 'จุลินทรีย์/สารปรับน้ำ — เร็วๆ นี้',
    testwater: 'ตรวจน้ำ — เร็วๆ นี้ (โหมดยาก: ชุดตรวจมีดีเลย์/คลาดเคลื่อน)',
    tray: 'เช็คถาดอาหาร — เร็วๆ นี้',
    sample: 'สุ่มชั่งกุ้ง — เร็วๆ นี้ (สุ่มบ่อยแม่นขึ้นแต่กุ้งเครียด)',
    harvest: 'จับกุ้ง — เร็วๆ นี้ (เลือกไซส์/จังหวะ ดูราคาตลาด)',
  };

  const state = { pond: 'culture', started: false, speed: 0, water: 0, cfg: null };

  // ----- สร้างการ์ดค่าน้ำ -----
  function renderParams() {
    const box = $('params'); box.textContent = '';
    PARAMS.forEach((p) => {
      const d = document.createElement('div'); d.className = 'param'; d.dataset.key = p.key;
      const l = document.createElement('div'); l.className = 'pl'; l.textContent = p.label;
      const v = document.createElement('div'); v.className = 'pv';
      const val = document.createElement('span'); val.className = 'val'; val.textContent = '–';
      v.appendChild(val);
      if (p.unit) { const u = document.createElement('small'); u.textContent = p.unit; v.appendChild(u); }
      const dot = document.createElement('i'); dot.className = 'dot';
      d.append(l, v, dot); box.appendChild(d);
    });
  }

  // ----- toast -----
  let tt = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function log(msg) {
    const b = $('logBody');
    if (b.firstChild && b.firstChild.classList && b.firstChild.classList.contains('muted')) b.textContent = '';
    const d = document.createElement('div'); d.textContent = msg; b.insertBefore(d, b.firstChild);
  }

  // ----- เลือกบ่อ -----
  function selectPond(key) {
    if (!PONDS[key]) return;
    state.pond = key;
    qsa('.pond', $('pondTabs')).forEach((b) => b.classList.toggle('on', b.dataset.pond === key));
    qsa('.node', $('scene')).forEach((g) => g.classList.toggle('on', g.dataset.pond === key));
    $('pondName').textContent = PONDS[key];
  }
  qsa('.pond', $('pondTabs')).forEach((b) => b.addEventListener('click', () => selectPond(b.dataset.pond)));
  qsa('.node', $('scene')).forEach((g) => g.addEventListener('click', () => { selectPond(g.dataset.pond); if (g.dataset.pond === 'culture' && window.__openPond3d) window.__openPond3d(); }));

  // ----- แท็บขวา -----
  qsa('.tab', $('tabs')).forEach((b) => b.addEventListener('click', () => {
    qsa('.tab', $('tabs')).forEach((x) => x.classList.toggle('on', x === b));
    qsa('.panel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + b.dataset.tab));
  }));

  // ----- ปุ่มจัดการ (ยังไม่ทำงานจริง) -----
  qsa('[data-act]', $('actions')).forEach((b) => b.addEventListener('click', () => {
    if (!state.started) { toast('กด "เริ่มเกม" ก่อนครับ'); $('setup').hidden = false; return; }
    if (b.dataset.act === 'pump') { if (state.pond === 'canal') { toast('คลองเป็นแหล่งน้ำธรรมชาติ — เลือก ② บ่อพัก หรือ ③ บ่อเลี้ยง แล้วกดสูบน้ำ'); return; } openPump(state.pond); return; }
    toast(ACTS[b.dataset.act] || 'เร็วๆ นี้');
  }));

  // ----- ความเร็วเวลา (ปุ่มเปลี่ยนสถานะอย่างเดียว) -----
  qsa('.sp').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.sp))));

  // ----- เต็มจอ + ล็อกแนวนอน (ใช้ได้เฉพาะบางเบราว์เซอร์) -----
  $('fsBtn').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else if (document.exitFullscreen && document.fullscreenElement) await document.exitFullscreen();
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) { toast('เบราว์เซอร์นี้ไม่รองรับการล็อกแนวนอน — หมุนจอเองได้เลยครับ'); }
  });

  // ----- ปุ่มซ่อน/ยืดเมนูซ้าย-ขวา (ฉากกลางเต็มจอ) -----
  function togglePanel(side) {
    const el = document.querySelector(side === 'l' ? '.left' : '.right'); const btn = $(side === 'l' ? 'edgeL' : 'edgeR');
    const open = !el.classList.contains('open');
    el.classList.toggle('open', open);
    btn.textContent = open ? '✕ ปิด' : (side === 'l' ? '☰ จัดการ' : '📊 ค่า/ต้นทุน');
  }
  $('edgeL').addEventListener('click', () => togglePanel('l'));
  $('edgeR').addEventListener('click', () => togglePanel('r'));

  // ----- ตัวเลือกที่วาดเอง แทน <select> ของระบบ (ป๊อปอัประบบไม่หมุนตามภาพตอนถือแนวตั้ง) -----
  qsa('select', $('setup')).forEach((sel) => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'selbtn';
    const sync = () => { btn.textContent = sel.options[sel.selectedIndex].text; };
    sync(); sel.addEventListener('change', sync); sel.parentNode.appendChild(btn);
    btn.addEventListener('click', () => {
      const label = sel.parentNode.firstChild.textContent.trim();
      $('pickTitle').textContent = label; const list = $('pickList'); list.textContent = '';
      Array.from(sel.options).forEach((o, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'pick-opt' + (i === sel.selectedIndex ? ' on' : '');
        b.textContent = o.text; b.disabled = o.disabled;
        b.addEventListener('click', () => { sel.selectedIndex = i; sync(); $('picker').hidden = true; });
        list.appendChild(b);
      });
      $('picker').hidden = false;
    });
  });
  $('picker').addEventListener('click', (e) => { if (e.target === $('picker')) $('picker').hidden = true; });

  // ----- หน้าตั้งค่าเริ่มเกม -----
  const fmt = (n) => Number(n).toLocaleString('th-TH');
  const setDis = (id, test) => { Array.from($(id).options).forEach((o) => { o.disabled = test(o.value); }); };
  const setVal = (id, v) => { $(id).value = String(v); $(id).dispatchEvent(new Event('change')); };
  const MIX_RAI = [3, 4, 5];
  function stockInfo() {
    const rai = Number($('fSize').value), max = rai * 300000, v = Number($('fStock').value) || 0;
    $('fStockHint').textContent = 'ปล่อยได้ 50,000 – ' + fmt(max) + ' ตัว (ไม่เกิน 3 แสนตัว/ไร่) • ตอนนี้ ≈ ' + Math.round(v / (rai * 1600)) + ' ตัว/ตร.ม.';
    return { rai, max, v };
  }
  function applyRules() {
    const mix = $('fSpecies').value === 'mix';
    setDis('fSystem', (v) => mix && v !== 'earth'); setDis('fSalinity', (v) => mix && v !== '0'); setDis('fSize', (v) => mix && !MIX_RAI.includes(Number(v)));
    if (mix) { setVal('fSystem', 'earth'); setVal('fSalinity', '0'); if (Number($('fSize').value) < 3) setVal('fSize', '3'); }
    $('fRule').textContent = mix ? 'กุ้งขาวผสมก้ามกราม: เลี้ยงได้เฉพาะบ่อดิน • ความเค็ม 0 ppt • ขนาดบ่อ 3 / 4 / 5 ไร่ เท่านั้น' : '';
    const i = stockInfo(); if (i.v > i.max) { $('fStock').value = String(i.max); stockInfo(); }
  }
  $('fSpecies').addEventListener('change', applyRules); $('fSize').addEventListener('change', applyRules);
  $('fStock').addEventListener('input', stockInfo);
  $('fLevel').addEventListener('input', () => { $('fLevelVal').textContent = Number($('fLevel').value).toFixed(1); });
  applyRules();

  $('startBtn').addEventListener('click', () => {
    const sel = (id) => { const s = $(id); return s.options[s.selectedIndex].text; };
    const i = stockInfo();
    if (!(i.v >= 50000 && i.v <= i.max)) { toast('จำนวนที่ปล่อยต้องอยู่ระหว่าง 50,000 – ' + fmt(i.max) + ' ตัว'); $('fStock').focus(); return; }
    const name = ($('fName').value || '').trim() || 'ฟาร์มของฉัน';
    const level = Number($('fLevel').value), resv = Math.round((1 + Math.random() * 2) * 10) / 10, pe = $('fSystem').value === 'pe';
    state.cfg = { name, species: $('fSpecies').value, system: $('fSystem').value, salinity: Number($('fSalinity').value), rai: i.rai, stock: i.v, level, province: $('fProvince').value, reservoir: { rai: 7, level: resv } };
    state.started = true;
    $('farmName').textContent = name;
    $('kvFarm').textContent = name; $('kvSpecies').textContent = sel('fSpecies'); $('kvSystem').textContent = sel('fSystem');
    $('kvSalinity').textContent = sel('fSalinity'); $('kvSize').textContent = sel('fSize'); $('kvStock').textContent = fmt(i.v) + ' ตัว';
    $('kvDensity').textContent = Math.round(i.v / (i.rai * 1600)) + ' ตัว/ตร.ม.'; $('kvLevel').textContent = level.toFixed(1) + ' ม. (ลึกสุด 3 ม.)';
    $('kvProvince').textContent = sel('fProvince'); $('kvResv').textContent = '7 ไร่ • น้ำ ' + resv.toFixed(1) + ' ม. (สูงสุด 3 ม.)';
    $('nodeCulSub').textContent = i.rai + ' ไร่ • บ่อแห้ง'; $('nodeResSub').textContent = '7 ไร่ • น้ำ ' + resv.toFixed(1) + ' ม.';
    $('chipDay').textContent = 'ก่อนปล่อยกุ้ง'; $('chipTime').textContent = '06:00'; $('chipWx').textContent = sel('fProvince'); $('chipCash').textContent = '–';
    window.__pond3dCfg = { rai: i.rai, pe, water: 0, shrimp: 0 };
    state.water = 0; state.simSec = 0; state.cost = { fuelL: 0, kwh: 0 }; state.pumps = { reservoir: null, culture: null };
    refreshSim();
    $('setup').hidden = true;
    log('เริ่มเกม: ' + name + ' • ' + sel('fSpecies') + ' • ' + sel('fSystem') + ' • ความเค็ม ' + $('fSalinity').value + ' ppt • บ่อ ' + i.rai + ' ไร่ • ปล่อย ' + fmt(i.v) + ' ตัว • ระดับน้ำ ' + level.toFixed(1) + ' ม.');
    log('บ่อเลี้ยงยังไม่มีน้ำ — ขั้นต่อไป: เตรียมบ่อ → เตรียมน้ำ → ปล่อยกุ้ง จึงเข้าสู่โหมดเลี้ยง (ยังไม่เปิดใช้ในต้นแบบ)');
    log('บ่อพัก 7 ไร่ มีน้ำเริ่มต้น ' + resv.toFixed(1) + ' ม. (สุ่มให้ ต่ำสุด 1 ม. สูงสุด 3 ม.)');
  });

  // ----- กราฟแท่ง "ระดับน้ำ" + "ความจุ" ใต้บ่อพัก/บ่อเลี้ยง (ความจุ = ปริมาตรน้ำ เทียบตอนเต็ม 3 ม. ของพื้นที่บ่อ) -----
  function setBar(id, val, max, txt) { $(id + 'Bar').setAttribute('width', String(Math.max(0, Math.min(1, max ? val / max : 0)) * 120)); $(id + 'Txt').textContent = txt; }
  function updateBars() {
    const c = state.cfg;
    if (!c) { ['resLv', 'resCap', 'culLv', 'culCap'].forEach((id) => setBar(id, 0, 1, id.indexOf('Lv') > 0 ? 'ระดับน้ำ –' : 'ความจุ –')); return; }
    const one = (pfx, area, lv) => {
      setBar(pfx + 'Lv', lv, 3, 'ระดับน้ำ ' + lv.toFixed(1) + ' / 3.0 ม.');
      setBar(pfx + 'Cap', area * lv, area * 3, 'ความจุ ' + fmt(Math.round(area * lv)) + ' / ' + fmt(area * 3) + ' ลบ.ม.');
    };
    one('res', c.reservoir.rai * 1600, c.reservoir.level);
    one('cul', c.rai * 1600, state.water || 0);
    const t = $('culTick'); t.setAttribute('x1', String(456 + 120 * c.level / 3)); t.setAttribute('x2', String(456 + 120 * c.level / 3)); t.setAttribute('visibility', 'visible');
  }
  updateBars();

  // ===== เวลาเกม + สูบน้ำ (เรียลไทม์: ระดับน้ำขึ้นตามอัตราสูบจริงของอุปกรณ์) =====
  const PRICE = { diesel: 40, kwh: 4.0 };   // ฿/ลิตร ดีเซล • ฿/หน่วย ไฟฟ้า (ค่าประมาณ ปรับได้)
  const PUMPS = {                            // q = ลบ.ม./ชม. (ค่าประมาณที่ระยะส่งต่ำของฟาร์ม) • lph = ลิตรดีเซล/ชม. • kw = กำลังไฟที่ใช้จริง
    engine: [
      { label: 'ท่อ 8 นิ้ว', hp: 20, q: 340, lph: 3.0 },
      { label: 'ท่อ 10 นิ้ว', hp: 30, q: 550, lph: 4.5 },
      { label: 'ท่อ 12 นิ้ว', hp: 40, q: 790, lph: 6.0 },
    ],
    electric: [
      { label: 'ท่อ 3 นิ้ว • มอเตอร์ 3 HP', hp: 3, q: 50, kw: 2.6 },
      { label: 'ท่อ 6 นิ้ว • มอเตอร์ 5 HP', hp: 5, q: 190, kw: 4.3 },
      { label: 'ท่อ 8 นิ้ว • มอเตอร์ 10 HP', hp: 10, q: 380, kw: 8.5 },
    ],
  };
  const PNAME = { reservoir: '② บ่อพัก', culture: '③ บ่อเลี้ยง' };
  const SRC_MIN = 0.3;                       // ระดับน้ำต่ำสุดที่ยังสูบจากบ่อพักได้ (ม.)
  Object.assign(state, { pumps: { reservoir: null, culture: null }, simSec: 0, cost: { fuelL: 0, kwh: 0 }, pumpSel: { mode: 'engine', idx: 0 }, pumpPond: null });
  const aRes = () => state.cfg.reservoir.rai * 1600;
  const pondArea = (k) => (k === 'reservoir' ? aRes() : state.cfg.rai * 1600);
  const pondLevel = (k) => (k === 'reservoir' ? state.cfg.reservoir.level : state.water);
  const setLevel = (k, v) => { if (k === 'reservoir') state.cfg.reservoir.level = v; else state.water = v; };
  const pondTarget = (k) => (k === 'reservoir' ? 3.0 : state.cfg.level);
  const eqOf = (m, i) => PUMPS[m][i];
  const hourCost = (eq) => (eq.lph ? eq.lph * PRICE.diesel : eq.kw * PRICE.kwh);
  const fmtDur = (h) => { const m = Math.round(h * 60); return m >= 60 ? Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' นาที' : m + ' นาที'; };
  const baht = (n) => '฿' + fmt(Math.round(n));
  function clockText() {
    const t = 6 * 3600 + state.simSec, d = Math.floor(t / 86400), s = t % 86400;
    return { hhmm: String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0'), day: d };
  }
  function setSpeed(n) {
    state.speed = n; qsa('.sp').forEach((x) => x.classList.toggle('on', Number(x.dataset.sp) === n));
    if (state.started) toast(n ? 'เดินเวลา ×' + n + (n === 1 ? ' (เรียลไทม์)' : '') : 'หยุดเวลา');
  }
  function openPump(k) {
    if (!state.started) { toast('กด "เริ่มเกม" ก่อนครับ'); $('setup').hidden = false; return; }
    state.pumpPond = k; $('pumpBox').hidden = false; renderPump();
  }
  function renderPump() {
    const k = state.pumpPond; if (!k) return;
    const run = state.pumps[k], lv = pondLevel(k), tg = pondTarget(k), ar = pondArea(k);
    $('pumpTitle').textContent = '🚰 สูบน้ำเข้า ' + PNAME[k];
    $('pumpInfo').textContent = (k === 'reservoir' ? 'สูบจาก ① คลอง' : 'สูบจาก ② บ่อพัก (น้ำในบ่อพักจะลดลงตามที่สูบ)') + ' • ระดับน้ำตอนนี้ ' + lv.toFixed(2) + ' ม. → เป้าหมาย ' + tg.toFixed(1) + ' ม. • พื้นที่ ' + fmt(ar) + ' ตร.ม.';
    $('pumpModes').hidden = !!run; $('pumpList').hidden = !!run;
    qsa('[data-pm]').forEach((b) => b.classList.toggle('on', b.dataset.pm === state.pumpSel.mode));
    const go = $('pumpGo');
    if (run) { updatePumpStatus(); go.textContent = '⏹ หยุดสูบ'; go.disabled = false; return; }
    const list = $('pumpList'); list.textContent = '';
    PUMPS[state.pumpSel.mode].forEach((eq, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pick-opt' + (i === state.pumpSel.idx ? ' on' : '');
      b.textContent = eq.label + (eq.lph ? ' • เครื่องยนต์ดีเซล ~' + eq.hp + ' แรงม้า' : '');
      const sm = document.createElement('small');
      sm.textContent = 'สูบได้ ~' + eq.q + ' ลบ.ม./ชม. • ' + (eq.lph ? 'น้ำมัน ' + eq.lph + ' ลิตร/ชม.' : 'ไฟ ' + eq.kw + ' kW') + ' ≈ ' + baht(hourCost(eq)) + '/ชม. • ≈ ฿' + (hourCost(eq) / eq.q).toFixed(2) + '/ลบ.ม.';
      b.appendChild(sm); b.addEventListener('click', () => { state.pumpSel.idx = i; renderPump(); }); list.appendChild(b);
    });
    const eq = eqOf(state.pumpSel.mode, state.pumpSel.idx), need = Math.max(0, (tg - lv) * ar);
    let est = need <= 0 ? 'ระดับน้ำถึงเป้าหมายแล้ว ไม่ต้องสูบเพิ่ม' : 'ต้องเติม ' + fmt(Math.round(need)) + ' ลบ.ม. → ใช้เวลาประมาณ ' + fmtDur(need / eq.q) + ' (เวลาเกมแบบเรียลไทม์) • ต้นทุนประมาณ ' + baht(need / eq.q * hourCost(eq));
    let can = need > 0;
    if (k === 'culture') { const avail = Math.max(0, (state.cfg.reservoir.level - SRC_MIN) * aRes()); if (avail < need) { est += ' • ⚠️ น้ำในบ่อพักมีให้ใช้ ~' + fmt(Math.round(avail)) + ' ลบ.ม. ไม่พอ ต้องสูบเข้าบ่อพักเพิ่มก่อน'; } if (avail <= 0) can = false; }
    $('pumpEst').textContent = est; go.textContent = '▶ เริ่มสูบ'; go.disabled = !can;
  }
  function updatePumpStatus() {
    const k = state.pumpPond, p = k && state.pumps[k]; if (!p) return;
    const eq = eqOf(p.mode, p.idx);
    $('pumpEst').textContent = 'กำลังสูบด้วย ' + eq.label + ' • ระดับน้ำ ' + pondLevel(k).toFixed(2) + ' → ' + pondTarget(k).toFixed(1) + ' ม. • สูบแล้ว ' + fmt(Math.round(p.vol)) + ' ลบ.ม. • ใช้เวลา ' + fmtDur(p.sec / 3600) + ' • ค่าใช้จ่ายรอบนี้ ' + baht(p.sec / 3600 * hourCost(eq));
  }
  function startPump(k) {
    const sel = state.pumpSel, eq = eqOf(sel.mode, sel.idx);
    if (state.pumps[k]) return;
    state.pumps[k] = { mode: sel.mode, idx: sel.idx, vol: 0, sec: 0 };
    if (!state.speed) setSpeed(1);
    log('[' + clockText().hhmm + '] เริ่มสูบเข้า ' + PNAME[k] + ' ด้วย ' + eq.label + (eq.lph ? ' (เครื่องยนต์)' : ' (ไฟฟ้า)') + ' • เป้าหมาย ' + pondTarget(k).toFixed(1) + ' ม.');
    renderPump(); refreshSim();
  }
  function stopPump(k, why) {
    const p = state.pumps[k]; if (!p) return; const eq = eqOf(p.mode, p.idx);
    state.pumps[k] = null;
    log('[' + clockText().hhmm + '] หยุดสูบ ' + PNAME[k] + (why ? ': ' + why : '') + ' • สูบแล้ว ' + fmt(Math.round(p.vol)) + ' ลบ.ม. ใช้เวลา ' + fmtDur(p.sec / 3600) + ' ค่าใช้จ่าย ' + baht(p.sec / 3600 * hourCost(eq)));
    if (state.pumpPond === k && !$('pumpBox').hidden) renderPump(); refreshSim();
  }
  function pumpTick(dt) {
    ['reservoir', 'culture'].forEach((k) => {
      const p = state.pumps[k]; if (!p) return;
      const eq = eqOf(p.mode, p.idx), qs = eq.q / 3600, ar = pondArea(k); let vol = qs * dt, why = '';
      const room = Math.max(0, (pondTarget(k) - pondLevel(k)) * ar);
      if (vol >= room) { vol = room; why = 'ถึงระดับเป้าหมายแล้ว'; }
      if (k === 'culture') { const avail = Math.max(0, (state.cfg.reservoir.level - SRC_MIN) * aRes()); if (vol >= avail) { vol = avail; why = 'น้ำในบ่อพักเหลือน้อย (ต่ำกว่า ' + SRC_MIN + ' ม.) สูบต่อไม่ได้'; } }
      setLevel(k, pondLevel(k) + vol / ar); if (k === 'culture') state.cfg.reservoir.level -= vol / aRes();
      const sec = vol / qs; if (eq.lph) state.cost.fuelL += eq.lph * sec / 3600; else state.cost.kwh += eq.kw * sec / 3600;
      p.vol += vol; p.sec += sec; if (why) stopPump(k, why);
    });
  }
  function refreshSim() {
    if (!state.cfg) return;
    const c = clockText(); $('chipTime').textContent = c.hhmm; $('chipDay').textContent = 'ก่อนปล่อยกุ้ง' + (c.day ? ' (+' + c.day + ' วัน)' : '');
    updateBars();
    if (window.__pond3dCfg) window.__pond3dCfg.water = state.water;
    const fuel = state.cost.fuelL * PRICE.diesel, el = state.cost.kwh * PRICE.kwh;
    $('costFuel').textContent = baht(fuel) + ' (' + state.cost.fuelL.toFixed(1) + ' ล.)'; $('costElec').textContent = baht(el) + ' (' + state.cost.kwh.toFixed(1) + ' หน่วย)'; $('costTotal').textContent = baht(fuel + el);
    qsa('.pump-btn').forEach((b) => { const run = !!state.pumps[b.dataset.pump]; b.classList.toggle('run', run); b.textContent = run ? '🚰 กำลังสูบ…' : '🚰 สูบน้ำ'; });
    if (!$('pumpBox').hidden && state.pumpPond && state.pumps[state.pumpPond]) updatePumpStatus();
  }
  qsa('.pump-btn').forEach((b) => b.addEventListener('click', () => openPump(b.dataset.pump)));
  qsa('[data-pm]').forEach((b) => b.addEventListener('click', () => { state.pumpSel = { mode: b.dataset.pm, idx: 0 }; renderPump(); }));
  $('pumpClose').addEventListener('click', () => { $('pumpBox').hidden = true; });
  $('pumpBox').addEventListener('click', (e) => { if (e.target === $('pumpBox')) $('pumpBox').hidden = true; });
  $('pumpGo').addEventListener('click', () => { const k = state.pumpPond; if (state.pumps[k]) stopPump(k, 'ผู้เล่นสั่งหยุด'); else startPump(k); });
  let lastT = performance.now();
  setInterval(() => {
    const now = performance.now(), dtReal = Math.min(1, (now - lastT) / 1000); lastT = now;
    if (!state.started || !state.speed) return;
    const dt = dtReal * state.speed; state.simSec += dt; pumpTick(dt); refreshSim();
  }, 250);

  // รูปโปรไฟล์ไลน์ของผู้เล่น แทนรูปกุ้งบนหัวหน้าตั้งค่า (ไม่มีรูป/ยังไม่ล็อกอิน = คงรูปกุ้งไว้)
  (async function () {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' }); const j = await r.json();
      const url = j && j.user && j.user.pictureUrl;
      if (url && /^https:\/\/profile\.line-scdn\.net\//.test(url)) {
        const img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer';
        img.onload = () => { const el = $('setupAv'); el.textContent = ''; el.appendChild(img); };
        img.src = url;
      }
    } catch (e) { /* ใช้รูปกุ้งต่อไป */ }
  })();

  // ขนาดเวทีตามพื้นที่เห็นจริงของเบราว์เซอร์ (100dvh บางเครื่องล้ำไปใต้แถบปุ่มระบบ ทำให้ปุ่มขวาหาย)
  const stageEl = $('stage');
  function fitStage() {
    const vv = window.visualViewport;
    const W = Math.floor(vv ? vv.width : window.innerWidth), H = Math.floor(Math.min(window.innerHeight, vv ? vv.height : window.innerHeight));
    if (window.matchMedia('(orientation: portrait)').matches) {
      stageEl.style.width = H + 'px'; stageEl.style.height = W + 'px'; stageEl.style.left = W + 'px';
      document.documentElement.style.setProperty('--u', (W / 100) + 'px');
    } else {
      stageEl.style.width = ''; stageEl.style.height = ''; stageEl.style.left = '';
      document.documentElement.style.setProperty('--u', (H / 100) + 'px');
    }
  }
  fitStage();
  window.addEventListener('resize', fitStage); window.addEventListener('orientationchange', () => setTimeout(fitStage, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitStage);

  // ถือแนวตั้ง = ภาพถูกหมุนตะแคงด้วย CSS → บอกให้ผู้ใช้หมุนมือถือให้ภาพตรง (หายเองหรือแตะเพื่อปิด)
  const portraitMq = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  let hintTimer = null;
  function updateHint() {
    const h = $('rotHint');
    if (portraitMq && portraitMq.matches) { h.hidden = false; clearTimeout(hintTimer); hintTimer = setTimeout(() => { h.hidden = true; }, 7000); }
    else { h.hidden = true; clearTimeout(hintTimer); }
  }
  $('rotHint').addEventListener('click', () => { $('rotHint').hidden = true; });
  if (portraitMq) { (portraitMq.addEventListener ? portraitMq.addEventListener('change', updateHint) : portraitMq.addListener(updateHint)); }
  updateHint();

  renderParams();
  selectPond('culture');
})();
