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
  qsa('.node', $('scene')).forEach((g) => g.addEventListener('click', () => selectPond(g.dataset.pond)));

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

  // ----- ตัวเลือกที่วาดเอง แทน <select> ของระบบ (ป๊อปอัประบบไม่หมุนตามภาพตอนถือแนวตั้ง) -----
  qsa('select', $('setup')).forEach((sel) => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'selbtn';
    const sync = () => { btn.textContent = sel.options[sel.selectedIndex].text; };
    sync(); sel.parentNode.appendChild(btn);
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
  $('fDensity').addEventListener('input', () => { $('fDensityVal').textContent = $('fDensity').value; });
  $('startBtn').addEventListener('click', () => {
    const sel = (id) => { const s = $(id); return s.options[s.selectedIndex].text; };
    state.started = true;
    $('kvSpecies').textContent = sel('fSpecies');
    $('kvDensity').textContent = $('fDensity').value + ' ตัว/ตร.ม.';
    $('kvSystem').textContent = sel('fSystem');
    $('kvProvince').textContent = sel('fProvince');
    $('chipDay').textContent = 'วันที่ 1';
    $('chipTime').textContent = '06:00';
    $('chipWx').textContent = sel('fProvince');
    $('chipCash').textContent = '–';
    $('setup').hidden = true;
    log('เริ่มเกม: ' + sel('fSpecies') + ' • ' + sel('fSystem') + ' • ' + $('fDensity').value + ' ตัว/ตร.ม. • ' + sel('fProvince'));
    log('(ต้นแบบหน้าจอ — ยังไม่มีการคำนวณ ค่าบนแดชบอร์ดเป็น "–")');
  });

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
