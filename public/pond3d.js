// ฉาก 3 มิติคร่าวๆ ของ "บ่อเลี้ยง" — 3 มุมมอง: ท็อปวิว / ภาพตัด / สำรวจพื้นบ่อ (ต้นแบบ ยังไม่ผูกกับแกนจำลอง)
// ใช้ three.js (public/vendor/three.min.js) • ขนาดบ่อตามที่ผู้เล่นเลือก (1 ไร่ = 1,600 ตร.ม., สัดส่วน กว้าง:ยาว = 2:3)
// ตั้งค่าผ่าน window.__pond3dCfg = { rai, pe (บ่อปูผ้า PE), water (ระดับน้ำ ม. 0 = บ่อแห้ง), shrimp (จำนวนกุ้งที่ปล่อยแล้ว 0 = ยังไม่มี) }
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MAXD = 3.0;                                  // ความลึกสูงสุดของบ่อ (ม.) — ก้นบ่อลึกสุดตรงกลาง
  let L = 60, WD = 40;                               // ยาว x กว้าง (ม.) — คำนวณจากไร่
  const floorY = (x, z) => -MAXD + 0.6 * Math.min(1, Math.max(Math.abs(x) / (L / 2), Math.abs(z) / (WD / 2)));
  const NOTES = {
    top: 'ท็อปวิว — มองจากด้านบน เห็นคันบ่อ เครื่องตีน้ำ ถาดอาหาร และกุ้งใต้น้ำ',
    section: 'ภาพตัดขวาง — ขยายแนวตั้งให้เห็นความลึก (ตรงกลางลึกสุด) คันบ่อ และชั้นน้ำ',
    explore: 'สำรวจพื้นบ่อ — ลากนิ้วเพื่อมอง • แตะค้างบนภาพเพื่อเดินไปข้างหน้า',
  };
  let S = null, R = null, mode = 'top', raf = 0, open = false, builtKey = '';
  const keys = { f: 0, s: 0 };
  const view = { yaw: Math.PI / 2, pitch: -0.15, x: -10, z: 0 };

  function getCfg() { const c = window.__pond3dCfg || {}; return { rai: c.rai || 1.5, pe: !!c.pe, water: Math.max(0, c.water || 0), shrimp: c.shrimp || 0 }; }

  function disposeScene() {
    if (!S) return;
    S.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    S = null;
  }

  function build(cfg) {
    if (!R) {
      const renderer = new THREE.WebGLRenderer({ canvas: $('pond3dCanvas'), antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.localClippingEnabled = true;
      R = { renderer, camera: new THREE.PerspectiveCamera(50, 2, 0.1, 800) };
    }
    disposeScene();
    WD = Math.sqrt(cfg.rai * 1600 / 1.5); L = WD * 1.5;
    const yw = -MAXD + cfg.water, hasWater = cfg.water > 0.01;
    const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), clipped = [];
    const mat = (m) => { clipped.push(m); return m; };
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(20, 50, 30); scene.add(sun);

    // พื้นบ่อ
    const fg = new THREE.PlaneGeometry(L, WD, 48, 32); fg.rotateX(-Math.PI / 2);
    const p = fg.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, floorY(x, z) + (cfg.pe ? 0 : Math.sin(x * 1.7) * Math.cos(z * 2.1) * 0.04)); }
    fg.computeVertexNormals();
    group.add(new THREE.Mesh(fg, mat(new THREE.MeshLambertMaterial({ color: cfg.pe ? 0xbfd3de : 0x7a5636, flatShading: !cfg.pe, side: THREE.DoubleSide }))));
    // คันบ่อ
    const dikeM = mat(new THREE.MeshLambertMaterial({ color: cfg.pe ? 0x6f8a5a : 0x5b7f3a }));
    const dike = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), dikeM); m.position.set(x, y, z); group.add(m); };
    dike(5, 3.8, WD + 10, -(L / 2 + 2.5), -1.5, 0); dike(5, 3.8, WD + 10, L / 2 + 2.5, -1.5, 0);
    dike(L, 3.8, 5, 0, -1.5, -(WD / 2 + 2.5)); dike(L, 3.8, 5, 0, -1.5, WD / 2 + 2.5);
    // น้ำ
    if (hasWater) {
      const water = new THREE.Mesh(new THREE.BoxGeometry(L, cfg.water, WD), mat(new THREE.MeshBasicMaterial({ color: 0x2aa0d8, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })));
      water.position.y = -MAXD + cfg.water / 2; group.add(water);
    }
    // หน้าตัด (โหมดภาพตัด)
    const prof = []; for (let x = L / 2; x >= -L / 2 - 0.01; x -= L / 60) prof.push([x, floorY(x, 0)]);
    const soil = new THREE.Shape(); soil.moveTo(-L / 2 - 5, -3.6); soil.lineTo(L / 2 + 5, -3.6); soil.lineTo(L / 2 + 5, 0.4); soil.lineTo(L / 2, 0.4);
    prof.forEach(([x, y]) => soil.lineTo(x, y)); soil.lineTo(-L / 2, 0.4); soil.lineTo(-L / 2 - 5, 0.4); soil.closePath();
    const cut = new THREE.Group();
    cut.add(new THREE.Mesh(new THREE.ShapeGeometry(soil), new THREE.MeshBasicMaterial({ color: cfg.pe ? 0x55626b : 0x4a3322, side: THREE.DoubleSide })));
    if (hasWater) {
      const wat = new THREE.Shape(); prof.forEach(([x, y], i) => (i ? wat.lineTo(x, y) : wat.moveTo(x, y))); wat.lineTo(-L / 2, yw); wat.lineTo(L / 2, yw); wat.closePath();
      const wm = new THREE.Mesh(new THREE.ShapeGeometry(wat), new THREE.MeshBasicMaterial({ color: 0x2a8fc8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })); wm.position.z = 0.02; cut.add(wm);
    }
    cut.visible = false; group.add(cut);
    // เครื่องตีน้ำ (ติดตั้งเมื่อมีน้ำ)
    const wheels = [];
    if (hasWater) {
      const n = Math.max(2, Math.min(10, Math.round(cfg.rai * 2))), per = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) {
        const row = i % 2, col = Math.floor(i / 2), x = ((col + 0.5) / per - 0.5) * (L - 10), z = (row ? 1 : -1) * WD * 0.22;
        const g = new THREE.Group(); g.position.set(x, yw + 0.05, z);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 1), mat(new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }))));
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.6, 8), mat(new THREE.MeshLambertMaterial({ color: 0xf59e0b }))); wh.rotation.z = Math.PI / 2; wh.position.y = 0.2; g.add(wh);
        wheels.push(wh); group.add(g);
      }
    }
    // ถาดอาหาร + กุ้ง (เมื่อปล่อยกุ้งแล้ว)
    let shrimp = null; const sp = [];
    if (cfg.shrimp > 0) {
      [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].forEach(([fx, fz]) => {
        const x = fx * L, z = fz * WD, t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 16), mat(new THREE.MeshLambertMaterial({ color: 0xfbbf24 })));
        t.position.set(x, floorY(x, z) + 0.06, z); group.add(t);
      });
      const N = 420; shrimp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6).scale(1, 0.28, 0.28), mat(new THREE.MeshLambertMaterial({ color: 0xf29a8a })), N);
      for (let i = 0; i < N; i++) sp.push({ x: (Math.random() - 0.5) * (L - 4), z: (Math.random() - 0.5) * (WD - 4), r: Math.random() * 6.28, ph: Math.random() * 6.28 });
      group.add(shrimp);
    }
    // ตะกอนลอย (เมื่อมีน้ำ)
    let dust = null;
    if (hasWater) {
      const pg = new THREE.BufferGeometry(), pa = new Float32Array(600 * 3);
      for (let i = 0; i < 600; i++) { pa[i * 3] = (Math.random() - 0.5) * L; pa[i * 3 + 1] = -MAXD + Math.random() * cfg.water; pa[i * 3 + 2] = (Math.random() - 0.5) * WD; }
      pg.setAttribute('position', new THREE.BufferAttribute(pa, 3));
      dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xcfe9f5, size: 0.06, transparent: true, opacity: 0.6 })); group.add(dust);
    }
    S = { scene, group, clip, clipped, cut, wheels, shrimp, sp, dust, dummy: new THREE.Object3D(), cfg, hasWater };
    view.x = -L / 6; view.z = 0; view.yaw = Math.PI / 2; view.pitch = -0.15;
    builtKey = JSON.stringify(cfg);
  }

  function resize() {
    if (!R) return;
    const box = $('pond3d'), w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
    R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
  }

  function setMode(m) {
    mode = m;
    Array.from(document.querySelectorAll('[data-p3]')).forEach((b) => b.classList.toggle('on', b.dataset.p3 === m));
    $('p3Note').textContent = NOTES[m] + (S.hasWater ? '' : ' • (บ่อยังไม่มีน้ำ — ต้องเตรียมบ่อ/เตรียมน้ำก่อน)');
    const ex = Math.max(4, Math.round(L / 12));
    S.group.scale.y = m === 'section' ? ex : 1;
    S.cut.visible = m === 'section';
    S.clipped.forEach((x) => { x.clippingPlanes = m === 'section' ? [S.clip] : []; x.needsUpdate = true; });
    if (S.dust) S.dust.visible = m === 'explore';
    const under = m === 'explore' && S.hasWater && S.cfg.water > 0.6;
    S.scene.background = new THREE.Color(under ? 0x0e4a6b : (m === 'explore' ? 0x8fb8d8 : 0x0b0f1e));
    S.scene.fog = under ? new THREE.FogExp2(0x0e4a6b, 0.075) : null;
    const c = R.camera, asp = c.aspect || 2, k = 0.933;
    if (m === 'top') { const d = Math.max((L + 14) / (k * asp), (WD + 14) / k); c.position.set(0, d, 0.01); c.up.set(0, 0, -1); c.lookAt(0, 0, 0); }
    else if (m === 'section') { const d = Math.max((L + 16) / (k * asp), 4.4 * ex / k); c.position.set(0, -1.6 * ex, d); c.up.set(0, 1, 0); c.lookAt(0, -1.6 * ex, 0); }
    else { c.up.set(0, 1, 0); c.rotation.order = 'YXZ'; }
  }

  function frame(t) {
    if (!open) return; raf = requestAnimationFrame(frame);
    const c = R.camera, time = t / 1000;
    S.wheels.forEach((w) => { w.rotation.x = time * 6; });
    if (S.shrimp) {
      for (let i = 0; i < S.sp.length; i++) {
        const s = S.sp[i]; S.dummy.position.set(s.x + Math.sin(time * 0.3 + s.ph) * 0.3, floorY(s.x, s.z) + 0.1, s.z + Math.cos(time * 0.25 + s.ph) * 0.3);
        S.dummy.scale.setScalar(mode === 'explore' ? 0.25 : 1); S.dummy.rotation.set(0, s.r + Math.sin(time * 0.4 + s.ph) * 0.4, 0); S.dummy.updateMatrix(); S.shrimp.setMatrixAt(i, S.dummy.matrix);
      }
      S.shrimp.instanceMatrix.needsUpdate = true;
    }
    if (mode === 'explore') {
      if (keys.f) {
        const sp = 7 / 60;
        view.x += -Math.sin(view.yaw) * sp; view.z += -Math.cos(view.yaw) * sp;
        view.x = Math.max(-L / 2 + 1, Math.min(L / 2 - 1, view.x)); view.z = Math.max(-WD / 2 + 1, Math.min(WD / 2 - 1, view.z));
      }
      c.position.set(view.x, floorY(view.x, view.z) + 0.55, view.z);
      c.rotation.set(view.pitch, view.yaw, 0);
    }
    R.renderer.render(S.scene, c);
  }

  function openPond() {
    if (typeof THREE === 'undefined') { alert('โหลดตัวแสดงผล 3 มิติไม่สำเร็จ ลองรีเฟรชหน้า'); return; }
    $('pond3d').hidden = false; open = true;
    try { const cfg = getCfg(); if (!S || JSON.stringify(cfg) !== builtKey) build(cfg); } catch (e) { $('pond3d').hidden = true; open = false; alert('เครื่อง/เบราว์เซอร์นี้เปิด 3 มิติไม่ได้'); return; }
    resize(); setMode(mode); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function closePond() { clearTimeout(walkT); open = false; cancelAnimationFrame(raf); $('pond3d').hidden = true; keys.f = keys.s = 0; }

  // ----- ปุ่ม/การควบคุม -----
  Array.from(document.querySelectorAll('[data-p3]')).forEach((b) => b.addEventListener('click', () => S && setMode(b.dataset.p3)));
  $('p3Back').addEventListener('click', closePond);
  window.__openPond3d = openPond;

  // ลากเพื่อมอง + แตะค้างเพื่อเดิน (ถือแนวตั้ง เวทีถูกหมุน 90° → สลับแกนให้ตรงกับภาพ)
  let drag = null, walkT = null; const cv = $('pond3dCanvas'); const portraitMq = window.matchMedia('(orientation: portrait)');
  const stopWalk = () => { clearTimeout(walkT); keys.f = 0; };
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; cv.setPointerCapture(e.pointerId); if (mode === 'explore') walkT = setTimeout(() => { keys.f = 1; }, 350); });
  cv.addEventListener('pointerup', () => { drag = null; stopWalk(); }); cv.addEventListener('pointercancel', () => { drag = null; stopWalk(); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || mode !== 'explore') return;
    if (!keys.f && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10) clearTimeout(walkT);
    let dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (portraitMq.matches) { const t = dx; dx = dy; dy = -t; }
    view.yaw += dx * 0.006; view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + dy * 0.006));
  });
  if (window.ResizeObserver) new ResizeObserver(() => { resize(); if (open && S) setMode(mode); }).observe($('pond3d')); else window.addEventListener('resize', resize);
})();
