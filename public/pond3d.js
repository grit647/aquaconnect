// ฉาก 3 มิติคร่าวๆ ของ "บ่อเลี้ยง" — 3 มุมมอง: ท็อปวิว / ภาพตัด / สำรวจพื้นบ่อ (ต้นแบบ ยังไม่ผูกกับแกนจำลอง)
// ใช้ three.js (public/vendor/three.min.js) • ขนาดบ่อสมมติ 60×40 ม. ลึก 1.2–2.0 ม. (ลึกสุดตรงกลาง)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const L = 60, WD = 40;                       // กว้าง x ยาว (ม.)
  const depthAt = (x, z) => 1.2 + 0.8 * (1 - Math.min(1, Math.max(Math.abs(x) / (L / 2), Math.abs(z) / (WD / 2))));
  const NOTES = {
    top: 'ท็อปวิว — มองจากด้านบน เห็นเครื่องตีน้ำ ถาดอาหาร และกุ้งใต้น้ำ',
    section: 'ภาพตัดขวาง — ขยายแนวตั้ง ×4 ให้เห็นความลึก (ตรงกลางลึกสุด) คันบ่อ และชั้นน้ำ',
    explore: 'สำรวจพื้นบ่อ — ลากนิ้วเพื่อมอง • แตะค้างบนภาพเพื่อเดินไปข้างหน้า',
  };
  let S = null, mode = 'top', raf = 0, open = false;
  const keys = { f: 0, s: 0 };
  const view = { yaw: Math.PI / 2, pitch: -0.15, x: -22, z: 0 };

  function build() {
    const box = $('pond3d'), canvas = $('pond3dCanvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    const scene = new THREE.Scene();
    const group = new THREE.Group(); scene.add(group);
    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 400);
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const clipped = [];
    const mat = (m) => { clipped.push(m); return m; };

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(20, 50, 30); scene.add(sun);

    // พื้นบ่อ (ลาดลึกเข้าหาตรงกลาง + ขรุขระเล็กน้อย)
    const fg = new THREE.PlaneGeometry(L, WD, 40, 28); fg.rotateX(-Math.PI / 2);
    const p = fg.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, -depthAt(x, z) + (Math.sin(x * 1.7) * Math.cos(z * 2.1)) * 0.04); }
    fg.computeVertexNormals();
    const floor = new THREE.Mesh(fg, mat(new THREE.MeshLambertMaterial({ color: 0x7a5636, flatShading: true, side: THREE.DoubleSide })));
    group.add(floor);

    // คันบ่อ 4 ด้าน
    const dikeM = mat(new THREE.MeshLambertMaterial({ color: 0x5b7f3a }));
    const dike = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), dikeM); m.position.set(x, y, z); group.add(m); };
    dike(5, 2.4, WD + 10, -(L / 2 + 2.5), -0.5, 0); dike(5, 2.4, WD + 10, L / 2 + 2.5, -0.5, 0);
    dike(L, 2.4, 5, 0, -0.5, -(WD / 2 + 2.5)); dike(L, 2.4, 5, 0, -0.5, WD / 2 + 2.5);

    // ปริมาตรน้ำ
    const water = new THREE.Mesh(new THREE.BoxGeometry(L, 2.1, WD), mat(new THREE.MeshBasicMaterial({ color: 0x2aa0d8, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })));
    water.position.y = -1.05; group.add(water);

    // หน้าตัด (แสดงเฉพาะโหมดภาพตัด) ที่ z=0
    const prof = []; for (let x = L / 2; x >= -L / 2; x -= 1) prof.push([x, -depthAt(x, 0)]);
    const soil = new THREE.Shape(); soil.moveTo(-L / 2 - 5, -2.6); soil.lineTo(L / 2 + 5, -2.6); soil.lineTo(L / 2 + 5, 0.7); soil.lineTo(L / 2, 0.7);
    prof.forEach(([x, y]) => soil.lineTo(x, y)); soil.lineTo(-L / 2, 0.7); soil.lineTo(-L / 2 - 5, 0.7); soil.closePath();
    const wat = new THREE.Shape(); prof.forEach(([x, y], i) => (i ? wat.lineTo(x, y) : wat.moveTo(x, y))); wat.lineTo(-L / 2, 0); wat.lineTo(L / 2, 0); wat.closePath();
    const cut = new THREE.Group();
    const soilM = new THREE.Mesh(new THREE.ShapeGeometry(soil), new THREE.MeshBasicMaterial({ color: 0x4a3322, side: THREE.DoubleSide }));
    const watM = new THREE.Mesh(new THREE.ShapeGeometry(wat), new THREE.MeshBasicMaterial({ color: 0x2a8fc8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    watM.position.z = 0.02; cut.add(soilM, watM); cut.visible = false; group.add(cut);

    // เครื่องตีน้ำ 4 ตัว
    const wheels = [];
    [[-14, -9], [-14, 9], [14, -9], [14, 9]].forEach(([x, z]) => {
      const g = new THREE.Group(); g.position.set(x, 0.05, z);
      const fl = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 1), mat(new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }))); g.add(fl);
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.6, 8), mat(new THREE.MeshLambertMaterial({ color: 0xf59e0b }))); wh.rotation.z = Math.PI / 2; wh.position.y = 0.2; g.add(wh);
      wheels.push(wh); group.add(g);
    });
    // ถาดอาหาร 4 ถาด
    [[-8, -6], [8, -6], [-8, 6], [8, 6]].forEach(([x, z]) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 16), mat(new THREE.MeshLambertMaterial({ color: 0xfbbf24 })));
      t.position.set(x, -depthAt(x, z) + 0.06, z); group.add(t);
    });
    // กุ้ง
    const N = 420, shrimp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6).scale(1, 0.28, 0.28), mat(new THREE.MeshLambertMaterial({ color: 0xf29a8a })), N);
    const sp = [];
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * (L - 4), z = (Math.random() - 0.5) * (WD - 4); sp.push({ x, z, r: Math.random() * 6.28, ph: Math.random() * 6.28 }); }
    group.add(shrimp);
    // ตะกอนลอยในน้ำ (เห็นตอนสำรวจ)
    const pg = new THREE.BufferGeometry(); const pa = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) { pa[i * 3] = (Math.random() - 0.5) * L; pa[i * 3 + 1] = -Math.random() * 1.9; pa[i * 3 + 2] = (Math.random() - 0.5) * WD; }
    pg.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    const dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xcfe9f5, size: 0.06, transparent: true, opacity: 0.6 })); group.add(dust);

    const dummy = new THREE.Object3D();
    S = { box, renderer, scene, group, camera, clip, clipped, cut, wheels, shrimp, sp, dummy, dust };
  }

  function resize() {
    if (!S) return;
    const w = S.box.clientWidth, h = S.box.clientHeight; if (!w || !h) return;
    S.renderer.setSize(w, h, false); S.camera.aspect = w / h; S.camera.updateProjectionMatrix();
  }

  function setMode(m) {
    mode = m;
    Array.from(document.querySelectorAll('[data-p3]')).forEach((b) => b.classList.toggle('on', b.dataset.p3 === m));
    $('p3Note').textContent = NOTES[m];
    S.group.scale.y = m === 'section' ? 4 : 1;
    S.cut.visible = m === 'section';
    S.clipped.forEach((x) => { x.clippingPlanes = m === 'section' ? [S.clip] : []; x.needsUpdate = true; });
    S.dust.visible = m === 'explore';
    S.scene.background = new THREE.Color(m === 'explore' ? 0x0e4a6b : 0x0b0f1e);
    S.scene.fog = m === 'explore' ? new THREE.FogExp2(0x0e4a6b, 0.075) : null;
    const c = S.camera;
    if (m === 'top') { c.position.set(0, 62, 0.01); c.up.set(0, 0, -1); c.lookAt(0, 0, 0); }
    else if (m === 'section') { c.position.set(0, -3, 44); c.up.set(0, 1, 0); c.lookAt(0, -3, 0); }
    else { c.up.set(0, 1, 0); c.rotation.order = 'YXZ'; }
  }

  function frame(t) {
    if (!open) return; raf = requestAnimationFrame(frame);
    const c = S.camera, time = t / 1000;
    S.wheels.forEach((w) => { w.rotation.x = time * 6; });
    for (let i = 0; i < S.sp.length; i++) {
      const s = S.sp[i]; S.dummy.position.set(s.x + Math.sin(time * 0.3 + s.ph) * 0.3, -depthAt(s.x, s.z) + 0.1, s.z + Math.cos(time * 0.25 + s.ph) * 0.3);
      S.dummy.scale.setScalar(mode === 'explore' ? 0.25 : 1); S.dummy.rotation.set(0, s.r + Math.sin(time * 0.4 + s.ph) * 0.4, 0); S.dummy.updateMatrix(); S.shrimp.setMatrixAt(i, S.dummy.matrix);
    }
    S.shrimp.instanceMatrix.needsUpdate = true;
    if (mode === 'explore') {
      const sp = 7 / 60; // ม./เฟรม ~ 7 ม./วินาที ที่ 60fps
      if (keys.f || keys.s) {
        view.x += (-Math.sin(view.yaw) * keys.f + Math.cos(view.yaw) * keys.s) * sp;
        view.z += (-Math.cos(view.yaw) * keys.f - Math.sin(view.yaw) * keys.s) * sp;
        view.x = Math.max(-L / 2 + 1, Math.min(L / 2 - 1, view.x)); view.z = Math.max(-WD / 2 + 1, Math.min(WD / 2 - 1, view.z));
      }
      c.position.set(view.x, -depthAt(view.x, view.z) + 0.55, view.z);
      c.rotation.set(view.pitch, view.yaw, 0);
    }
    S.renderer.render(S.scene, c);
  }

  function openPond() {
    if (typeof THREE === 'undefined') { alert('โหลดตัวแสดงผล 3 มิติไม่สำเร็จ ลองรีเฟรชหน้า'); return; }
    $('pond3d').hidden = false; open = true;
    try { if (!S) build(); } catch (e) { $('pond3d').hidden = true; open = false; alert('เครื่อง/เบราว์เซอร์นี้เปิด 3 มิติไม่ได้'); return; }
    resize(); setMode(mode); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function closePond() { clearTimeout(walkT); open = false; cancelAnimationFrame(raf); $('pond3d').hidden = true; keys.f = keys.s = 0; }

  // ----- ปุ่ม/การควบคุม -----
  Array.from(document.querySelectorAll('[data-p3]')).forEach((b) => b.addEventListener('click', () => S && setMode(b.dataset.p3)));
  $('p3Back').addEventListener('click', closePond);
  window.__openPond3d = openPond;
  // ลากเพื่อมอง (ถือแนวตั้ง เวทีถูกหมุน 90° → สลับแกนให้ตรงกับภาพ)
  let drag = null; const cv = $('pond3dCanvas'); const portraitMq = window.matchMedia('(orientation: portrait)');
  let walkT = null; const stopWalk = () => { clearTimeout(walkT); keys.f = 0; };
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; cv.setPointerCapture(e.pointerId); if (mode === 'explore') walkT = setTimeout(() => { keys.f = 1; }, 350); });
  cv.addEventListener('pointerup', () => { drag = null; stopWalk(); }); cv.addEventListener('pointercancel', () => { drag = null; stopWalk(); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || mode !== 'explore') return;
    if (!keys.f && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10) clearTimeout(walkT);
    let dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (portraitMq.matches) { const t = dx; dx = dy; dy = -t; }
    view.yaw += dx * 0.006; view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + dy * 0.006));
  });
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('pond3d')); else window.addEventListener('resize', resize);
})();
