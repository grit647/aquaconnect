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

  const state = { pond: 'culture', started: false, speed: 0 };

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
    toast(ACTS[b.dataset.act] || 'เร็วๆ นี้');
  }));

  // ----- ความเร็วเวลา (ปุ่มเปลี่ยนสถานะอย่างเดียว) -----
  qsa('.sp').forEach((b) => b.addEventListener('click', () => {
    state.speed = Number(b.dataset.sp);
    qsa('.sp').forEach((x) => x.classList.toggle('on', x === b));
    if (state.started) toast(state.speed ? 'เดินเวลา ×' + state.speed + ' — เร็วๆ นี้ (ยังไม่มีแกนจำลอง)' : 'หยุดเวลา');
  }));

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
    $('setup').hidden = true;
    log('เริ่มเกม: ' + name + ' • ' + sel('fSpecies') + ' • ' + sel('fSystem') + ' • ความเค็ม ' + $('fSalinity').value + ' ppt • บ่อ ' + i.rai + ' ไร่ • ปล่อย ' + fmt(i.v) + ' ตัว • ระดับน้ำ ' + level.toFixed(1) + ' ม.');
    log('บ่อเลี้ยงยังไม่มีน้ำ — ขั้นต่อไป: เตรียมบ่อ → เตรียมน้ำ → ปล่อยกุ้ง จึงเข้าสู่โหมดเลี้ยง (ยังไม่เปิดใช้ในต้นแบบ)');
    log('บ่อพัก 7 ไร่ มีน้ำเริ่มต้น ' + resv.toFixed(1) + ' ม. (สุ่มให้ ต่ำสุด 1 ม. สูงสุด 3 ม.)');
  });

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
