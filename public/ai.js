// หน้า AI เลขา (สไตล์เดียวกับเจ้าครีม) — เข้าสู่ระบบ/สมัคร + คุยกับเลขาด้วยการพิมพ์หรือเสียง
// ข้อความที่มาจากผู้ใช้/AI แสดงด้วย textContent เสมอ (กัน XSS)
(function () {
  const $ = (id) => document.getElementById(id);
  const authPage = $('authPage');
  const authView = $('authView');
  const appEl = $('app');
  const logEl = $('chatLog');
  const inputEl = $('msgInput');
  const sendBtn = $('sendBtn');
  const botStage = $('botStage');

  let mode = 'login';            // 'login' | 'register'
  let me = null;
  let conversationId = null;
  let focusCategory = '';      // หมวดที่ผู้ใช้เลือกคุยต่อ/อัปเดตข้อมูล ('' = ไม่ได้เลือก)
  let convTitle = '';          // หัวข้อของบทสนทนาปัจจุบัน (ตั้งจากข้อความแรก)
  // หัวข้อที่แสดงบนหน้าสนทนาด้วยเสียง: ถ้าเลือกหมวดไว้แสดงหมวด ไม่งั้นแสดงเรื่องที่คุย
  function updateTopic() {
    const el = document.getElementById('vTopic');
    if (!el) return;
    el.textContent = focusCategory ? '📂 หมวด: ' + focusCategory : (convTitle ? '💬 เรื่อง: ' + convTitle : '💬 เรื่องใหม่ — พูดได้เลยค่ะ');
  }
  let sending = false;
  let lineIdToken = null;        // ID token จาก LIFF (มีเฉพาะตอนเปิดในไลน์)
  let voiceMode = false; let voicePaused = false; let voiceStream = null; let idleCycles = 0;   // หน้าสนทนาเสียงต่อเนื่อง (ประกาศไว้บนสุด กันเรียกใช้ก่อนประกาศ)
  let connected = null;          // โหมดใช้ข้อมูลของคนอื่น: { requestId, owner, category }
  let inLine = false;            // เปิดอยู่ในเบราว์เซอร์ของไลน์หรือไม่

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* ไม่มี body */ }
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    return data;
  }

  // ---------- เข้าสู่ระบบ / สมัคร ----------
  function showError(msg) {
    const el = $('authError');
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  function setMode(next) {
    mode = next;
    const isRegister = next === 'register';
    $('tabLogin').classList.toggle('active', !isRegister);
    $('tabRegister').classList.toggle('active', isRegister);
    $('nameField').hidden = !isRegister;
    $('pinHint').hidden = !isRegister;
    $('pin').autocomplete = isRegister ? 'new-password' : 'current-password';
    $('submitBtn').textContent = isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
    showError('');
  }

  function showAuth() {
    stopAllVoice();
    endConnected(true);
    me = null;
    conversationId = null;
    document.body.classList.add('auth-mode');
    appEl.hidden = true;
    authPage.hidden = false;
    authView.hidden = false;
    $('lineNote').hidden = !lineIdToken;
    $('pin').value = '';
  }

  $('tabLogin').addEventListener('click', () => setMode('login'));
  $('tabRegister').addEventListener('click', () => setMode('register'));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const phone = $('phone').value.trim();
    const pin = $('pin').value.trim();
    const name = $('name').value.trim();

    if (mode === 'register' && !name) return showError('กรอกชื่อ-นามสกุล');
    if (!/^\d{9,10}$/.test(phone)) return showError('กรอกเบอร์โทรศัพท์ให้ถูกต้อง');
    if (!/^\d{6}$/.test(pin)) return showError('รหัส PIN ต้องเป็นตัวเลข 6 หลัก');

    const btn = $('submitBtn');
    btn.disabled = true;
    try {
      const body = mode === 'register' ? { name, phone, pin } : { phone, pin };
      if (lineIdToken) body.idToken = lineIdToken;
      const data = await api('POST', '/api/auth/' + mode, body);
      await enterChat(data.user);
      if (data.line && !data.line.linked) addBubble('error', data.line.error);
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- รูปโปรไฟล์ไลน์ ----------
  let liffPicture = null;      // รูปจาก liff.getProfile() (เฉพาะตอนเปิดในไลน์) ใช้เมื่อเซิร์ฟเวอร์ยังไม่มีรูปเก็บไว้
  const LINE_PIC_RE = /^https:\/\/profile\.line-scdn\.net\//;
  function avatarContent(el) {
    el.textContent = '';
    const url = (me && me.pictureUrl) || liffPicture;
    if (url && LINE_PIC_RE.test(url)) {
      const img = document.createElement('img');
      img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.onerror = () => { el.textContent = (me && me.name ? me.name.trim().charAt(0) : '?'); };
      img.src = url;
      el.appendChild(img);
    } else {
      el.textContent = me && me.name ? me.name.trim().charAt(0) : '?';
    }
  }
  function renderAvatar() { avatarContent($('avatar')); renderAiBadge(); }
  // รูป AI ส่วนตัว + ชื่อที่ตั้งไว้ แสดงใต้รูปโปรไฟล์เจ้าของ (แตะแล้วเปิดหน้าแก้โปรไฟล์) — ไม่มีรูปแสดงตัวอักษรแรกของชื่อ
  function aiImgInto(el, size) {
    el.textContent = '';
    const nm = (me && me.secretaryName) || 'AI';
    if (me && me.aiAvatarUrl) {
      const img = document.createElement('img'); img.alt = ''; img.src = me.aiAvatarUrl;
      img.onerror = () => { el.textContent = nm.trim().charAt(0) || 'AI'; };
      el.appendChild(img);
    } else el.textContent = nm.trim().charAt(0) || 'AI';
  }
  function renderAiBadge() {
    const b = document.getElementById('aiBadge'); if (!b || !me) return;
    aiImgInto(b.querySelector('.aiimg'));
    b.querySelector('.ainame').textContent = me.secretaryName || 'เลขา';
  }
  // ย่อรูปที่เลือกให้เป็นสี่เหลี่ยมจัตุรัส 256×256 (ครอปกลางภาพ) แล้วแปลงเป็น data URL — เล็กพอเก็บในฐานข้อมูล
  function resizeToDataUrl(file, size) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const s = Math.min(img.width, img.height);
          const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
          cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          let q = 0.85; let out = cv.toDataURL('image/jpeg', q);
          while (out.length * 0.75 > 100 * 1024 && q > 0.4) { q -= 0.15; out = cv.toDataURL('image/jpeg', q); }
          URL.revokeObjectURL(url); resolve(out);
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านรูปไม่ได้ ลองเลือกไฟล์รูป JPG/PNG')); };
      img.src = url;
    });
  }

  // ---------- โปรไฟล์ (กดรูปโปรไฟล์): อัปเดตโปรไฟล์ / ขนาดข้อมูลส่วนตัว / กลุ่ม / ค้นหาด้วย Google ----------
  const fmtBytes = (b) => (b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(1) + ' KB');
  function profileBack(body) { sheetButton(body, '← กลับเมนูโปรไฟล์', showProfileMenu); }
  function showProfileMenu() {
    const body = openSheet('โปรไฟล์ของฉัน');
    let whoEl = null;
    if (me) {
      const head = document.createElement('div'); head.className = 'menu-head';
      const av = document.createElement('div'); av.className = 'av'; avatarContent(av);
      const who = document.createElement('div'); who.className = 'who';
      const nm = document.createElement('b'); nm.textContent = me.callName || me.name;
      const sm = document.createElement('small'); sm.textContent = 'เลขา: ' + me.secretaryName;
      who.append(nm, sm); head.append(av, who); body.appendChild(head); whoEl = who;
    }
    // แถบการใช้งาน 2 แถว ต่อจากรูปโปรไฟล์ (ข้อมูลส่วนตัว + การค้นหาด้วย Google) — แตะดูรายละเอียดได้
    const meters = document.createElement('div'); meters.className = 'meters'; body.appendChild(meters);
    sheetButton(body, '✏️ อัปเดตโปรไฟล์', showProfileEdit);
    api('GET', '/api/me/summary').then((s) => {
      const u = s.usage; const g = s.google;
      // สถานะปัจจุบัน (ถ้าเลือกไว้) แสดงใต้ชื่อ
      const pf = s.profile || {};
      if (whoEl && pf.occupationMain) { const st = document.createElement('small'); st.textContent = '🧭 ' + [pf.occupationSub || pf.occupationMain, pf.occupationDetail].filter(Boolean).join(' — '); whoEl.appendChild(st); }
      meters.appendChild(meterRow('💾 ข้อมูลส่วนตัว', fmtBytes(u.totalBytes) + ' / ' + fmtBytes(u.quotaBytes), u.totalBytes / u.quotaBytes, showDataUsage));
      meters.appendChild(meterRow('🔎 ค้นหาด้วย Google (เดือนนี้)' + (g.enabled ? '' : ' 🔒 ยังไม่ได้รับอนุญาต'), g.count + ' / ' + g.limit + ' ครั้ง', g.enabled ? g.count / g.limit : 0, showGoogleInfo, !g.enabled));
    }).catch(() => { /* โหลดแถบไม่ได้ก็ยังใช้เมนูอื่นได้ */ });
  }
  // แถบความคืบหน้า: ชื่อ + ตัวเลข + แถบเติมตามสัดส่วน (เกิน 80% เป็นสีส้ม เต็มเป็นสีแดง)
  function meterRow(label, valueText, ratio, onClick, dim) {
    const pct = Math.max(0, Math.min(1, Number(ratio) || 0));
    const d = document.createElement('div'); d.className = 'meter' + (dim ? ' dim' : '');
    const top = document.createElement('div'); top.className = 'mt';
    const l = document.createElement('span'); l.textContent = label;
    const v = document.createElement('b'); v.textContent = valueText;
    top.append(l, v);
    const track = document.createElement('div'); track.className = 'track';
    const fill = document.createElement('div'); fill.className = 'fill' + (pct >= 1 ? ' full' : pct >= 0.8 ? ' warn' : '');
    fill.style.width = Math.max(pct * 100, pct > 0 ? 2 : 0) + '%';
    track.appendChild(fill);
    d.append(top, track);
    if (onClick) { d.style.cursor = 'pointer'; d.addEventListener('click', onClick); }
    return d;
  }
  document.getElementById('aiBadge').addEventListener('click', () => { if (window.aqTick) window.aqTick.open(); });
  async function loadSummary(body) {
    try { return await api('GET', '/api/me/summary'); } catch (err) { note(body, err.message); return null; }
  }
  async function showProfileEdit() {
    const body = openSheet('อัปเดตโปรไฟล์');
    const s = await loadSummary(body);
    if (!s) { profileBack(body); return; }
    const mk = (label, value, max, hint) => {
      note(body, label);
      const i = document.createElement('input'); i.type = 'text'; i.maxLength = max; i.value = value || ''; if (hint) i.placeholder = hint;
      body.appendChild(i); return i;
    };
    const name = mk('ชื่อของคุณ (ชื่อที่ใช้สมัคร)', s.profile.name, 100);
    const call = mk('ชื่อที่ให้เลขาเรียกคุณ (สั้นๆ เช่น ชื่อเล่น — เว้นว่าง = เรียกตามชื่อสมัคร)', s.profile.callName, 20, 'เช่น พี่ต้น');
    const sec = mk('ชื่อของเลขา', s.profile.secretaryName, 20, 'เช่น น้องครีม');
    // รูป AI ส่วนตัว: เลือกรูป → ย่อ → อัปโหลดทันที (เห็นใต้รูปโปรไฟล์ของคุณพร้อมชื่อเลขา)
    note(body, 'รูป AI ส่วนตัวของคุณ (แสดงใต้รูปโปรไฟล์พร้อมชื่อเลขา เห็นเฉพาะคุณ)');
    const pickRow = document.createElement('div'); pickRow.className = 'aipick'; body.appendChild(pickRow);
    const prev = document.createElement('div'); prev.className = 'aiprev'; pickRow.appendChild(prev);
    const paintPrev = () => aiImgInto(prev);
    paintPrev();
    const btns = document.createElement('div'); btns.className = 'aibtns'; pickRow.appendChild(btns);
    const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/jpeg,image/png,image/webp'; fileIn.hidden = true; pickRow.appendChild(fileIn);
    const avMsg = document.createElement('div'); avMsg.className = 'empty'; avMsg.style.fontSize = '13px';
    const avPick = document.createElement('button'); avPick.type = 'button'; avPick.textContent = '🖼️ เลือกรูป'; btns.appendChild(avPick);
    const avDel = document.createElement('button'); avDel.type = 'button'; avDel.textContent = '🗑️ ลบรูป'; btns.appendChild(avDel);
    body.appendChild(avMsg);
    avPick.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      avMsg.textContent = 'กำลังอัปโหลด...';
      try {
        const dataUrl = await resizeToDataUrl(f, 256);
        const r = await api('PUT', '/api/me/ai-avatar', { image: dataUrl });
        me.aiAvatarUrl = r.aiAvatarUrl; paintPrev(); renderAiBadge(); avMsg.textContent = '✓ เปลี่ยนรูป AI แล้วค่ะ';
      } catch (err) { avMsg.textContent = err.message; }
    });
    avDel.addEventListener('click', async () => {
      try { await api('DELETE', '/api/me/ai-avatar'); me.aiAvatarUrl = null; paintPrev(); renderAiBadge(); avMsg.textContent = 'ลบรูป AI แล้วค่ะ'; } catch (err) { avMsg.textContent = err.message; }
    });
    // ---------- สถานะปัจจุบัน: หมวดหลัก → หัวข้อย่อย → รายละเอียด (เป็นฐานข้อมูลกลางสำหรับค้นหา/เชื่อมต่อในฟีเจอร์ต่อไป) ----------
    const opts = s.occupationOptions || {};
    let locked = !!s.profile.occupationMain;   // บันทึกไว้แล้ว → แสดงเป็นแถบเทา (อ่านอย่างเดียว) ต้องกด "แก้ไข" ก่อนถึงจะแก้ได้
    const sectionHead = note(body, '🧭 สถานะปัจจุบันของคุณ'); sectionHead.style.cssText = 'color:var(--neon);font-weight:800;margin-top:8px';
    note(body, 'เลือกให้ตรงกับคุณ เพื่อให้เลขารู้จักคุณมากขึ้น และเป็นฐานข้อมูลกลางสำหรับการค้นหาและเชื่อมต่อข้อมูลในฟีเจอร์ต่อๆ ไป (ตอนนี้เป็นข้อมูลส่วนตัว ยังไม่แสดงให้คนอื่นเห็น)');
    const mkSel = (label) => { note(body, label); const e = document.createElement('select'); body.appendChild(e); return e; };
    const fillSel = (sel, list, value, placeholder) => {
      sel.textContent = '';
      const p = document.createElement('option'); p.value = ''; p.textContent = placeholder; sel.appendChild(p);
      list.forEach((x) => { const o = document.createElement('option'); o.value = x; o.textContent = x; sel.appendChild(o); });
      sel.value = list.includes(value) ? value : '';
    };
    const occMain = mkSel('หมวดสถานะ / อาชีพ');
    fillSel(occMain, Object.keys(opts), s.profile.occupationMain, '— ยังไม่ระบุ —');
    const occSub = mkSel('หัวข้อย่อย');
    const refreshSub = (keep) => {
      const list = opts[occMain.value] || [];
      fillSel(occSub, list, keep ? s.profile.occupationSub : '', list.length ? '— เลือกหัวข้อย่อย —' : '(เลือกหมวดก่อน)');
      occSub.disabled = locked || !list.length;
    };
    refreshSub(true);
    occMain.addEventListener('change', () => refreshSub(false));
    const detailLabel = note(body, 'รายละเอียด (เช่น ชื่อสถานศึกษา สถานที่ทำงาน หรือสิ่งที่ทำ)');
    const occDetail = document.createElement('textarea'); occDetail.rows = 3; occDetail.maxLength = 200; occDetail.value = s.profile.occupationDetail || '';
    body.appendChild(occDetail);
    // เลือก "อื่นๆ (โปรดระบุ)" → เปลี่ยนป้ายเป็นให้พิมพ์ระบุตรงช่องนี้ และพาเคอร์เซอร์ไปรอให้พิมพ์เลย
    const OTHER = s.occupationOther || 'อื่นๆ (โปรดระบุ)';
    const syncOther = (focus) => {
      const isOther = occSub.value === OTHER;
      detailLabel.textContent = isOther ? '✍️ โปรดระบุ (พิมพ์สาขา/สิ่งที่คุณทำที่ช่องนี้ — จำเป็นต้องกรอก)' : 'รายละเอียด (เช่น ชื่อสถานศึกษา สถานที่ทำงาน หรือสิ่งที่ทำ)';
      detailLabel.style.color = isOther ? 'var(--neon)' : '';
      if (isOther && focus) { occDetail.focus(); occDetail.scrollIntoView({ block: 'center' }); }
    };
    occSub.addEventListener('change', () => syncOther(true));
    occMain.addEventListener('change', () => syncOther(false));
    syncOther(false);
    const msg = note(body, '');
    // โหมดดู (ล็อก แถบเทา) ↔ โหมดแก้ไข: ช่องทั้งหมดถูกล็อกจนกว่าจะกด "แก้ไข" แล้วบันทึกเสร็จจะล็อกกลับ
    const controls = [name, call, sec, avPick, avDel, occMain, occSub, occDetail];
    const saveBtn = sheetButton(body, '💾 บันทึกโปรไฟล์', async () => {
      try {
        const r = await api('PATCH', '/api/me/profile', { name: name.value, callName: call.value, secretaryName: sec.value, occupationMain: occMain.value, occupationSub: occSub.value, occupationDetail: occDetail.value });
        me.name = r.profile.name; me.callName = r.profile.callName || null; me.secretaryName = r.profile.secretaryName;
        me.occupationMain = r.profile.occupationMain; me.occupationSub = r.profile.occupationSub; me.occupationDetail = r.profile.occupationDetail;
        s.profile = { ...s.profile, ...r.profile };
        renderAvatar();
        locked = !!r.profile.occupationMain;   // ยังไม่ได้เลือกสถานะ → ปล่อยให้แก้ต่อได้
        applyLock();
        msg.textContent = '✓ บันทึกแล้วค่ะ' + (locked ? ' (กด "แก้ไข" ถ้าต้องการเปลี่ยน)' : '');
      } catch (err) { msg.textContent = err.message; }
    });
    const editBtn = sheetButton(body, '✏️ แก้ไข / อัปเดตโปรไฟล์', () => { locked = false; applyLock(); msg.textContent = ''; name.focus(); });
    const cancelBtn = sheetButton(body, '↩️ ยกเลิกการแก้ไข', () => showProfileEdit());
    function applyLock() {
      controls.forEach((c) => { c.disabled = locked; });
      if (!locked) { const list = opts[occMain.value] || []; occSub.disabled = !list.length; }
      saveBtn.hidden = locked; cancelBtn.hidden = locked || !s.profile.occupationMain; editBtn.hidden = !locked;
    }
    applyLock();
    profileBack(body);
  }
  async function showDataUsage() {
    const body = openSheet('ข้อมูลส่วนตัวของฉัน');
    const s = await loadSummary(body);
    if (s) {
      const big = note(body, fmtBytes(s.usage.totalBytes)); big.className = 'bal';
      note(body, 'ขนาดข้อมูลข้อความของคุณทั้งหมดบนแพลตฟอร์ม จากโควตา ' + fmtBytes(s.usage.quotaBytes) + ' ต่อคน (ไม่รวมรูป/ไฟล์ที่แนบ เพราะไม่ได้เก็บถาวร)');
      s.usage.parts.forEach((p) => note(body, p.label + ' · ' + p.count + ' รายการ · ' + fmtBytes(p.bytes)));
    }
    profileBack(body);
  }
  // ============================ กลุ่มสนทนา (เต็มจอ) ============================
  // หน้าแรกกลุ่ม → [สร้างกลุ่มใหม่ (ผู้สร้างเป็นแอดมิน สร้างได้ 2 กลุ่ม)] / [ดูกลุ่มทั้งหมด → ขอเข้าร่วม → ผู้สร้างอนุญาต] → แชทกลุ่ม (รูปโปรไฟล์ทุกข้อความ)
  const grp = { view: 'home', groupId: null, name: '', lastId: 0, timer: null, sessTimer: null, info: null, back: null, nextTarget: null };
  const gEl = (id) => document.getElementById(id);
  function grpAvatar(name, pic) {
    const d = document.createElement('div'); d.className = 'gav';
    const initial = () => { d.textContent = String(name || '?').trim().charAt(0) || '?'; };
    if (pic && (LINE_PIC_RE.test(pic) || /^\/api\/groups\/[0-9a-f-]+\/ai-avatar\/[0-9a-f-]+/.test(pic))) {
      const img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.onerror = initial; img.src = pic; d.appendChild(img);
    } else initial();
    return d;
  }
  function grpStopPoll() { if (grp.timer) { clearInterval(grp.timer); grp.timer = null; } grpUpdateSession(null); }
  // แถบ "เลขาคุยกันเอง — เหลือ mm:ss" (ข้อมูลช่วงมากับการดึงข้อความทุก 4 วินาที) + ปุ่มหยุด
  function grpUpdateSession(sess) {
    const bar = gEl('grpSession');
    if (grp.sessTimer) { clearInterval(grp.sessTimer); grp.sessTimer = null; }
    if (!sess) { bar.hidden = true; return; }
    const endAt = Date.now() + sess.secondsLeft * 1000;
    const paint = () => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      gEl('grpSessText').textContent = '🤖 เลขาคุยกันเองอยู่ · เหลือ ' + String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0') + (sess.topic ? ' · หัวข้อ: ' + sess.topic : '');
    };
    paint(); bar.hidden = false;
    grp.sessTimer = setInterval(paint, 1000);
  }
  gEl('grpSessStop').addEventListener('click', async () => {
    if (!grp.groupId) return;
    try { await api('DELETE', '/api/groups/' + grp.groupId + '/ai-session'); } catch (err) { alert(err.message); }
  });
  function grpFrame(title, back, showMenu) {
    gEl('grpTitle').textContent = title;
    grp.back = back || null;
    gEl('grpBack').hidden = !back;
    gEl('grpMenu').hidden = !showMenu;
    gEl('grpComposer').hidden = true;
    gEl('grpBody').textContent = '';
    return gEl('grpBody');
  }
  const gNote = (body, text) => { const d = document.createElement('div'); d.className = 'gnote'; d.textContent = text; body.appendChild(d); return d; };
  const gBtn = (parent, label, onClick, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'gact' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', onClick); parent.appendChild(b); return b; };
  function grpOpenView(fn) { gEl('grpOverlay').hidden = false; fn(); }
  function closeGroups() { grpStopPoll(); gEl('grpOverlay').hidden = true; grp.groupId = null; }
  gEl('grpClose').addEventListener('click', () => { closeGroups(); openGroupPopup(); });
  gEl('grpBack').addEventListener('click', () => { grpStopPoll(); if (grp.back) grp.back(); });
  // จากหน้าสนทนา/สร้าง/ดูทั้งหมด → กลับมาที่ popup กลุ่มของฉัน
  function grpBackToPopup() { closeGroups(); openGroupPopup(); }

  // ---------- popup เล็กกลางจอ: กลุ่มที่สร้าง (≤2) / กลุ่มที่เข้าร่วม (≤3) → แตะกลุ่มเพื่อเข้าหน้าสนทนา ----------
  const GRP_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#60a5fa'];
  const grpColor = (name) => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 997; return GRP_COLORS[h % GRP_COLORS.length]; };
  function closeGroupPopup() { gEl('grpPopOverlay').hidden = true; gEl('grpPopOverlay').classList.remove('above'); }
  gEl('grpPopOverlay').addEventListener('click', (e) => { if (e.target === gEl('grpPopOverlay')) closeGroupPopup(); });
  async function openGroupPopup() {
    const card = gEl('grpPopCard'); card.textContent = '';
    gEl('grpPopOverlay').hidden = false;
    const head = document.createElement('div'); head.className = 'pt';
    const t = document.createElement('span'); t.textContent = '👥 กลุ่มของฉัน';
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'ปิด'); x.addEventListener('click', closeGroupPopup);
    head.append(t, x); card.appendChild(head);
    let data;
    try { data = await api('GET', '/api/groups'); } catch (err) { const e = document.createElement('div'); e.className = 'sec'; e.textContent = err.message; card.appendChild(e); return; }
    // คำเชิญที่รอฉันตอบ (ผู้เชิญแสดงรูปโปรไฟล์) — ตอบรับ/ปฏิเสธได้ที่นี่
    let invites = [];
    try { invites = (await api('GET', '/api/groups/invites')).invites; } catch (e) { /* ไม่มีคำเชิญก็ข้าม */ }
    if (invites.length) {
      const h = document.createElement('div'); h.className = 'sec'; h.textContent = '📨 คำเชิญเข้ากลุ่ม (' + invites.length + ')'; card.appendChild(h);
      invites.forEach((iv) => {
        const box = document.createElement('div'); box.className = 'slot'; box.style.cssText = 'flex-direction:column;align-items:stretch;cursor:default;gap:8px';
        const top = document.createElement('div'); top.style.cssText = 'display:flex;gap:10px;align-items:center';
        const col = document.createElement('div'); col.style.cssText = 'flex:1;min-width:0';
        const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = iv.groupName;
        const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = 'เชิญโดย ' + iv.inviterName;
        col.append(nm, sub); top.append(grpAvatar(iv.inviterName, iv.inviterPicture), col); box.appendChild(top);
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px';
        const respond = async (accept) => {
          row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          try { await api('POST', '/api/groups/invites/' + iv.id + '/respond', { accept }); openGroupPopup(); }
          catch (err) { sub.textContent = err.message; row.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
        };
        const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'allbtn'; yes.style.cssText = 'flex:1;margin:0;padding:8px'; yes.textContent = '✓ ตอบรับ'; yes.addEventListener('click', () => respond(true));
        const no = document.createElement('button'); no.type = 'button'; no.className = 'allbtn'; no.style.cssText = 'flex:1;margin:0;padding:8px;border-color:var(--line);color:var(--muted)'; no.textContent = 'ปฏิเสธ'; no.addEventListener('click', () => respond(false));
        row.append(yes, no); box.appendChild(row); card.appendChild(box);
      });
    }
    const mkSlot = (g, extra) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'slot';
      const c = document.createElement('div'); c.className = 'circ'; c.style.background = grpColor(g.name);
      if (g.ownerPicture && LINE_PIC_RE.test(g.ownerPicture)) {
        const im = document.createElement('img'); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = g.ownerPicture;
        im.onerror = () => { im.remove(); c.textContent = String(g.name).trim().charAt(0) || '?'; };
        c.appendChild(im);
      } else c.textContent = String(g.name).trim().charAt(0) || '?';
      const attn = (g.pendingRequests || 0) + (g.unread || 0);
      if (attn) { const dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = attn; c.appendChild(dot); }
      const col = document.createElement('div'); col.style.cssText = 'flex:1;min-width:0';
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = g.name;
      const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = '👥 ' + g.members + ' คน' + (g.unread ? ' · 💬 ' + g.unread + ' ข้อความใหม่' : '') + (g.pendingRequests ? ' · 🔔 ' + g.pendingRequests + ' คำขอรออนุญาต' : '');
      col.append(nm, sub); b.append(c, col);
      b.addEventListener('click', () => { closeGroupPopup(); grpOpenView(() => grpChat(g.id, g.name)); });
      return b;
    };
    const mkEmpty = (text, onClick) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'slot empty';
      const c = document.createElement('div'); c.className = 'circ'; c.textContent = '+';
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = text;
      b.append(c, nm); b.addEventListener('click', onClick); return b;
    };
    const sec = (text) => { const d = document.createElement('div'); d.className = 'sec'; d.textContent = text; card.appendChild(d); };
    const mineCreated = data.groups.filter((g) => g.isOwner);
    const mineJoined = data.groups.filter((g) => g.myRole === 'member');
    sec('กลุ่มที่สร้าง (' + mineCreated.length + '/' + data.maxCreate + ')');
    mineCreated.forEach((g) => card.appendChild(mkSlot(g)));
    for (let k = mineCreated.length; k < data.maxCreate; k++) card.appendChild(mkEmpty('สร้างกลุ่มใหม่', () => { closeGroupPopup(); grpOpenView(() => grpCreate(data.maxCreate - data.createdByMe)); }));
    sec('กลุ่มที่เข้าร่วม (' + mineJoined.length + '/' + data.maxJoin + ')');
    mineJoined.forEach((g) => card.appendChild(mkSlot(g)));
    for (let k = mineJoined.length; k < data.maxJoin; k++) card.appendChild(mkEmpty('เข้าร่วมกลุ่ม (ดูกลุ่มทั้งหมด)', () => { closeGroupPopup(); grpOpenView(grpList); }));
    const all = document.createElement('button'); all.type = 'button'; all.className = 'allbtn'; all.textContent = '📋 ดูกลุ่มทั้งหมด (' + data.groups.length + ' กลุ่ม)';
    all.addEventListener('click', () => { closeGroupPopup(); grpOpenView(grpList); });
    card.appendChild(all);
    setGroupsBadge(data.groups.reduce((n, g) => n + ((g.isOwner ? g.pendingRequests : 0) || 0) + (g.unread || 0), 0) + invites.length);
  }
  function setGroupsBadge(n) { const b = gEl('groupsBadge'); if (!b) return; b.hidden = !n; b.textContent = n || ''; }
  async function refreshGroupsBadge() {
    try {
      const d = await api('GET', '/api/groups');
      let inv = 0; try { inv = (await api('GET', '/api/groups/invites')).invites.length; } catch (e) { /* ข้าม */ }
      setGroupsBadge(d.groups.reduce((n, g) => n + ((g.isOwner ? g.pendingRequests : 0) || 0) + (g.unread || 0), 0) + inv);
    } catch (e) { /* ไม่มีป้ายก็ข้าม */ }
  }
  gEl('groupsBtn').addEventListener('click', openGroupPopup);
  gEl('meetBtn').addEventListener('click', () => showMeetings());

  function grpCreate(left) {
    const body = grpFrame('สร้างกลุ่มใหม่', grpBackToPopup, false);
    if (left <= 0) { gNote(body, 'คุณสร้างกลุ่มครบ 2 กลุ่มแล้ว ถ้าอยากสร้างใหม่ ให้ลบกลุ่มเดิมก่อน (ผู้สร้างลบกลุ่มได้ที่เมนู ⋯ ในหน้าแชทกลุ่ม)'); return; }
    gNote(body, 'คุณจะเป็นแอดมินของกลุ่มนี้ คนอื่นต้องขอเข้าร่วมและคุณเป็นคนกดอนุญาต • สร้างได้คนละไม่เกิน 2 กลุ่ม (เหลืออีก ' + left + ' กลุ่ม)');
    gNote(body, 'ชื่อกลุ่ม');
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 40; body.appendChild(name);
    gNote(body, 'คำอธิบายกลุ่ม (ไม่บังคับ)');
    const desc = document.createElement('textarea'); desc.rows = 3; desc.maxLength = 200; body.appendChild(desc);
    const msg = gNote(body, '');
    gBtn(body, '✓ สร้างกลุ่ม', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; msg.textContent = '';
      try { const r = await api('POST', '/api/groups', { name: name.value, description: desc.value }); grpChat(r.group.id, r.group.name); }
      catch (err) { msg.textContent = err.message; btn.disabled = false; }
    }, 'ok');
  }

  async function grpList() {
    const body = grpFrame('กลุ่มทั้งหมด', grpBackToPopup, false);
    let data;
    try { data = await api('GET', '/api/groups'); } catch (err) { gNote(body, err.message); return; }
    if (!data.groups.length) gNote(body, 'ยังไม่มีกลุ่ม — ลองสร้างกลุ่มแรกได้เลย');
    data.groups.forEach((g) => {
      const c = document.createElement('div'); c.className = 'gcard';
      const t = document.createElement('b'); t.textContent = g.name; c.appendChild(t);
      if (g.description) { const d = document.createElement('div'); d.textContent = g.description; c.appendChild(d); }
      const orow = document.createElement('div'); orow.className = 'orow';
      const osm = document.createElement('small'); osm.textContent = '👥 ' + g.members + ' คน · ผู้สร้าง: ' + g.ownerName;
      orow.append(grpAvatar(g.ownerName, g.ownerPicture), osm); c.appendChild(orow);
      if (g.myRole) gBtn(c, '💬 เข้าแชทกลุ่ม', () => grpChat(g.id, g.name), 'ok');
      else if (g.pending) { const b = gBtn(c, '⏳ รอผู้สร้างอนุญาต', () => {}); b.disabled = true; }
      else gBtn(c, '🙋 ขอเข้าร่วมกลุ่ม', async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { await api('POST', '/api/groups/' + g.id + '/join', {}); btn.textContent = '⏳ ส่งคำขอแล้ว รอผู้สร้างอนุญาต'; }
        catch (err) { btn.textContent = err.message; }
      });
      body.appendChild(c);
    });
  }

  // ---------- เชิญเข้ากลุ่ม: แอดมินเลือกจากรายชื่อผู้ใช้ทั้งระบบ (รูป+ชื่อ) แล้วส่งคำเชิญ ----------
  function grpInvite(groupId, name) {
    const body = grpFrame('เชิญเข้ากลุ่ม', () => gEl('grpMenu').click(), false);
    gNote(body, 'ส่งคำเชิญไปให้คนที่ต้องการ เขาจะได้รับแจ้งและกดตอบรับเอง (ผู้ถูกเชิญเข้าร่วมกลุ่มของคนอื่นได้ไม่เกิน 3 กลุ่ม)');
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = '🔎 ค้นหาชื่อ'; search.maxLength = 40; body.appendChild(search);
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:8px'; body.appendChild(list);
    let timer = null; let seq = 0;
    const load = async () => {
      const my = ++seq;
      let r;
      try { r = await api('GET', '/api/groups/' + groupId + '/invite-candidates?q=' + encodeURIComponent(search.value.trim())); } catch (err) { list.textContent = ''; gNote(list, err.message); return; }
      if (my !== seq) return;
      list.textContent = '';
      if (!r.users.length) gNote(list, search.value.trim() ? 'ไม่พบชื่อที่ค้นหา' : 'ไม่มีผู้ใช้ที่เชิญได้');
      r.users.forEach((u) => {
        const row = document.createElement('div'); row.className = 'gcard'; row.style.cssText = 'flex-direction:row;align-items:center;gap:10px';
        const nm = document.createElement('b'); nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; nm.textContent = u.name;
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gact' + (u.invited ? '' : ' ok'); btn.style.cssText = 'padding:8px 14px;font-size:14px;flex-shrink:0';
        btn.textContent = u.invited ? '✓ เชิญแล้ว' : 'เชิญ'; btn.disabled = !!u.invited;
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.textContent = 'กำลังส่ง...';
          try { await api('POST', '/api/groups/' + groupId + '/invites', { userId: u.userId }); btn.textContent = '✓ เชิญแล้ว'; btn.classList.remove('ok'); }
          catch (err) { btn.textContent = 'เชิญ'; btn.disabled = false; nm.textContent = u.name + ' — ' + err.message; }
        });
        row.append(grpAvatar(u.name, u.picture), nm, btn);
        list.appendChild(row);
      });
    };
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    load();
  }

  // ---------- แชทกลุ่ม ----------
  function fmtGTime(iso) { try { return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function grpAddMsg(log, m) {
    if (m.isSystem) { const d = document.createElement('div'); d.className = 'gsys'; d.textContent = m.content; log.appendChild(d); return; }
    const row = document.createElement('div'); row.className = 'gmsg' + (m.mine || m.myAi ? ' mine' : '') + (m.isAi ? ' ai' : '');   // เลขาของเราพูด = ข้อความที่ส่งจากฝั่งเรา → ชิดขวาเหมือนข้อความของเรา (ยังติดป้าย 🤖 + สีม่วงให้รู้ว่าเป็นเลขา)
    const bub = document.createElement('div'); bub.className = 'gbub';
    const nm = document.createElement('div'); nm.className = 'gname'; nm.textContent = m.isAi ? '🤖 ' + m.name + ' · เลขาของ ' + m.ownerName : m.name;
    const tx = document.createElement('div'); tx.className = 'gtext'; tx.textContent = m.content;
    const tm = document.createElement('div'); tm.className = 'gtime'; tm.textContent = fmtGTime(m.createdAt);
    bub.append(nm, tx, tm);
    row.append(grpAvatar(m.name, m.picture), bub);
    log.appendChild(row);
  }
  // ---------- เลขาของฉันในห้องแชทกลุ่ม: ติ๊ก "ร่วมคุย" + หัวข้อ + ปุ่ม "สรุปการสนทนา" (บันทึกลงหมวด "ข้อมูลแชท") ----------
  async function openGrpAiPanel() {
    const groupId = grp.groupId; if (!groupId) return;
    const overlay = gEl('grpPopOverlay'); const card = gEl('grpPopCard');
    overlay.classList.add('above'); overlay.hidden = false; card.textContent = '';
    const head = document.createElement('div'); head.className = 'pt';
    const hl = document.createElement('div'); hl.className = 'aihead';
    const pic = document.createElement('div'); pic.className = 'gav'; aiImgInto(pic);
    const ttl = document.createElement('span'); ttl.textContent = (me && me.secretaryName) || 'เลขา';
    hl.append(pic, ttl);
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'ปิด'); x.addEventListener('click', closeGrpAiPanel);
    head.append(hl, x); card.appendChild(head);
    let info;
    try { info = await api('GET', '/api/groups/' + groupId); } catch (err) { const e = document.createElement('div'); e.className = 'gnote2'; e.textContent = err.message; card.appendChild(e); return; }
    const lab = document.createElement('label'); lab.className = 'chk';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!info.mySettings.aiJoin;
    const lt = document.createElement('div'); lt.innerHTML = ''; const b1 = document.createElement('b'); b1.textContent = 'ร่วมคุยในกลุ่มนี้';
    const sm = document.createElement('small'); sm.textContent = 'เลขาของคุณจะพูดในกลุ่มเอง เมื่อมีคนเรียกชื่อเลขา หรือมีข้อความที่ตรงกับหัวข้อด้านล่าง (ไม่เอาข้อมูลส่วนตัวของคุณมาพูด และมีเพดานจำนวนข้อความ)';
    lt.append(b1, sm); lab.append(cb, lt); card.appendChild(lab);
    const tl = document.createElement('div'); tl.className = 'sec'; tl.textContent = 'หัวข้อที่จะคุย / ที่สนใจ'; card.appendChild(tl);
    const topic = document.createElement('input'); topic.type = 'text'; topic.maxLength = 100; topic.value = info.mySettings.aiTopic || ''; card.appendChild(topic);
    const msg = document.createElement('div'); msg.className = 'gnote2';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'allbtn'; save.textContent = '💾 บันทึกการตั้งค่า';
    save.addEventListener('click', async () => {
      save.disabled = true; msg.textContent = '';
      try { await api('PATCH', '/api/groups/' + groupId + '/ai-settings', { aiJoin: cb.checked, aiTopic: topic.value }); msg.textContent = '✓ บันทึกแล้วค่ะ'; } catch (err) { msg.textContent = err.message; }
      save.disabled = false;
    });
    card.appendChild(save);
    const sumTitle = document.createElement('div'); sumTitle.className = 'sec'; sumTitle.textContent = 'สรุปการสนทนา'; card.appendChild(sumTitle);
    const sumNote = document.createElement('div'); sumNote.className = 'gnote2';
    sumNote.textContent = 'ให้เลขาสรุปแชทกลุ่มนี้ (ล่าสุดไม่เกิน 80 ข้อความ; ถ้าใส่หัวข้อ จะสรุปเฉพาะเรื่องนั้น) แล้วบันทึกลงหมวด "💬 ข้อมูลแชท" ของคุณ — เป็นข้อมูลส่วนตัว เปิดแชร์/ขายไม่ได้';
    card.appendChild(sumNote);
    const res = document.createElement('div');
    const sum = document.createElement('button'); sum.type = 'button'; sum.className = 'allbtn'; sum.textContent = '📝 สรุปการสนทนา';
    sum.addEventListener('click', async () => {
      sum.disabled = true; sum.textContent = 'เลขากำลังสรุป...'; res.textContent = ''; res.className = '';
      try {
        const r = await api('POST', '/api/groups/' + groupId + '/summarize', { topic: topic.value });
        res.className = 'sumres'; res.textContent = '✓ บันทึกลงหมวด "' + r.category + '" แล้วค่ะ\n\n' + r.summary;
      } catch (err) { res.className = 'gnote2'; res.textContent = err.message; }
      sum.disabled = false; sum.textContent = '📝 สรุปการสนทนา';
    });
    card.append(sum, res, msg);
    const sesTitle = document.createElement('div'); sesTitle.className = 'sec'; sesTitle.textContent = 'ให้เลขาคุยกันเอง (สวิตช์ 5 นาที)'; card.appendChild(sesTitle);
    const sesNote = document.createElement('div'); sesNote.className = 'gnote2';
    sesNote.textContent = 'เปิดช่วงให้เลขา AI ที่ร่วมคุยในกลุ่มนี้ผลัดกันคุยกันเองประมาณ 5 นาที โดยไล่คุยทีละประเด็น (พูดห่างกันประมาณ 20 วินาที) ครบเวลาระบบปิดเอง แล้วเลขาแต่ละตัวจดบันทึกว่าได้รู้จักใครบ้าง (เลขาตัวอื่นและสมาชิก) ลงหมวด "💬 ข้อมูลแชท" ของเจ้าของ — ต้องมีเลขาร่วมคุยอย่างน้อย 2 ตัว และติ๊ก "ร่วมคุย" ของคุณก่อน';
    card.appendChild(sesNote);
    const issLab = document.createElement('div'); issLab.className = 'sec'; issLab.textContent = 'ประเด็นให้เลขาคุยกัน — พิมพ์ได้หลายข้อ (ขึ้นบรรทัดใหม่) ถ้าเว้นว่าง เลขาจะตั้งประเด็นให้เอง'; card.appendChild(issLab);
    const issues = document.createElement('textarea'); issues.rows = 3; issues.maxLength = 400; issues.style.cssText = 'padding:11px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--text);font:inherit;font-size:16px;width:100%;box-sizing:border-box;resize:vertical'; card.appendChild(issues);
    const sesMsg = document.createElement('div'); sesMsg.className = 'gnote2';
    const sesBtn = document.createElement('button'); sesBtn.type = 'button'; sesBtn.className = 'allbtn'; sesBtn.textContent = '▶ เริ่มให้เลขาคุยกันเอง 5 นาที';
    sesBtn.addEventListener('click', async () => {
      sesBtn.disabled = true; sesMsg.textContent = '';
      try { await api('PATCH', '/api/groups/' + groupId + '/ai-settings', { aiJoin: cb.checked, aiTopic: topic.value }); await api('POST', '/api/groups/' + groupId + '/ai-session', { topic: issues.value }); closeGrpAiPanel(); }
      catch (err) { sesMsg.textContent = err.message; sesBtn.disabled = false; }
    });
    card.append(sesBtn, sesMsg);
  }
  function closeGrpAiPanel() { const o = gEl('grpPopOverlay'); o.hidden = true; o.classList.remove('above'); }
  gEl('grpAi').addEventListener('click', openGrpAiPanel);

  // ---------- เลือกก่อนว่า "จะคุยกับใคร": เลขาของฉัน (ตอบเฉพาะเรา เป็นเสียงได้) หรือ ห้องแชทกลุ่ม (ส่งให้ทุกคน) ----------
  // เลขายังส่งข้อความเข้ากลุ่มเองอัตโนมัติไม่ได้ — ถ้าอยากให้ไปพูดในกลุ่ม เลขาจะร่างให้แล้วเรากดส่งเข้ากลุ่มเอง
  function grpChooseTarget(kind) {
    return new Promise((resolve) => {
      const overlay = gEl('grpPopOverlay'); const card = gEl('grpPopCard');
      overlay.classList.add('above'); overlay.hidden = false; card.textContent = '';
      let done = false;
      const finish = (v) => { if (done) return; done = true; overlay.hidden = true; overlay.classList.remove('above'); overlay.removeEventListener('click', onBackdrop); resolve(v); };
      const onBackdrop = (e) => { if (e.target === overlay) finish(null); };
      overlay.addEventListener('click', onBackdrop);
      const head = document.createElement('div'); head.className = 'pt';
      const t = document.createElement('span'); t.textContent = kind === 'mic' ? '🎤 จะพูดกับใคร?' : '➤ จะส่งถึงใคร?';
      head.appendChild(t); card.appendChild(head);
      const mkT = (avatarEl, name, sub, value) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tgt';
        const col = document.createElement('div'); col.style.cssText = 'flex:1;min-width:0';
        const n = document.createElement('div'); n.className = 'tn'; n.textContent = name;
        const s = document.createElement('small'); s.textContent = sub;
        col.append(n, s); b.append(avatarEl, col); b.addEventListener('click', () => finish(value)); card.appendChild(b);
      };
      const aiPic = document.createElement('div'); aiPic.className = 'gav'; aiImgInto(aiPic);
      mkT(aiPic, '🤖 เลขา (' + ((me && me.secretaryName) || 'เลขา') + ')', kind === 'mic' ? 'คุยกับเลขาด้วยเสียง เลขาตอบเป็นเสียง เห็นเฉพาะคุณ' : 'ถามหรือสั่งเลขา เลขาตอบเฉพาะคุณ ไม่ส่งเข้ากลุ่ม', 'secretary');
      const gPic = document.createElement('div'); gPic.className = 'gav'; gPic.textContent = '👥';
      mkT(gPic, '👥 ห้องแชทกลุ่ม', kind === 'mic' ? 'พูดแล้วแปลงเป็นข้อความ ตรวจก่อนแล้วกดส่งเข้ากลุ่ม' : 'ส่งข้อความนี้ให้ทุกคนในกลุ่มเห็น', 'group');
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'tgt cancel'; cancel.textContent = 'ยกเลิก';
      cancel.addEventListener('click', () => finish(null)); card.appendChild(cancel);
    });
  }
  // คุยกับเลขาจากห้องแชท: ส่งเข้าบทสนทนาส่วนตัวของเรา พร้อมแนบข้อความล่าสุดของกลุ่มเป็นบริบท (เซิร์ฟเวอร์ตรวจว่าเป็นสมาชิก) — แสดงเป็นบับเบิลเส้นประ (ไม่ใช่ข้อความกลุ่ม)
  async function grpAskSecretary(text, source) {
    const body = gEl('grpBody');
    const privRow = (mine, label, content, picEl) => {
      const row = document.createElement('div'); row.className = 'gmsg priv' + (mine ? ' mine' : '');
      const bub = document.createElement('div'); bub.className = 'gbub';
      const nm = document.createElement('div'); nm.className = 'gname'; nm.textContent = label;
      const tx = document.createElement('div'); tx.className = 'gtext'; tx.textContent = content;
      const tg = document.createElement('div'); tg.className = 'gprivtag'; tg.textContent = 'เห็นเฉพาะคุณ ไม่ได้ส่งเข้ากลุ่ม';
      bub.append(nm, tx, tg); row.append(picEl, bub); body.appendChild(row); body.scrollTop = body.scrollHeight; return { row, tx };
    };
    const myPic = document.createElement('div'); myPic.className = 'gav'; avatarContent(myPic);
    privRow(true, 'คุณ → เลขา', text, myPic);
    const aiPic = document.createElement('div'); aiPic.className = 'gav'; aiImgInto(aiPic);
    const ans = privRow(false, '🤖 ' + ((me && me.secretaryName) || 'เลขา'), 'กำลังคิด...', aiPic);
    try {
      if (source === 'voice') { try { unlockSpeech(); } catch (e) { /* ignore */ } }
      const r = await api('POST', '/api/chat/conversations/' + conversationId + '/messages', { content: text, source: source === 'voice' ? 'voice' : 'text', groupContext: grp.groupId });
      ans.tx.textContent = r.reply;
      body.scrollTop = body.scrollHeight;
      if (source === 'voice' && (ttsSupported || premiumActive())) speak(r.reply, () => setBotState('idle'));
    } catch (err) { ans.tx.textContent = err.message; }
  }

  // ไมค์ในห้องแชทกลุ่ม: แตะ → เลือกก่อนว่าจะพูดกับใคร → เริ่มอัด แตะอีกครั้งหยุด
  //   เลขา = ถอดเสียงแล้วส่งให้เลขา เลขาตอบเป็นเสียง • กลุ่ม = ถอดเสียงลงช่องพิมพ์ (ตรวจก่อนแล้วกดส่งเข้ากลุ่มเอง)
  let grpRec = null;
  gEl('grpMic').addEventListener('click', async () => {
    const btn = gEl('grpMic');
    if (grpRec) { grpRec.recorder.stop(); return; }
    const target = await grpChooseTarget('mic');
    if (!target) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { alert('เบราว์เซอร์นี้ยังอัดเสียงไม่ได้ — พิมพ์แทนได้ค่ะ'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { alert('ยังไม่ได้อนุญาตใช้ไมค์ — เปิดสิทธิ์ไมค์ของเบราว์เซอร์ก่อนนะคะ'); return; }
    const chunks = [];
    const rec = new MediaRecorder(stream);
    grpRec = { recorder: rec, target, timer: setTimeout(() => { if (grpRec) rec.stop(); }, 30000) };
    btn.classList.add('rec');
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      const recTarget = grpRec ? grpRec.target : 'group';
      clearTimeout(grpRec && grpRec.timer); grpRec = null; btn.classList.remove('rec');
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (!blob.size) return;
      btn.disabled = true; btn.textContent = '…';
      try {
        const audio = await blobToBase64(blob);
        const { text } = await api('POST', '/api/chat/transcribe', { audio, mimeType: blob.type || 'audio/webm' });
        if (text && text.trim()) {
          if (recTarget === 'secretary') { btn.disabled = false; btn.textContent = '🎤'; await grpAskSecretary(text.trim(), 'voice'); return; }
          const inp = gEl('grpInput'); inp.value = (inp.value ? inp.value + ' ' : '') + text.trim(); inp.focus();
          grp.nextTarget = 'group';   // พูดเพื่อส่งเข้ากลุ่มไว้แล้ว — กดส่งครั้งถัดไปไม่ต้องถามซ้ำ
        } else alert('ไม่ได้ยินเสียงชัดๆ ลองพูดใหม่อีกครั้งนะคะ');
      } catch (err) { alert(err.message); }
      btn.disabled = false; btn.textContent = '🎤';
    };
    rec.start();
  });

  async function grpChat(groupId, name) {
    grpStopPoll();
    grp.groupId = groupId; grp.name = name || 'กลุ่ม'; grp.lastId = 0; grp.nextTarget = null;
    const body = grpFrame('💬 ' + (name || 'กลุ่ม'), grpBackToPopup, true);
    gEl('grpComposer').hidden = false;
    aiImgInto(gEl('grpAi'));
    const stick = () => { body.scrollTop = body.scrollHeight; };
    const load = async (first) => {
      if (grp.groupId !== groupId) return;
      try {
        const r = await api('GET', '/api/groups/' + groupId + '/messages' + (grp.lastId ? '?after=' + grp.lastId : ''));
        if (grp.groupId !== groupId) return;
        const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
        r.messages.forEach((m) => { grpAddMsg(body, m); grp.lastId = Math.max(grp.lastId, m.id); });
        grpUpdateSession(r.session);
        if (r.messages.length && (first || atBottom)) stick();
        if (first && !r.messages.length) gNote(body, 'ยังไม่มีข้อความ — พิมพ์ทักทายเป็นคนแรกได้เลย');
      } catch (err) { if (first) { gNote(body, err.message); gEl('grpComposer').hidden = true; } }
    };
    await load(true);
    grp.timer = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 4000);
  }
  gEl('grpComposer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = gEl('grpInput'); const text = input.value.trim();
    if (!text || !grp.groupId) return;
    let target = grp.nextTarget; grp.nextTarget = null;
    if (!target) target = await grpChooseTarget('send');
    if (!target) return;
    if (target === 'secretary') { input.value = ''; await grpAskSecretary(text, 'text'); input.focus(); return; }
    const send = gEl('grpSend'); send.disabled = true;
    try {
      await api('POST', '/api/groups/' + grp.groupId + '/messages', { content: text });
      input.value = '';
      const r = await api('GET', '/api/groups/' + grp.groupId + '/messages' + (grp.lastId ? '?after=' + grp.lastId : ''));
      const body = gEl('grpBody');
      const empty = body.querySelector('.gnote'); if (empty && body.querySelectorAll('.gmsg').length === 0) empty.remove();
      r.messages.forEach((m) => { grpAddMsg(body, m); grp.lastId = Math.max(grp.lastId, m.id); });
      body.scrollTop = body.scrollHeight;
    } catch (err) { alert(err.message); }
    send.disabled = false; input.focus();
  });
  // เมนู ⋯ ของกลุ่ม: สมาชิก + (แอดมิน) คำขอเข้าร่วม + ออกจากกลุ่ม/ลบกลุ่ม
  gEl('grpMenu').addEventListener('click', async () => {
    const groupId = grp.groupId; if (!groupId) return;
    grpStopPoll();
    const prevName = grp.name;
    const body = grpFrame('ตัวเลือกกลุ่ม', () => grpChat(groupId, prevName), false);
    let info;
    try { info = await api('GET', '/api/groups/' + groupId); } catch (err) { gNote(body, err.message); return; }
    if (info.isAdmin) {
      gBtn(body, '➕ เชิญเข้ากลุ่ม (เลือกจากรายชื่อทั้งหมดในระบบ)', () => grpInvite(groupId, prevName), 'ok');
      gNote(body, 'คำขอเข้าร่วมกลุ่ม (' + info.requests.length + ')');
      if (!info.requests.length) gNote(body, 'ไม่มีคำขอที่รออยู่');
      info.requests.forEach((r) => {
        const c = document.createElement('div'); c.className = 'gcard';
        const top = document.createElement('div'); top.style.cssText = 'display:flex;gap:10px;align-items:center';
        const nm = document.createElement('b'); nm.textContent = r.name; top.append(grpAvatar(r.name, r.picture), nm); c.appendChild(top);
        const row = document.createElement('div'); row.className = 'grow'; c.appendChild(row);
        const decide = async (approve) => { row.querySelectorAll('button').forEach((b) => { b.disabled = true; }); try { await api('POST', '/api/groups/requests/' + r.id + '/decide', { approve }); c.remove(); } catch (err) { nm.textContent = r.name + ' — ' + err.message; } };
        gBtn(row, '✓ อนุญาต', () => decide(true), 'ok'); gBtn(row, '✕ ไม่อนุญาต', () => decide(false));
        body.appendChild(c);
      });
    }
    gNote(body, 'สมาชิก (' + info.members.length + ')');
    info.members.forEach((m) => {
      const c = document.createElement('div'); c.className = 'gcard'; c.style.cssText = 'flex-direction:row;align-items:center;gap:10px';
      const nm = document.createElement('b'); nm.textContent = m.name + (m.role === 'admin' ? '  👑 แอดมินกลุ่ม' : '');
      c.append(grpAvatar(m.name, m.picture), nm); body.appendChild(c);
    });
    if (info.isAdmin) {
      gBtn(body, '🗑️ ลบกลุ่มนี้ (ข้อความและสมาชิกหายหมด)', () => {
        const b2 = grpFrame('ยืนยันลบกลุ่ม?', () => gEl('grpMenu').click(), false);
        gNote(b2, '⚠️ กลุ่ม "' + info.group.name + '" จะถูกลบพร้อมข้อความและสมาชิกทั้งหมด และกู้คืนไม่ได้');
        gBtn(b2, '🗑️ ยืนยัน ลบกลุ่ม', async () => { try { await api('DELETE', '/api/groups/' + groupId); grpBackToPopup(); } catch (err) { gNote(b2, err.message); } }, 'danger');
      }, 'danger');
    } else {
      gBtn(body, '🚪 ออกจากกลุ่ม', async () => { try { await api('POST', '/api/groups/' + groupId + '/leave', {}); grpBackToPopup(); } catch (err) { gNote(body, err.message); } }, 'danger');
    }
  });
  // ---------- อัลบั้มรูป (เมนู ☰ → 🖼️ อัลบั้ม): เพิ่มรูป เลขาอ่านรูปแล้วตั้งชื่อ/แท็กให้ ขอให้เลขาดึงรูปมาแสดงในแชทได้ ----------
  // ย่อรูปที่หน้าเว็บก่อนอัปโหลด (คงสัดส่วน): รูปเต็มด้านยาวไม่เกิน 1280 พิกเซล + รูปย่อ 320 พิกเซล
  function resizeKeep(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, maxSide / Math.max(img.width, img.height));
          const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg', quality));
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้ (ลองรูปชนิด JPG/PNG)')); };
      img.src = url;
    });
  }
  async function showAlbum() {
    const body = openSheet('อัลบั้มรูป');
    let data;
    try { data = await api('GET', '/api/album'); } catch (err) { note(body, err.message); return; }
    const mb = (b) => (Math.round((b / 1048576) * 10) / 10);
    note(body, 'รูปในอัลบั้มเป็นส่วนตัว คนอื่นไม่เห็น เลขาอ่านรูปแล้วตั้งชื่อและแท็กให้ ลองบอกเลขาว่า "ขอดูรูปบ่อกุ้ง" เลขาจะค้นแล้วเอารูปมาแสดงในแชทให้');
    const usage = note(body, 'รูป ' + data.usage.count + '/' + data.usage.maxPhotos + ' • พื้นที่ ' + mb(data.usage.bytes) + '/' + mb(data.usage.maxBytes) + ' MB', 'sub');
    const msg = note(body, '');
    const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.multiple = true; fileIn.hidden = true; body.appendChild(fileIn);
    const addBtn = sheetButton(body, '➕ เพิ่มรูป (ถ่ายรูป / เลือกจากเครื่อง)', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const files = [...fileIn.files].slice(0, 10); fileIn.value = '';
      if (!files.length) return;
      addBtn.disabled = true; let ok = 0;
      for (let i = 0; i < files.length; i++) {
        msg.textContent = 'กำลังเพิ่มรูป ' + (i + 1) + '/' + files.length + ' (เลขากำลังอ่านรูป...)';
        try {
          const image = await resizeKeep(files[i], 1280, 0.82);
          const thumb = await resizeKeep(files[i], 320, 0.7);
          await api('POST', '/api/album', { image, thumb });
          ok++;
        } catch (err) { msg.textContent = 'รูปที่ ' + (i + 1) + ': ' + err.message; break; }
      }
      addBtn.disabled = false;
      if (ok) showAlbum();
    });
    if (!data.photos.length) { note(body, 'ยังไม่มีรูป กด "เพิ่มรูป" ได้เลย'); return; }
    const grid = document.createElement('div'); grid.className = 'alb-grid'; body.appendChild(grid);
    data.photos.forEach((p) => {
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'alb-item';
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = p.caption || 'รูป'; im.src = '/api/album/' + p.id + '/thumb';
      const cap = document.createElement('span'); cap.textContent = p.caption || '(ไม่มีชื่อ)';
      cell.append(im, cap); cell.addEventListener('click', () => showAlbumPhoto(p)); grid.appendChild(cell);
    });
  }
  function showAlbumPhoto(p) {
    const body = openSheet('รูปในอัลบั้ม');
    const im = document.createElement('img'); im.className = 'alb-big'; im.alt = p.caption || 'รูป'; im.src = '/api/album/' + p.id + '/image';
    im.addEventListener('click', () => openPhotoLightbox(p.id)); body.appendChild(im);
    const cap = document.createElement('input'); cap.type = 'text'; cap.maxLength = 80; cap.value = p.caption || ''; cap.placeholder = 'ชื่อรูป'; body.appendChild(cap);
    const msg = note(body, '');
    sheetButton(body, '💾 บันทึกชื่อ', async () => {
      try { const r = await api('PATCH', '/api/album/' + p.id, { caption: cap.value }); p.caption = r.photo.caption; msg.textContent = '✓ บันทึกแล้ว'; } catch (err) { msg.textContent = err.message; }
    });
    if (p.description) note(body, '🤖 เลขาอ่านรูปนี้ว่า: ' + p.description);
    if (p.tags && p.tags.length) note(body, 'แท็ก: ' + p.tags.join(' • '), 'sub');
    sheetButton(body, '🗑️ ลบรูปนี้', async () => {
      if (!confirm('ลบรูปนี้ออกจากอัลบั้ม? ลบแล้วกู้คืนไม่ได้')) return;
      try { await api('DELETE', '/api/album/' + p.id); showAlbum(); } catch (err) { msg.textContent = err.message; }
    }, 'danger');
    sheetButton(body, '← กลับอัลบั้ม', showAlbum);
  }

  // ---------- สัมมนา / ประชุมออนไลน์: สร้างห้อง + ส่งลิงก์ (ใครมีลิงก์เข้าได้โดยไม่ต้องสมัคร) ----------
  const meetUrl = (m) => location.origin + '/meet/' + m.code;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* ลองวิธีสำรอง */ }
    try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch (e) { return false; }
  }
  async function showMeetings() {
    const body = openSheet('สัมมนา / ประชุมออนไลน์');
    note(body, 'สร้างห้องวิดีโอแล้วส่งลิงก์ให้ใครก็ได้ — คนที่มีลิงก์เข้าห้องได้เลยโดยไม่ต้องสมัคร (และจะเห็นปุ่มชวนสมัครสมาชิกให้ด้วย)\nประชุม = ทุกคนพูดได้ • สัมมนา = ผู้ฟังเข้ามาแบบปิดไมค์/กล้องไว้ก่อน');
    const title = document.createElement('input'); title.type = 'text'; title.maxLength = 80; title.placeholder = 'ชื่อห้อง เช่น คุยเรื่องอาหารกุ้งช่วงฤดูหนาว'; body.appendChild(title);
    const type = document.createElement('select');
    [['meeting', '👥 ประชุม (ทุกคนพูดได้)'], ['seminar', '🎓 สัมมนา (ผู้จัดพูดเป็นหลัก)']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; type.appendChild(o); });
    body.appendChild(type);
    const msg = note(body, '');
    sheetButton(body, '➕ สร้างห้อง', async () => {
      msg.textContent = '';
      try { const r = await api('POST', '/api/meetings', { title: title.value, type: type.value }); showMeetings(); } catch (err) { msg.textContent = err.message; }
    });
    let list = [];
    try { list = (await api('GET', '/api/meetings')).meetings; } catch (err) { note(body, err.message); }
    if (list.length) note(body, 'ห้องของฉัน (ยังเปิดอยู่)', 'sub');
    list.forEach((m) => {
      const d = pcard(body, (m.type === 'seminar' ? '🎓 ' : '👥 ') + m.title, meetUrl(m) + '\nลิงก์ใช้ได้ถึง ' + new Date(m.expiresAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
      const row = document.createElement('div'); row.className = 'row2'; d.appendChild(row);
      miniBtn(row, '🚪 เข้าห้อง', () => { window.open(meetUrl(m), '_blank'); }, 'ok');
      const cp = miniBtn(row, '🔗 คัดลอกลิงก์', async () => { cp.textContent = (await copyText(meetUrl(m))) ? '✓ คัดลอกแล้ว' : 'คัดลอกไม่ได้ — กดค้างที่ลิงก์เอง'; });
      const row2 = document.createElement('div'); row2.className = 'row2'; d.appendChild(row2);
      miniBtn(row2, '💬 ส่งทางไลน์', () => { window.open('https://line.me/R/msg/text/?' + encodeURIComponent('ขอเชิญเข้าร่วม' + (m.type === 'seminar' ? 'สัมมนา' : 'ประชุม') + ' "' + m.title + '"\n' + meetUrl(m)), '_blank'); });
      miniBtn(row2, '⏹ จบห้อง', async () => {
        if (!confirm('จบห้อง "' + m.title + '" ? ลิงก์จะใช้เข้าห้องไม่ได้อีก')) return;
        try { await api('POST', '/api/meetings/' + m.id + '/end', {}); showMeetings(); } catch (err) { alert(err.message); }
      }, 'danger');
    });
  }
  function showSeminarSoon() {
    const body = openSheet('สัมมนา / ประชุมออนไลน์');
    note(body, '🎥 สัมมนา / ประชุมออนไลน์ (กำลังพัฒนา)\nเร็วๆ นี้จะมีห้องสัมมนาและห้องประชุมออนไลน์บนแพลตฟอร์มของเรา ไว้นัดคุยและแลกเปลี่ยนความรู้กับคนอื่นได้โดยไม่ต้องออกจากแอป');
    profileBack(body);
  }
  async function showGoogleInfo() {
    const body = openSheet('ค้นหาด้วย Google');
    const s = await loadSummary(body);
    if (s) {
      note(body, s.google.enabled ? '✅ คุณได้รับอนุญาตให้ค้นหาข้อมูลภายนอกด้วย Google' : '🔒 ยังไม่ได้รับอนุญาต — สิทธิ์นี้แอดมินเป็นคนกำหนดให้ทีละคน');
      note(body, 'ใช้ค้นหาด้วย Google ไปแล้วในเดือนนี้ ' + s.google.count + ' จาก ' + s.google.limit + ' ครั้ง (รีเซ็ตทุกวันที่ 1 ของเดือน)');
      note(body, 'ตัวค้นหาข้อมูลภายนอกกำลังพัฒนา ตอนนี้เป็นการกำหนดสิทธิ์และนับจำนวนไว้ก่อน');
    }
    profileBack(body);
  }
  $('avatar').addEventListener('click', showProfileMenu);
  $('avatar').style.cursor = 'pointer';

  // ---------- สถานะบอท ----------
  const STATE_TEXT = { idle: 'พร้อมคุยค่ะ', thinking: 'เลขากำลังคิด...', speaking: 'เลขากำลังพูด...', listening: 'กำลังฟังอยู่ค่ะ...' };
  let botState = 'idle';
  function setBotState(s) {
    const prevState = botState;
    botState = s;
    if (window.aqTick) window.aqTick.state(prevState, s);
    botStage.className = 'state-' + s;
    $('stateLabel').textContent = STATE_TEXT[s] || '';
    const bot = $('bot');
    if (bot) bot.autoRotate = (s === 'idle');
    if (voiceMode) { $('voiceScreen').className = (voicePaused ? 'paused ' : '') + 'state-' + s; if (!voicePaused) $('vState').textContent = STATE_TEXT[s] || ''; }
  }

  // ---------- ข้อความในแชท ----------
  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    // ป้ายรูปจากอัลบั้ม (เก็บไว้ท้ายข้อความของเลขาในประวัติ) → ตัดออกจากข้อความ แล้วโชว์เป็นรูปใต้ข้อความ
    const ids = [];
    const genIds = [];
    if (role === 'assistant' && typeof text === 'string' && text.includes('⟦photo:')) {
      text = text.replace(/\s*⟦photo:([0-9a-f-]{36})⟧/gi, (m, id) => { ids.push(id); return ''; });
    }
    if (role === 'assistant' && typeof text === 'string' && text.includes('⟦gen:')) {
      text = text.replace(/\s*⟦gen:([0-9a-f-]{36})⟧/gi, (m, id) => { genIds.push(id); return ''; });
    }
    div.textContent = text;
    logEl.appendChild(div);
    if (ids.length) appendPhotoStrip(div, ids);
    if (genIds.length) appendGeneratedImages(div, genIds);
    scrollToBottom();
    return div;
  }
  // ---------- อัลบั้มรูป: รูปที่เลขาดึงมาแสดงในแชท + ดูรูปเต็ม ----------
  function openPhotoLightbox(id) {
    const ov = document.createElement('div'); ov.id = 'photoLightbox';
    const img = document.createElement('img'); img.alt = ''; img.src = '/api/album/' + id + '/image';
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕ ปิด';
    const close = () => ov.remove();
    ov.addEventListener('click', close); x.addEventListener('click', close);
    ov.append(img, x); document.body.appendChild(ov);
  }
  // ภาพที่เลขาวาดให้ (เจนภาพ): โชว์ภาพใหญ่ในแชท กดดูเต็มจอได้ + ปุ่มบันทึกลงอัลบั้มถาวร (ภาพที่เจนเก็บไว้ในประวัติแชทล่าสุด 60 ภาพ)
  function appendGeneratedImages(bubble, ids) {
    ids.forEach((id) => {
      const wrap = document.createElement('div'); wrap.className = 'gen-img';
      const im = document.createElement('img'); im.alt = 'ภาพที่เลขาวาดให้'; im.loading = 'lazy'; im.src = '/api/imagegen/' + id + '/image';
      im.addEventListener('click', () => { const ov = document.createElement('div'); ov.id = 'photoLightbox'; const big = document.createElement('img'); big.alt = ''; big.src = im.src; const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕ ปิด'; const close = () => ov.remove(); ov.addEventListener('click', close); x.addEventListener('click', close); ov.append(big, x); document.body.appendChild(ov); });
      im.addEventListener('load', scrollToBottom);
      im.addEventListener('error', () => wrap.remove());   // ภาพเก่าเกิน 60 ภาพถูกลบแล้ว → ซ่อนเงียบๆ
      const save = document.createElement('button'); save.type = 'button'; save.className = 'gen-save'; save.textContent = '💾 บันทึกลงอัลบั้ม';
      save.addEventListener('click', async () => {
        save.disabled = true; save.textContent = 'กำลังบันทึก...';
        try {
          const blob = await (await fetch(im.src, { credentials: 'same-origin' })).blob();
          const image = await resizeKeep(blob, 1280, 0.85); const thumb = await resizeKeep(blob, 320, 0.7);
          await api('POST', '/api/album', { image, thumb });
          save.textContent = '✓ บันทึกลงอัลบั้มแล้ว';
        } catch (err) { save.disabled = false; save.textContent = '💾 บันทึกลงอัลบั้ม'; addBubble('error', err.message); }
      });
      wrap.append(im, save); bubble.appendChild(wrap);
    });
  }
  function appendPhotoStrip(bubble, ids) {
    const strip = document.createElement('div'); strip.className = 'photos';
    ids.forEach((id) => {
      const im = document.createElement('img'); im.loading = 'lazy'; im.alt = 'รูปจากอัลบั้ม'; im.src = '/api/album/' + id + '/thumb';
      im.addEventListener('click', () => openPhotoLightbox(id));
      im.addEventListener('load', scrollToBottom);
      im.addEventListener('error', () => im.remove());   // รูปถูกลบไปแล้ว → ซ่อนเงียบๆ
      strip.appendChild(im);
    });
    bubble.appendChild(strip);
  }
  // ---------- สิ่งที่เลขาสรุปว่าเจ้าของสอน (ให้เจ้าของกดยืนยัน/ไม่ใช่) ----------
  const shownProposals = new Set();
  function showProposals(list) {
    (list || []).forEach((p) => {
      if (shownProposals.has(p.id)) return;
      shownProposals.add(p.id);
      const card = document.createElement('div');
      card.className = 'proposal-card';
      const t = document.createElement('div');
      t.className = 'pp-text';
      t.textContent = '💡 เลขาสรุปว่าคุณสอนไว้: ' + p.content;
      const row = document.createElement('div');
      row.className = 'pp-row';
      const decide = async (accept) => {
        row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
          await api('POST', '/api/chat/proposals/' + p.id + '/decide', { accept });
          card.className = 'chip-saved';
          card.textContent = accept ? '✓ เลขาจำไว้แล้ว ในหมวด "ความสามารถเลขา"' : 'ไม่จำข้อนี้';
        } catch (err) { card.remove(); }
      };
      const yes = document.createElement('button'); yes.type = 'button'; yes.textContent = '✓ จำไว้'; yes.addEventListener('click', () => decide(true));
      const no = document.createElement('button'); no.type = 'button'; no.className = 'pp-no'; no.textContent = '✕ ไม่ใช่'; no.addEventListener('click', () => decide(false));
      row.appendChild(yes); row.appendChild(no);
      card.appendChild(t); card.appendChild(row);
      logEl.appendChild(card);
      scrollToBottom();
    });
  }
  async function fetchProposals() {
    try { showProposals((await api('GET', '/api/chat/proposals')).proposals); } catch (e) { /* ไม่มีก็ข้าม */ }
  }

  // ---------- เลือกหัวข้อ: คุยต่อ/อัปเดตข้อมูลในหมวดนั้น ----------
  function setFocus(name) {
    focusCategory = name || '';
    $('focusBar').hidden = !focusCategory;
    $('focusText').textContent = focusCategory ? '📂 กำลังคุยต่อ/อัปเดตในหมวด: ' + focusCategory : '';
    updateTopic();
  }
  $('focusEnd').addEventListener('click', () => { setFocus(''); addBubble('assistant', 'เลิกคุยในหมวดนั้นแล้วค่ะ คุยเรื่องอื่นได้เลย'); });

  // ---------- กลับเข้าแอป: ถามเรื่องที่คุยค้างไว้ ครั้งเดียว (ผู้ใช้ตั้งเองได้ว่า ถามก่อน/บันทึกเอง/ไม่ถาม) ----------
  async function checkOrganize() {
    try {
      await fetchProposals();
      const r = await api('GET', '/api/chat/organize/pending');
      const c = r.conversation;
      if (!c) return;
      const doOrganize = async (auto) => {
        const res = await api('POST', '/api/chat/conversations/' + c.id + '/organize', { auto: !!auto });
        (res.saved || []).forEach((m) => addSavedChip(m.category));
        if (res.saved && res.saved.length) addBubble('assistant', 'เลขาสรุปเรื่องที่คุยค้างไว้และจัดเข้าหมวดให้แล้ว ' + res.saved.length + ' รายการค่ะ');
        else if (res.proposals && res.proposals.length) { addBubble('assistant', 'เลขาสรุปเรื่องที่คุยค้างไว้แยกตามหมวดแล้วค่ะ ดูแล้วกด จำไว้ / ไม่ใช่ ได้เลย'); showProposals(res.proposals); }
        else addBubble('assistant', 'ดูแล้วยังไม่มีอะไรใหม่ที่ต้องเก็บเพิ่มค่ะ');
      };
      if (r.mode === 'auto') { await doOrganize(true); return; }
      const card = document.createElement('div');
      card.className = 'proposal-card';
      const t = document.createElement('div');
      t.className = 'pp-text';
      t.textContent = '🗂️ คราวก่อนเราคุยกัน ' + c.userMsgs + ' ข้อความ' + (c.title ? ' เรื่อง "' + c.title + '"' : '') + ' ยังไม่ได้เก็บแยกหมวด ให้เลขาสรุปแล้วเก็บเข้าหมวดให้ไหมคะ';
      const row = document.createElement('div');
      row.className = 'pp-row';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', async () => { row.querySelectorAll('button').forEach((x) => { x.disabled = true; }); card.remove(); try { await fn(); } catch (e) { addBubble('error', e.message); } }); row.appendChild(b); };
      mk('✓ ให้สรุป', '', () => doOrganize(false));
      mk('ไว้ก่อน', 'pp-no', () => api('POST', '/api/chat/conversations/' + c.id + '/organize/dismiss', {}));
      mk('ไม่ต้องถามอีก', 'pp-no', () => api('POST', '/api/chat/conversations/' + c.id + '/organize/dismiss', { never: true }));
      card.appendChild(t); card.appendChild(row);
      logEl.appendChild(card);
      scrollToBottom();
    } catch (e) { /* ถามไม่ได้ก็ข้าม ไม่กระทบการใช้งาน */ }
  }
  function addSavedChip(category) {
    const chip = document.createElement('div');
    chip.className = 'chip-saved';
    chip.textContent = '✓ จำไว้แล้ว ในหมวด "' + category + '"';
    logEl.appendChild(chip);
    scrollToBottom();
  }
  // ปุ่ม "เปิดในเบราว์เซอร์" — ใช้เมื่อฟีเจอร์เสียง/ไมค์ใช้ในเบราว์เซอร์ของไลน์ไม่ได้
  async function openExternal(next) {
    try {
      // ขอลิงก์เข้าสู่ระบบครั้งเดียว (อายุ 2 นาที) เพื่อให้ Chrome เข้าบัญชีเดียวกันทันที ไม่ต้องกรอก PIN ซ้ำ
      const { url } = await api('POST', '/api/auth/login-link');
      window.liff.openWindow({ url: next === 'voice' ? url + '&next=voice' : url, external: true });
    } catch (e) { addBubble('error', 'เปิดอัตโนมัติไม่ได้ — คัดลอกลิงก์ ' + location.origin + ' ไปวางใน Chrome เองได้ค่ะ'); }
  }
  function addBrowserButton() {
    if (!inLine) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'open-ext';
    b.textContent = '🌐 เปิดในเบราว์เซอร์ (Chrome)';
    b.addEventListener('click', () => openExternal());
    logEl.appendChild(b);
    scrollToBottom();
  }
  function scrollToBottom() { logEl.scrollTop = logEl.scrollHeight; }

  function showHint() {
    addBubble('hint', 'สวัสดีค่ะ ' + (me.callName || 'คุณ' + me.name) + ' มีอะไรให้' + me.secretaryName + 'ช่วยไหมคะ\nพิมพ์ หรือกดไมค์🎤 แล้วพูดได้เลย เช่น "จำไว้ในหมวดฟาร์ม ว่าบ่อ 2 ปล่อยกุ้งวันที่ 5"');
  }

  async function openConversation(id) {
    conversationId = id;
    logEl.textContent = '';
    closeSheet();
    try {
      const { messages, conversation } = await api('GET', '/api/chat/conversations/' + id + '/messages');
      convTitle = (conversation && conversation.title) || '';
      updateTopic();
      if (!messages.length) showHint();
      messages.forEach((m) => { if (m.role !== 'system') addBubble(m.role, m.content); });
    } catch (err) {
      addBubble('error', err.message);
    }
  }

  async function newConversation() {
    const { conversation } = await api('POST', '/api/chat/conversations', {});
    await openConversation(conversation.id);
  }

  async function enterChat(user) {
    me = user;
    authPage.hidden = true;
    authView.hidden = true;
    appEl.hidden = false;
    document.body.classList.remove('auth-mode');
    setBotState('idle');
    renderAvatar();
    refreshConnectBadge();
    pollDue();
    if (new URLSearchParams(location.search).get('mode') === 'voice') { history.replaceState(null, '', '/'); enterVoiceMode(true); }
    try {
      const { conversations } = await api('GET', '/api/chat/conversations');
      if (conversations.length) await openConversation(conversations[0].id);
      else await newConversation();
      refreshGroupsBadge();   // ป้ายแจ้งจำนวนคำขอเข้าร่วมกลุ่มที่รอผู้สร้างอนุญาต + ข้อความกลุ่มที่ยังไม่อ่าน
      refreshRuleSuggestion();   // ของค้างตอนเปิดแอป → ข้อความสีเทาในช่องพิมพ์
      loadPremiumInfo();   // สิทธิ์เสียงพรีเมียม (ถ้าผู้ใช้เลือกโหมดพรีเมียมไว้)
      checkOrganize();   // กลับเข้าแอป: มีข้อเสนอรอยืนยัน/บทสนทนาที่ยังไม่ได้สรุปแยกหมวดไหม (ถามครั้งเดียว)
    } catch (err) {
      addBubble('error', err.message);
    }
  }

  // ---------- ติดตั้งไอคอนแอปบนหน้าจอหลักมือถือ (PWA) ----------
  let deferredInstall = null;
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
  window.addEventListener('appinstalled', () => { deferredInstall = null; addBubble('hint', 'ติดตั้งไอคอนบนหน้าจอหลักแล้วค่ะ 🎉 เปิดจากไอคอนได้เลย (กดค้างที่ไอคอนมีทางลัด "คุยด้วยเสียง")'); });
  if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* ติดตั้งไม่ได้ก็ใช้เว็บปกติต่อได้ */ }); }); }

  async function installApp() {
    closeSheet();
    if (isStandalone()) { addBubble('hint', 'แอปนี้ติดตั้งบนหน้าจอหลักอยู่แล้วค่ะ'); return; }
    if (deferredInstall) {
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
      deferredInstall = null;
      return;
    }
    if (inLine) {
      addBubble('hint', 'เบราว์เซอร์ในไลน์ติดตั้งไอคอนไม่ได้ค่ะ — กดปุ่มด้านล่างเพื่อเปิดใน Chrome แล้วเลือกเมนู 📲 ติดตั้งไอคอน อีกครั้ง');
      addBrowserButton();
      return;
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) { addBubble('hint', 'iPhone: เปิดด้วย Safari แล้วกดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรขึ้น) → "เพิ่มไปยังหน้าจอโฮม"'); return; }
    addBubble('hint', 'Android: กดเมนู ⋮ ของ Chrome (มุมขวาบน) → "เพิ่มลงในหน้าจอหลัก" หรือ "ติดตั้งแอป" แล้วกด "ติดตั้ง"\nติดตั้งแล้วจะมีไอคอน "เลขา" บนหน้าจอหลัก กดค้างที่ไอคอนมีทางลัด "คุยด้วยเสียง"');
  }

  // ---------- แนบรูป / ไฟล์ / ลิงก์ให้เลขาอ่าน ----------
  const MAX_FILES = 4;
  const MAX_RAW_BYTES = 3.5 * 1024 * 1024;
  const FILE_TYPES = { pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json' };
  let pendingFiles = [];   // { name, mime, data(base64) }

  function renderTray() {
    const tray = $('attachTray');
    tray.textContent = '';
    tray.hidden = !pendingFiles.length;
    if (typeof renderSuggestion === "function") renderSuggestion();
    const va = $('vAttach'); va.textContent = ''; va.hidden = !pendingFiles.length;
    pendingFiles.forEach((f, i) => {
      const chip = document.createElement('div'); chip.className = 'chip-att';
      const t = document.createElement('span'); t.textContent = (f.mime.startsWith('image/') ? '🖼️ ' : f.mime === 'application/pdf' ? '📕 ' : '📄 ') + f.name;
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'เอาออก');
      x.addEventListener('click', () => { pendingFiles.splice(i, 1); renderTray(); });
      chip.append(t, x); va.appendChild(chip);
    });
    if (pendingFiles.length) { const h = document.createElement('div'); h.className = 'v-attach-hint'; h.textContent = 'แนบแล้ว — พูดถามเลขาได้เลย'; va.appendChild(h); }
    pendingFiles.forEach((f, i) => {
      const chip = document.createElement('div'); chip.className = 'chip-att';
      const t = document.createElement('span'); t.textContent = (f.mime.startsWith('image/') ? '🖼️ ' : f.mime === 'application/pdf' ? '📕 ' : '📄 ') + f.name;
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'เอาออก');
      x.addEventListener('click', () => { pendingFiles.splice(i, 1); renderTray(); });
      chip.append(t, x); tray.appendChild(chip);
    });
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
      r.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    for (const file of fileList) {
      if (pendingFiles.length >= MAX_FILES) { addBubble('error', 'แนบได้สูงสุด ' + MAX_FILES + ' ไฟล์ต่อข้อความค่ะ'); break; }
      try {
        if (file.type.startsWith('image/')) {
          const data = await fileToJpegBase64(file, 1600);          // ย่อรูปก่อนส่ง ประหยัดเน็ตและค่าอ่านรูป
          pendingFiles.push({ name: file.name || 'รูปภาพ', mime: 'image/jpeg', data });
        } else {
          const ext = (file.name.split('.').pop() || '').toLowerCase();
          const mime = FILE_TYPES[ext];
          if (!mime) throw new Error('ไฟล์ "' + file.name + '" ชนิดที่ยังไม่รองรับ (รองรับ รูปภาพ, PDF, txt, csv, md, json)');
          if (file.size > MAX_RAW_BYTES) throw new Error('ไฟล์ "' + file.name + '" ใหญ่เกินไป (ไม่เกินประมาณ 3.5 MB)');
          pendingFiles.push({ name: file.name, mime, data: await readFileBase64(file) });
        }
      } catch (err) { addBubble('error', err.message); }
    }
    renderTray();
  }

  function pickFiles(accept, multiple) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.addEventListener('change', () => { closeSheet(); if (inp.files && inp.files.length) addFiles([...inp.files]); });
    inp.click();
  }

  $('plusBtn').addEventListener('click', () => {
    const body = openSheet('แนบให้เลขาอ่าน');
    note(body, 'แนบได้สูงสุด ' + MAX_FILES + ' ไฟล์ต่อข้อความ แล้วพิมพ์บอกเลขาว่าอยากให้ทำอะไร เช่น "สรุปให้หน่อย" หรือ "จำไว้ในหมวดฟาร์ม"');
    if (connected) note(body, '⚠️ ตอนนี้อยู่ในโหมดใช้ข้อมูลของคนอื่น แนบไฟล์ไม่ได้ — กด "จบการใช้ข้อมูล" ก่อน');
    sheetButton(body, '📷 รูปภาพ (ถ่ายรูป / เลือกจากเครื่อง)', () => pickFiles('image/*', true));
    sheetButton(body, '📄 ไฟล์ (PDF / txt / csv / md / json)', () => pickFiles('.pdf,.txt,.csv,.md,.json,application/pdf,text/plain,text/csv,text/markdown,application/json', true));
    note(body, 'หรือวางลิงก์เว็บ — เลขาจะเปิดอ่านหน้าเว็บให้ (ใช้ได้เฉพาะหน้าที่เปิดสาธารณะ ไม่ต้องล็อกอิน)', 'sub');
    const url = document.createElement('input'); url.type = 'url'; url.placeholder = 'https://...'; body.appendChild(url);
    const status = note(body, '');
    sheetButton(body, '🔗 ใส่ลิงก์ในข้อความ', () => {
      const v = url.value.trim();
      if (!/^https?:\/\/\S+$/i.test(v)) { status.textContent = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://'; return; }
      inputEl.value = (inputEl.value ? inputEl.value.trim() + ' ' : '') + v + ' ';
      closeSheet(); inputEl.focus();
    });
  });

  // ---------- กล้อง "ถ่ายแล้วถาม": เปิดกล้องในหน้าแอป ถ่ายรูป → แนบเป็นไฟล์แนบ → พิมพ์/พูดถามเลขาต่อ (รูปไม่ถูกเก็บถ้าไม่บันทึกลงอัลบั้มเอง) ----------
  // กล้องหลังเป็นค่าเริ่มต้น (ถ่ายของรอบตัว) สลับหน้า/หลังได้ • เปิดกล้องไม่ได้ (ไม่อนุญาต/ไม่มีกล้อง/เบราว์เซอร์ในไลน์) → ถอยไปใช้ช่องเลือกรูป/ถ่ายรูปของเครื่อง
  let camStream = null;
  function stopCam() { if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; } const ov = document.getElementById('camOverlay'); if (ov) ov.remove(); }
  function camFallback() { pickFiles('image/*', false); }
  async function openCamera() {
    if (connected) { addBubble('error', 'โหมดใช้ข้อมูลของคนอื่นแนบรูปไม่ได้ — กด "จบการใช้ข้อมูล" ก่อนค่ะ'); return; }
    if (pendingFiles.length >= MAX_FILES) { addBubble('error', 'แนบได้สูงสุด ' + MAX_FILES + ' ไฟล์ต่อข้อความค่ะ'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camFallback(); return; }
    stopCam();
    let facing = 'environment';
    const ov = document.createElement('div'); ov.id = 'camOverlay';
    const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.setAttribute('playsinline', '');
    const bar = document.createElement('div'); bar.className = 'cam-bar';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '✕ ปิด';
    const snap = document.createElement('button'); snap.type = 'button'; snap.className = 'cam-snap'; snap.setAttribute('aria-label', 'ถ่ายรูป'); snap.textContent = '●';
    const flip = document.createElement('button'); flip.type = 'button'; flip.textContent = '🔄 สลับกล้อง';
    const hint = document.createElement('div'); hint.className = 'cam-hint'; hint.textContent = 'ส่องไปที่สิ่งที่อยากถาม แล้วกดปุ่มกลมเพื่อถ่าย';
    bar.append(cancel, snap, flip); ov.append(hint, video, bar); document.body.appendChild(ov);
    const start = async () => {
      if (camStream) camStream.getTracks().forEach((t) => t.stop());
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1600 } }, audio: false });
      video.srcObject = camStream;
    };
    try { await start(); } catch (err) { stopCam(); addBubble('hint', 'เปิดกล้องในแอปไม่ได้ (อาจยังไม่ได้อนุญาตกล้อง) — ใช้ช่องถ่ายรูปของเครื่องแทนนะคะ'); camFallback(); return; }
    cancel.addEventListener('click', stopCam);
    flip.addEventListener('click', async () => { facing = facing === 'environment' ? 'user' : 'environment'; try { await start(); } catch (e) { hint.textContent = 'สลับกล้องไม่ได้'; } });
    snap.addEventListener('click', () => {
      if (!video.videoWidth) return;
      const cv = document.createElement('canvas'); cv.width = video.videoWidth; cv.height = video.videoHeight;
      cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
      cv.toBlob(async (blob) => {
        stopCam();
        if (!blob) { addBubble('error', 'ถ่ายรูปไม่สำเร็จ ลองใหม่อีกครั้งค่ะ'); return; }
        await addFiles([new File([blob], 'ภาพจากกล้อง.jpg', { type: 'image/jpeg' })]);
        if (voiceMode) {   // หน้าสนทนาเสียง: ถ่ายเสร็จส่งเข้าห้องสนทนาให้เลขาดูทันที (ไม่ต้องพิมพ์/พูดซ้ำ) ถ้าอยากถามเฉพาะเรื่อง ค่อยพูดต่อรอบถัดไป
          if (!sending) { stopRecording(true); cancelSpeech(); await send('ช่วยดูรูปนี้ให้หน่อย บอกว่าเห็นอะไร', 'voice'); }
        } else { inputEl.placeholder = 'พิมพ์ถามเลขาเกี่ยวกับรูปนี้ หรือกดส่งเลย...'; inputEl.focus(); }
      }, 'image/jpeg', 0.88);
    });
  }
  $('camBtn').addEventListener('click', openCamera);
  $('vCam').addEventListener('click', openCamera);          // ปุ่มกล้องในหน้าสนทนาเสียง (ถ่ายแล้วพูดถามได้เลย)
  $('vPlus').addEventListener('click', () => $('plusBtn').click());   // ปุ่ม + ในหน้าสนทนาเสียง (แนบรูป/ไฟล์/ลิงก์)

  // ---------- ส่งข้อความ ----------
  // ---------- คำแนะนำข้อความถัดไปจากเลขา (ตัวหนังสือสีเทาในช่องพิมพ์ + ปุ่มส่งเปลี่ยนสี) ----------
  // ช่องว่าง + มีคำแนะนำ: ปุ่มส่งเป็นสีส้ม กดแล้วส่งข้อความสีเทา (หรือกด Tab เพื่อเติมลงช่องไปแก้ต่อ)
  // พิมพ์ข้อความเองแล้ว: ข้อความสีเทาหาย ปุ่มส่งกลับเป็นสีปกติ
  const DEFAULT_PLACEHOLDER = 'พิมพ์ข้อความ...';
  let suggestion = null;   // { id, text, kind }
  function renderSuggestion() {
    const usable = !!suggestion && !!suggestion.text;
    inputEl.placeholder = usable ? suggestion.text : DEFAULT_PLACEHOLDER;
    const showing = usable && !inputEl.value.trim() && !pendingFiles.length;
    sendBtn.classList.toggle('suggest', showing);
    sendBtn.title = showing ? 'ส่งข้อความที่เลขาแนะนำ' : '';
    sendBtn.setAttribute('aria-label', showing ? 'ส่งข้อความที่เลขาแนะนำ' : 'ส่ง');
  }
  function setSuggestion(s) { suggestion = s && s.text ? s : null; renderSuggestion(); }
  inputEl.addEventListener('input', renderSuggestion);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && suggestion && !inputEl.value) { e.preventDefault(); inputEl.value = suggestion.text; renderSuggestion(); }   // เติมลงช่องไปแก้ต่อได้
  });
  // ของค้างตอนเปิดแอป/กลับมาที่แอป (คำขอรออนุมัติ ข้อความกลุ่มที่ยังไม่อ่าน ฯลฯ) — ระบบเลือกเอง ไม่เรียก AI
  async function refreshRuleSuggestion() {
    if (!me || appEl.hidden || sending || document.hidden) return;
    if (suggestion && suggestion.kind === 'ai') return;   // ไม่ทับคำแนะนำที่เลขาเพิ่งให้มากับคำตอบ
    if (inputEl.value.trim()) return;
    try { const r = await api('GET', '/api/chat/suggestion'); setSuggestion(r.suggestion); } catch (e) { /* ไม่มีก็ข้าม */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshRuleSuggestion(); refreshGroupsBadge(); } });
  setInterval(() => { if (me && !appEl.hidden && !document.hidden) { refreshRuleSuggestion(); refreshGroupsBadge(); } }, 60000);

  async function send(text, source, suggestionId) {
    text = (text || '').trim();
    if ((!text && !pendingFiles.length) || sending || !conversationId) return false;
    if (connected && pendingFiles.length) { addBubble('error', 'โหมดใช้ข้อมูลของคนอื่นแนบไฟล์ไม่ได้ — กด "จบการใช้ข้อมูล" ก่อน หรือเอาไฟล์ออกค่ะ'); return false; }
    const files = pendingFiles.slice();
    if (!text) text = 'ช่วยอ่านสิ่งที่แนบให้หน่อย';
    sending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    const prevSuggestion = suggestion;
    setSuggestion(null);   // ข้อความสีเทาหายระหว่างเลขากำลังคิด
    cancelSpeech();
    addBubble('user', text + (files.length ? '\n📎 ' + files.map((f) => f.name).join(', ') : ''));
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.textContent = me.secretaryName + ' กำลังพิมพ์...';
    logEl.appendChild(typing);
    scrollToBottom();
    if (voiceMode) vCaption(text, '');
    setBotState('thinking');
    let replyText = null;
    try {
      const { reply, photos, generated, suggestion: nextSuggestion, savedMemories, createdEvents, profile } = await api('POST', '/api/chat/conversations/' + conversationId + '/messages', { content: text, source: source || 'text', askRequestId: connected ? connected.requestId : undefined, attachments: files.length ? files : undefined, premiumVoice: (premiumActive() && (ttsOn || realtime)) ? true : undefined, focusCategory: focusCategory || undefined, suggestionId: suggestionId || undefined });
      typing.remove();
      const replyBubble = addBubble('assistant', reply);
      if (photos && photos.length) appendPhotoStrip(replyBubble, photos);   // รูปที่เลขาดึงจากอัลบั้มมาให้ดู
      if (generated && generated.length) appendGeneratedImages(replyBubble, generated);   // ภาพที่เลขาเพิ่งวาดให้
      if (voiceMode && ((generated && generated.length) || (photos && photos.length))) {   // หน้าสนทนาเสียง: แสดงภาพที่เลขาวาด/ดึงจากอัลบั้มไว้ตรงนี้ด้วย ไม่ต้องย้อนไปดูหน้าแชทหลัก
        const box = $('vGen'); box.textContent = '';
        if (generated && generated.length) appendGeneratedImages(box, generated);
        if (photos && photos.length) appendPhotoStrip(box, photos);
        $('vCaption').classList.add('has-img');
        box.querySelectorAll('img').forEach((im) => im.addEventListener('load', () => box.scrollIntoView({ block: 'nearest' })));
      }
      (savedMemories || []).forEach((m) => addSavedChip(m.category));
      (createdEvents || []).forEach(addEventChip);
      // (ข้อเสนอให้จำ/สรุปแยกหมวด จะถามตอนกลับเข้าแอป ไม่โผล่กลางบทสนทนา — ไม่ให้ดูซ้ำซาก)
      if (!convTitle) convTitle = text.slice(0, 50);   // เซิร์ฟเวอร์ตั้งชื่อหัวข้อจากข้อความแรกเหมือนกัน
      updateTopic();
      if (profile) { if (profile.secretaryName) me.secretaryName = profile.secretaryName; if (profile.callName !== undefined) me.callName = profile.callName; renderAiBadge(); }   // ผู้ใช้เพิ่งตั้งชื่อเลขา/ชื่อที่ให้เรียก
      replyText = reply;
      if (!connected) setSuggestion(nextSuggestion);   // คำแนะนำข้อความถัดไปมากับคำตอบ (โหมดใช้ข้อมูลคนอื่นไม่มี)
      if (voiceMode) vCaption(null, reply);
      if (files.length) { pendingFiles = []; renderTray(); }
    } catch (err) {
      typing.remove();
      addBubble('error', err.message);
      if (voiceMode) vCaption(null, err.message);
      if (connected && /หมดเวลา|ถอนสิทธิ์|ปิดรับ|ปิดการอนุญาต|ไม่ได้รับอนุมัติ/.test(err.message)) endConnected(true);
      if (source !== 'voice') inputEl.value = text;
      setSuggestion(prevSuggestion);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      renderSuggestion();
    }
    if (replyText && (ttsOn || realtime)) {
      speak(replyText, afterSpeech);
    } else {
      setBotState('idle');
      afterSpeech();
    }
    return true;
  }

  // พูดจบ (หรือไม่ได้พูด) แล้ว ถ้าอยู่โหมดเรียลไทม์ให้กลับไปฟังต่อเอง
  function afterSpeech() {
    setBotState('idle');
    if (realtime && me && !appEl.hidden) startListening();
  }

  $('inputBar').addEventListener('submit', (e) => {
    e.preventDefault();
    // ช่องว่างแต่มีข้อความสีเทา = ส่งคำแนะนำของเลขา (บันทึกว่าผู้ใช้กดรับ)
    if (!inputEl.value.trim() && suggestion && !pendingFiles.length) { send(suggestion.text, 'text', suggestion.id); return; }
    send(inputEl.value, 'text');
  });

  // ---------- เสียงพูดของเลขา (TTS) ----------
  let ttsOn = false;
  try { ttsOn = localStorage.getItem('aq_tts') === '1'; } catch (e) { /* ignore */ }
  const ttsSupported = 'speechSynthesis' in window;
  function renderTts() {
    const b = $('ttsToggle');
    b.textContent = (ttsOn ? '🔊' : '🔇') + ' เลขาเสียง';
    b.classList.toggle('on', ttsOn);
  }
  $('ttsToggle').addEventListener('click', () => {
    if (!ttsSupported) {
      addBubble('error', 'เบราว์เซอร์ในไลน์ไม่รองรับเสียงอ่านออกเสียง — กดปุ่มด้านล่างเพื่อเปิดในเบราว์เซอร์ปกติ (ต้องเข้าสู่ระบบด้วยเบอร์ + PIN อีกครั้ง) จะใช้เสียงได้ค่ะ');
      addBrowserButton();
      return;
    }
    ttsOn = !ttsOn;
    try { localStorage.setItem('aq_tts', ttsOn ? '1' : '0'); } catch (e) { /* ignore */ }
    renderTts();
    if (!ttsOn) { cancelSpeech(); addBubble('hint', 'ปิดเสียงเลขาแล้วค่ะ'); return; }
    // ลองพูดทดสอบเลย ให้ผู้ใช้รู้ทันทีว่าเครื่องมีเสียงไทยและเปิดเสียงมีเดียอยู่หรือไม่
    addBubble('hint', 'เปิดเสียงเลขาแล้วค่ะ (ถ้าไม่ได้ยิน ลองเพิ่มเสียงมีเดียของเครื่อง หรือเปิดในเบราว์เซอร์ปกติ)');
    try { speak('เปิดเสียงเลขาแล้วค่ะ', () => setBotState('idle')); } catch (e) { /* ignore */ }
  });
  renderTts();

  let speechToken = 0;
  function unlockSpeech() { // มือถือบางเครื่องต้องให้ผู้ใช้แตะก่อนถึงจะพูดได้ (ทั้งเสียงเบราว์เซอร์และเสียงพรีเมียมที่เล่นผ่าน <audio>)
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch (e) { /* ignore */ }
    try { if (!premAudio.src) { premAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; premAudio.play().catch(() => {}); } } catch (e) { /* ignore */ }
  }
  function cancelSpeech() {
    speechToken++;
    stopPremium();
    if (ttsSupported) window.speechSynthesis.cancel();
  }
  // การเตรียมข้อความก่อนอ่านออกเสียง (ทศนิยม "0.25" → "0 จุด 25", เดือนย่อ "พ.ย." → "พฤศจิกายน", ตัด markdown/อีโมจิ)
  // อยู่ที่ speech.js (ไฟล์เดียวกับที่ชุดทดสอบใช้)
  const cleanForSpeech = (t) => window.aqSpeech.forSpeech(t);
  const chunkText = (t) => window.aqSpeech.chunkText(t);
  // ---------- เสียงเลขาพรีเมียม (Gemini TTS) — แอดมินเปิดสิทธิ์รายคน มีโควตาฟรีต่อเดือน เกินแล้วหักเครดิต ----------
  // เลือกโหมดได้ที่ป๊อปอัป "ตั้งค่าเสียง" (แตะรูปเลขา AI) • เกิดข้อผิดพลาดอะไรก็ถอยกลับไปใช้เสียงเบราว์เซอร์ทันที ไม่ให้เสียงเงียบ
  let premiumChoice = 'browser';
  try { if (localStorage.getItem('aq_voice_mode') === 'premium') premiumChoice = 'premium'; } catch (e) { /* ignore */ }
  let premiumInfo = null;          // ผลจาก GET /api/chat/tts/status
  let premiumBlockedUntil = 0;     // ขอไม่ได้ (งบหมด/โควตาหมด) → พักไม่ขอซ้ำช่วงสั้นๆ
  const premAudio = new Audio();
  async function loadPremiumInfo() {
    try { premiumInfo = await api('GET', '/api/chat/tts/status'); } catch (e) { premiumInfo = null; }
    renderVoiceMeter();
    return premiumInfo;
  }
  const premiumActive = () => premiumChoice === 'premium' && !!premiumInfo && !!premiumInfo.available && Date.now() > premiumBlockedUntil;
  // แถบโควตาเสียง AI (มุมขวาล่างของหน้าหลัก ฝั่งตรงข้ามปุ่มสัมมนา/ประชุม) + ป้าย "✨ พรีเมียม" ที่โปรไฟล์เลขาเมื่อกำลังใช้เสียงพรีเมียม
  function renderVoiceMeter() {
    const box = $('voiceMeter');
    const badge = document.querySelector('#aiBadge .aipremium');
    const p = premiumInfo;
    if (badge) badge.hidden = !(premiumChoice === 'premium' && p && p.available);
    if (!box) return;
    if (!p || !p.allowed) { box.hidden = true; box.textContent = ''; return; }   // ยังไม่มีสิทธิ์ → ไม่โชว์แถบ
    const total = Number(p.freeSecondsTotal) || 0;
    const left = Math.max(0, Number(p.freeSecondsLeft) || 0);
    const m = (s) => Math.round((s / 60) * 10) / 10;
    const ratio = total > 0 ? (total - left) / total : 1;
    const text = !p.budgetOk ? 'งบเต็ม' : left <= 0 ? 'ใช้เครดิต' : m(total - left) + ' / ' + m(total) + ' นาที';
    box.textContent = '';
    box.appendChild(meterRow('✨ โควต้าเสียง AI', text, !p.budgetOk ? 1 : ratio, () => { if (window.aqTick) window.aqTick.open(); }, premiumChoice !== 'premium'));
    box.hidden = false;
  }
  async function fetchPremiumAudio(text) {
    const r = await fetch('/api/chat/tts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!r.ok) {
      let j = {}; try { j = await r.json(); } catch (e) { /* ไม่มี body */ }
      const err = new Error(j.error || 'เสียงพรีเมียมใช้ไม่ได้'); err.code = j.code || 'upstream'; throw err;
    }
    const left = r.headers.get('x-tts-free-left');
    if (premiumInfo && left !== null) { premiumInfo.freeSecondsLeft = Number(left); renderVoiceMeter(); }
    return r.blob();
  }
  function stopPremium() { try { premAudio.pause(); premAudio.removeAttribute('src'); premAudio.load(); } catch (e) { /* ignore */ } }
  // เล่นเสียงพรีเมียมทีละท่อน (ท่อนถัดไปขอล่วงหน้าระหว่างที่ท่อนนี้เล่น) — คืนจริงเมื่อเล่นจบ, โยน error ถ้าท่อนแรกใช้ไม่ได้
  const premiumIsMale = () => !!premiumInfo && !!premiumInfo.voiceOptions && premiumInfo.voiceOptions.male.some((v) => v.id === premiumInfo.voice);
  function speakPremium(text, done) {
    if (premiumIsMale()) text = window.aqSpeech.forMaleVoice(text);   // เสียงชาย → ค่ะ/คะ อ่านเป็นครับ (เฉพาะตอนอ่านออกเสียง ข้อความบนจอไม่เปลี่ยน)
    // แบ่งท่อนแบบ "ท่อนแรกสั้นมาก ท่อนถัดไปค่อยๆ ยาวขึ้น" (≈40, 80, 170, 350 ตัวอักษร): เสียงเริ่มดังเร็ว (สร้างเสียงใช้เวลาประมาณเท่าความยาวเสียง)
    // แล้วขอทุกท่อนพร้อมกันตั้งแต่แรก ท่อนถัดไปจึงเสร็จทันตอนท่อนก่อนหน้าเล่นจบ (ไม่เว้นช่วงเงียบกลางประโยค)
    const words = chunkText(cleanForSpeech(text)).join(' ').split(/\s+/).filter(Boolean);
    const LIMITS = [40, 80, 170, 350];
    const chunks = [];
    let cur = '';
    words.forEach((w) => {
      const lim = LIMITS[Math.min(chunks.length, LIMITS.length - 1)];
      if (cur && (cur + ' ' + w).length > lim) { chunks.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) chunks.push(cur);
    if (!chunks.length) { done && done(); return; }
    const myToken = ++speechToken;
    // ระหว่างรอเสียงท่อนแรก ให้ยังเป็นสถานะ "กำลังคิด" (เสียงติ๊กๆ ไม่หยุด) จนกว่าเสียงจะเริ่มดังจริงค่อยเป็น "กำลังพูด"
    setBotState('thinking');
    let i = 0;
    const fetches = chunks.map((c) => { const p = fetchPremiumAudio(c); p.catch(() => { /* จัดการตอนถึงท่อนนั้น */ }); return p; });
    const fallback = (err) => {
      if (myToken !== speechToken) return;
      const first = i <= 1;
      if (err && ['budget', 'no_credit', 'not_allowed', 'rate'].includes(err.code)) premiumBlockedUntil = Date.now() + 5 * 60 * 1000;
      if (err && err.code === 'budget' && premiumInfo) premiumInfo.available = false;
      if (first && !premiumNoticeShown) { premiumNoticeShown = true; addBubble('hint', (err && err.message ? err.message : 'เสียงพรีเมียมใช้ไม่ได้') + ' — ใช้เสียงเบราว์เซอร์แทนค่ะ'); }
      if (first) speakBrowser(text, done); else done && done();
    };
    const playNext = async () => {
      if (myToken !== speechToken) return;
      if (i >= chunks.length) { done && done(); return; }
      const mine = fetches[i]; i++;
      let blob;
      try { blob = await mine; } catch (err) { fallback(err); return; }
      if (myToken !== speechToken) return;
      const url = URL.createObjectURL(blob);
      premAudio.onended = () => { URL.revokeObjectURL(url); playNext(); };
      premAudio.onerror = () => { URL.revokeObjectURL(url); fallback(new Error('เล่นเสียงไม่ได้')); };
      premAudio.src = url;
      try { await premAudio.play(); setBotState('speaking'); } catch (err) { URL.revokeObjectURL(url); fallback(new Error('เบราว์เซอร์ไม่ยอมเล่นเสียง (แตะหน้าจอแล้วลองใหม่)')); }
    };
    playNext();
  }
  let premiumNoticeShown = false;
  function speak(text, done) {
    if (premiumActive()) { speakPremium(text, done); return; }
    speakBrowser(text, done);
  }

  // ส่วน "เสียงที่เลขาใช้อ่านคำตอบ" ในป๊อปอัป ตั้งค่าเสียง (tick.js เรียกตอนเปิด)
  window.aqVoiceUi = (pop) => {
    const box = document.createElement('div'); box.className = 'tvoice';
    const hd = document.createElement('div'); hd.className = 'tvh'; hd.textContent = '🗣️ เสียงที่เลขาใช้อ่านคำตอบ';
    const optBrowser = document.createElement('button'); optBrowser.type = 'button'; optBrowser.className = 'topt';
    const optPrem = document.createElement('button'); optPrem.type = 'button'; optPrem.className = 'topt';
    const info = document.createElement('div'); info.className = 'tvi';
    const test = document.createElement('button'); test.type = 'button'; test.className = 'ttest'; test.textContent = '▶ ลองฟังเสียงพรีเมียม';
    // ลักษณะเสียงพรีเมียม: เลือกเสียง (หญิง/ชาย) + สไตล์การพูดแบบติ๊ก — แสดงเมื่อใช้เสียงพรีเมียมได้ บันทึกอัตโนมัติ
    const look = document.createElement('div'); look.className = 'tlook';
    const lh = document.createElement('div'); lh.className = 'tvh2'; lh.textContent = 'ลักษณะเสียงพรีเมียม';
    const voiceBox = document.createElement('div'); voiceBox.className = 'tchips';
    const styleHead = document.createElement('div'); styleHead.className = 'tvh2'; styleHead.textContent = 'สไตล์การพูด (ติ๊กได้) — ไม่ติ๊กเลย = มาตรฐาน';
    const styleBox = document.createElement('div'); styleBox.className = 'tstyles';
    const slowNote = document.createElement('div'); slowNote.className = 'tvi';
    look.append(lh, voiceBox, styleHead, styleBox, slowNote);
    box.append(hd, optBrowser, optPrem, info, look, test); pop.appendChild(box);
    let saveTimer = null;
    const saveLook = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { api('PUT', '/api/chat/tts/prefs', { voice: premiumInfo.prefs.voice, styles: premiumInfo.prefs.styles }).catch(() => { /* ไม่บันทึกก็ยังใช้ในเครื่องนี้ได้ */ }); }, 400);
    };
    const paintLook = () => {
      const p = premiumInfo;
      look.hidden = !(p && p.available && premiumChoice === 'premium');
      if (look.hidden) return;
      const cur = p.prefs.voice || p.voice;
      voiceBox.textContent = '';
      [['หญิง', p.voiceOptions.female], ['ชาย', p.voiceOptions.male]].forEach(([g, list]) => {
        const row = document.createElement('div'); row.className = 'tgrow';
        const gl = document.createElement('span'); gl.className = 'tg'; gl.textContent = g; row.appendChild(gl);
        list.forEach((v) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'tchip' + (cur === v.id ? ' on' : ''); b.textContent = (cur === v.id ? '☑ ' : '☐ ') + v.label;
          b.addEventListener('click', () => { p.prefs.voice = v.id; p.voice = v.id; paintLook(); saveLook(); });
          row.appendChild(b);
        });
        voiceBox.appendChild(row);
      });
      styleBox.textContent = '';
      const on = new Set(p.prefs.styles);
      p.styleOptions.forEach((s) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tchip' + (on.has(s.id) ? ' on' : ''); b.textContent = (on.has(s.id) ? '☑ ' : '☐ ') + s.label;
        b.addEventListener('click', () => {
          const next = new Set(p.prefs.styles);
          if (next.has(s.id)) next.delete(s.id); else { s.conflicts.forEach((c) => next.delete(c)); next.add(s.id); }   // ติ๊กคู่ที่ขัดกัน → ยกเลิกอันเดิมให้
          p.prefs.styles = p.styleOptions.map((x) => x.id).filter((id) => next.has(id));
          paintLook(); saveLook();
        });
        styleBox.appendChild(b);
      });
      slowNote.textContent = p.prefs.styles.includes('calm') ? '⏱️ สไตล์พูดช้าทำให้เสียงยาวขึ้น ใช้โควตาฟรีเร็วขึ้น' : '';
    };
    const mins = (s) => (Math.round((s / 60) * 10) / 10);
    const paint = () => {
      const p = premiumInfo;
      const can = !!p && !!p.available;
      optBrowser.textContent = (premiumChoice === 'browser' || !can ? '● ' : '○ ') + '🔊 เสียงเบราว์เซอร์ (ฟรี)';
      optBrowser.classList.toggle('on', premiumChoice === 'browser' || !can);
      optPrem.textContent = (premiumChoice === 'premium' && can ? '● ' : '○ ') + '✨ เสียงพรีเมียม (เสียงธรรมชาติ)';
      optPrem.classList.toggle('on', premiumChoice === 'premium' && can);
      optPrem.disabled = !can;
      test.hidden = !can;
      paintLook();
      if (!p) info.textContent = 'กำลังตรวจสอบสิทธิ์...';
      else if (!p.allowed) info.textContent = '🔒 เสียงพรีเมียมยังไม่เปิดให้บัญชีนี้ — ขอแอดมินเปิดสิทธิ์ให้ได้ (ตอนนี้ใช้เสียงเบราว์เซอร์)';
      else if (!p.budgetOk) info.textContent = 'งบเสียงพรีเมียมของระบบเดือนนี้เต็มแล้ว ใช้เสียงเบราว์เซอร์ไปก่อน (รีเซ็ตต้นเดือน)';
      else info.textContent = 'โควตาฟรีเดือนนี้เหลือ ' + mins(p.freeSecondsLeft) + ' นาที (จาก ' + mins(p.freeSecondsTotal) + ' นาที) • เกินแล้วหัก ' + p.creditsPerMinute + ' เครดิต/นาที (ตอนนี้มี ' + p.balance + ' เครดิต) • ถ้าใช้ไม่ได้ ระบบกลับไปใช้เสียงเบราว์เซอร์ให้เอง';
    };
    const choose = (v) => {
      premiumChoice = v;
      try { localStorage.setItem('aq_voice_mode', v); } catch (e) { /* ignore */ }
      premiumBlockedUntil = 0;
      paint();
      renderVoiceMeter();
    };
    optBrowser.addEventListener('click', () => choose('browser'));
    optPrem.addEventListener('click', () => { if (premiumInfo && premiumInfo.available) { choose('premium'); unlockSpeech(); } });
    test.addEventListener('click', async () => {
      unlockSpeech(); test.disabled = true;
      try {
        const sample = 'สวัสดีค่ะ น้อง' + ((me && me.secretaryName) || 'เลขา').replace(/^น้อง/, '') + 'พร้อมช่วยคุณแล้วนะคะ';
        const blob = await fetchPremiumAudio(premiumIsMale() ? window.aqSpeech.forMaleVoice(sample) : sample);
        const url = URL.createObjectURL(blob); premAudio.onended = () => URL.revokeObjectURL(url); premAudio.onerror = null; premAudio.src = url; await premAudio.play();
      } catch (err) { info.textContent = err.message; }
      await loadPremiumInfo(); paint(); test.disabled = false;
    });
    paint();
    loadPremiumInfo().then(paint);
  };

  function speakBrowser(text, done) {
    if (!ttsSupported) { done && done(); return; }
    const chunks = chunkText(cleanForSpeech(text));
    if (!chunks.length) { done && done(); return; }
    const myToken = ++speechToken;
    setBotState('speaking');
    let i = 0;
    const next = () => {
      if (myToken !== speechToken) return; // ถูกยกเลิก/มีอันใหม่แทนแล้ว
      if (i >= chunks.length) { done && done(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = 'th-TH';
      u.rate = 1.0;
      u.onend = next;
      u.onerror = next;
      window.speechSynthesis.speak(u);
    };
    next();
  }

  // ---------- ไมค์ (อัดเสียง → ถอดเป็นข้อความที่เซิร์ฟเวอร์ → ส่งให้เลขา) ----------
  let realtime = false;
  let rec = null;           // { stream, recorder, ctx, timer, cancelled }
  let wakeLock = null;

  async function lockScreen() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* ไม่รองรับก็ข้าม */ }
  }
  function unlockScreen() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }

  function renderMic() {
    $('micBtn').classList.toggle('rec', !!rec);
  }

  // ---------- หน้าสนทนาเสียงต่อเนื่อง (ปุ่มไมค์ข้างช่องพิมพ์) ----------
  // เปิดแล้วฟัง → ถอดเสียง → ถามเลขา → เลขาพูดตอบ → กลับมาฟังต่อเองวนไปเรื่อยๆ ไม่ต้องกดซ้ำ (เหมาะกับหูฟังบลูทูธ คุยยาวๆ)
  // เก็บสตรีมไมค์ไว้ใช้ซ้ำตลอดการสนทนา (ไม่ขอไมค์ใหม่ทุกประโยค — หูฟังบลูทูธจะไม่สลับโหมดเสียงไปมา)
  const IDLE_LIMIT = 6;      // ไม่มีใครพูดติดกัน 6 รอบ (~1 นาที) → หยุดฟังชั่วคราว แตะไมค์เพื่อคุยต่อ (ประหยัดแบตและค่าถอดเสียง)

  function vCaption(user, reply) {
    if (user !== null) { $('vUser').textContent = user; $('vGen').textContent = ''; $('vCaption').classList.remove('has-img'); }   // ข้อความผู้ใช้ใหม่ = ล้างภาพของรอบก่อน
    if (reply !== null) $('vReply').textContent = String(reply).replace(/[*_`#]/g, '');
  }

  async function enterVoiceMode(startPaused) {
    if (!me) return;
    // เปิดอยู่ในเบราว์เซอร์ของไลน์ (ไมค์/หน้าต่างลอยใช้ไม่ได้) → เด้งไปเปิดใน Chrome แล้วเข้าโหมดสนทนาเสียงต่อให้เลย
    if (inLine) { addBubble('assistant', 'กำลังเปิดใน Chrome เพื่อคุยด้วยเสียง…'); openExternal('voice'); return; }
    updateTopic();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      addBubble('error', 'เบราว์เซอร์นี้ยังอัดเสียงไม่ได้ — เปิดในเบราว์เซอร์ปกติ หรือพิมพ์แทนได้ค่ะ');
      addBrowserButton();
      return;
    }
    stopRecording(true); cancelSpeech();
    voiceMode = true; voicePaused = !!startPaused; idleCycles = 0; realtime = !startPaused;
    $('voiceScreen').hidden = false;
    vCaption('', '');
    if (ttsSupported || premiumActive()) unlockSpeech();
    lockScreen();
    if (startPaused) { pauseVoice('แตะไมค์เพื่อเริ่มคุย'); return; }
    $('voiceScreen').className = 'state-idle';
    setBotState('idle');
    startListening();
  }

  function pauseVoice(msg) {
    voicePaused = true; realtime = false;
    stopRecording(true); cancelSpeech();
    $('voiceScreen').className = 'paused state-idle';
    $('vState').textContent = msg || 'หยุดฟังชั่วคราว — แตะไมค์เพื่อคุยต่อ';
  }

  function resumeVoice() {
    voicePaused = false; realtime = true; idleCycles = 0;
    $('voiceScreen').className = 'state-idle';
    if (ttsSupported || premiumActive()) unlockSpeech();
    lockScreen();
    setBotState('idle');
    if (!sending) startListening();
  }

  function exitVoiceMode() {
    voiceMode = false; voicePaused = false; realtime = false;
    cancelSpeech(); stopRecording(true); unlockScreen();
    if (voiceStream) { try { voiceStream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ } voiceStream = null; }
    $('voiceScreen').hidden = true;
    if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => { /* ignore */ }); }
    cleanupPip(); pipMicLost = false; $('pipGuide').hidden = true;
    $('vHint').textContent = 'สวมหูฟังบลูทูธแล้วพูดได้เลย คุยต่อเนื่องไม่ต้องกดซ้ำ — แตะไมค์เพื่อหยุดชั่วคราว';
    setBotState('idle');
    renderMic();
  }

  $('micBtn').addEventListener('click', () => enterVoiceMode(false));
  $('vExit').addEventListener('click', exitVoiceMode);
  $('vMic').addEventListener('click', () => { if (voicePaused) resumeVoice(); else pauseVoice(); });


  // ---------- หน้าต่างเล็กลอย (Picture-in-Picture) — ทดลอง ----------
  // ย่อหน้าสนทนาเสียงเป็นหน้าต่างวิดีโอเล็กๆ ลอยอยู่บนหน้าจอหลัก/แอปอื่น (วาดสถานะลงภาพวิดีโอ) ไม่ต้องติดตั้งแอป
  // ข้อจำกัดของเบราว์เซอร์: หน้าต่างลอยกดได้แค่ เล่น/หยุด (ผูกกับ "คุยต่อ/หยุดฟังชั่วคราว") และแตะเพื่อกลับแอป
  // และระบบมือถืออาจพักไมค์เมื่อออกจากแอป — ถ้าเกิดขึ้น เบราว์เซอร์แจ้งว่าไมค์ถูกพัก เราแสดงข้อความในหน้าต่างลอยให้เห็น
  let pip = null; let pipMicLost = false;
  const PIP_W = 480; const PIP_H = 270;
  const pipSupported = () => !!(document.pictureInPictureEnabled && HTMLCanvasElement.prototype.captureStream);

  function bindMicWatch(stream) {
    stream.getAudioTracks().forEach((t) => {
      t.onmute = () => { pipMicLost = true; };
      t.onunmute = () => { pipMicLost = false; };
      t.onended = () => { pipMicLost = true; };
    });
  }

  function drawPip(ctx) {
    const w = PIP_W; const h = PIP_H; const t = Date.now() / 1000;
    const g = ctx.createRadialGradient(w / 2, h * 0.4, 8, w / 2, h * 0.4, w * 0.7);
    g.addColorStop(0, '#1d2a5e'); g.addColorStop(1, '#070a16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const st = pipMicLost ? 'lost' : (voicePaused ? 'paused' : botState);
    const color = { listening: '#34d399', thinking: '#a78bfa', speaking: '#22d3ee', idle: '#22d3ee', paused: '#8d98c4', lost: '#fb7185' }[st] || '#22d3ee';
    const label = st === 'lost' ? 'ไมค์ถูกระบบพักไว้ — แตะเพื่อกลับแอป' : st === 'paused' ? 'หยุดฟังชั่วคราว (กดเล่นเพื่อคุยต่อ)' : (STATE_TEXT[st] || '');
    const pulse = (st === 'listening' || st === 'speaking') ? 1 + 0.07 * Math.sin(t * 5) : 1;
    ctx.lineWidth = 7; ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(w / 2, h * 0.4, h * 0.2 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = Math.round(h * 0.22) + 'px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('🎙️', w / 2, h * 0.4);
    ctx.font = 'bold ' + Math.round(h * 0.085) + 'px sans-serif'; ctx.fillStyle = color; ctx.fillText(label, w / 2, h * 0.78);
    ctx.font = Math.round(h * 0.06) + 'px sans-serif'; ctx.fillStyle = '#8d98c4'; ctx.fillText('เลขา AquaConnect · แตะเพื่อกลับไปที่แอป', w / 2, h * 0.92);
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'เลขา AquaConnect', artist: 'สนทนาด้วยเสียง', artwork: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] });
      navigator.mediaSession.playbackState = 'playing';
      navigator.mediaSession.setActionHandler('pause', () => { if (voiceMode && !voicePaused) pauseVoice(); navigator.mediaSession.playbackState = 'paused'; });
      navigator.mediaSession.setActionHandler('play', () => { if (voiceMode && voicePaused) resumeVoice(); navigator.mediaSession.playbackState = 'playing'; });
    } catch (e) { /* ไม่รองรับบางคำสั่งก็ข้าม */ }
  }
  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.setActionHandler('pause', null); navigator.mediaSession.setActionHandler('play', null); navigator.mediaSession.metadata = null; } catch (e) { /* ignore */ }
  }

  function cleanupPip() {
    if (pip) { clearInterval(pip.timer); try { pip.video.pause(); pip.video.srcObject = null; pip.video.remove(); } catch (e) { /* ignore */ } pip = null; }
    clearMediaSession();
    if ($('vPip')) $('vPip').textContent = '📺 ย่อเป็นหน้าต่างลอย';
  }

  async function togglePip() {
    if (document.pictureInPictureElement) { try { await document.exitPictureInPicture(); } catch (e) { /* ignore */ } cleanupPip(); return; }
    if (!pipSupported()) { alert('เครื่องนี้ยังเปิดหน้าต่างลอยไม่ได้\n\nลองทำตามนี้:\n1) ใช้ Chrome (ไม่ใช่เบราว์เซอร์ในไลน์/Facebook)\n2) ตั้งค่ามือถือ → แอป → Chrome → "ภาพซ้อนภาพ" (Picture-in-picture) → เปิดอนุญาต\n3) ต้องเป็น Android 8 ขึ้นไป และอัปเดต Chrome เป็นล่าสุด'); return; }
    try {
      const canvas = document.createElement('canvas'); canvas.width = PIP_W; canvas.height = PIP_H;
      const ctx = canvas.getContext('2d');
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.autoplay = true;
      video.srcObject = canvas.captureStream(10);
      Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
      document.body.appendChild(video);
      drawPip(ctx);
      pip = { video, timer: setInterval(() => drawPip(ctx), 100) };
      await video.play();
      await video.requestPictureInPicture();
      video.addEventListener('leavepictureinpicture', cleanupPip, { once: true });
      setupMediaSession();
      $('vPip').textContent = '↩️ กลับเต็มจอ';
      try { if (localStorage.getItem('aq_pip_guide') !== '1') $('pipGuide').hidden = false; } catch (e) { $('pipGuide').hidden = false; }
      $('vHint').textContent = 'หน้าต่างลอยทำงานอยู่ — ถ้าออกจากแอปแล้วเลขาไม่ได้ยิน แปลว่ามือถือพักไมค์ไว้ ให้กลับมาที่แอปเพื่อคุยต่อ';
    } catch (e) {
      cleanupPip();
      alert('เปิดหน้าต่างลอยไม่ได้: ' + (e && e.message ? e.message : e));
    }
  }
  $('vPip').addEventListener('click', togglePip);
  $('pgOk').addEventListener('click', () => { if ($('pgNever').checked) { try { localStorage.setItem('aq_pip_guide', '1'); } catch (e) { /* ignore */ } } $('pipGuide').hidden = true; });
  $('vPip').hidden = false; // แสดงเสมอ — ถ้าเครื่องไม่รองรับ กดแล้วมีคำแนะนำวิธีเปิดสิทธิ์

  function stopAllVoice() {
    exitVoiceMode();
  }

  function pickMime() {
    const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (!window.MediaRecorder) return '';
    return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }

  async function startListening() {
    if (rec || sending) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      addBubble('error', 'เบราว์เซอร์นี้ยังอัดเสียงไม่ได้ — เปิดในเบราว์เซอร์ปกติ หรือพิมพ์แทนได้ค่ะ');
      addBrowserButton();
      realtime = false; renderMic();
      return;
    }
    let stream;
    try {
      if (voiceMode && voiceStream && voiceStream.active) stream = voiceStream;
      else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (voiceMode) { voiceStream = stream; bindMicWatch(stream); }
      }
    } catch (e) {
      if (voiceMode) exitVoiceMode();
      addBubble('error', 'เปิดไมโครโฟนไม่ได้ (ยังไม่ได้อนุญาต หรือเบราว์เซอร์ในไลน์ไม่รองรับ) — ลองเปิดในเบราว์เซอร์ปกติ หรือพิมพ์แทนได้ค่ะ');
      addBrowserButton();
      realtime = false; unlockScreen(); renderMic();
      return;
    }
    if (voiceMode && voicePaused) return;     // ผู้ใช้กดหยุดระหว่างรอสิทธิ์ไมค์
    const mimeType = pickMime();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    const state = { stream, recorder, ctx: null, timer: null, cancelled: false, heardSpeech: false };
    rec = state;
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    recorder.onstop = async () => {
      cleanupRec(state);
      rec = null;
      renderMic();
      if (state.cancelled || !state.heardSpeech || !chunks.length) {
        setBotState('idle');
        if (voiceMode && !voicePaused && !state.cancelled) {
          idleCycles++;
          if (idleCycles >= IDLE_LIMIT) pauseVoice('ไม่ได้ยินเสียงนานแล้ว หยุดฟังชั่วคราวค่ะ — แตะไมค์เพื่อคุยต่อ');
          else startListening();
          return;
        }
        // เรียลไทม์: ไม่มีใครพูดเลยก็หยุดฟัง ไม่วนฟังเปล่าๆ ไม่สิ้นสุด
        if (realtime && !state.cancelled) { realtime = false; unlockScreen(); renderMic(); }
        return;
      }
      idleCycles = 0;
      await transcribeAndSend(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
    recorder.start();
    setBotState('listening');
    renderMic();
    watchSilence(state);
  }

  // ตรวจเสียงเงียบด้วยระดับเสียง (RMS): พูดแล้วเงียบ ~1.4 วิ = จบประโยค, ไม่มีใครพูดใน 9 วิ = เลิกฟัง, อัดสูงสุด 40 วิ
  function watchSilence(state) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      state.ctx = new AC();
      const src = state.ctx.createMediaStreamSource(state.stream);
      const analyser = state.ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const started = Date.now();
      let lastVoice = 0;
      const THRESH = 0.035;
      state.timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > THRESH) { state.heardSpeech = true; lastVoice = now; }
        if (state.heardSpeech && now - lastVoice > 1400) stopRecording(false);
        else if (!state.heardSpeech && now - started > 9000) stopRecording(false);
        else if (now - started > 40000) stopRecording(false);
      }, 120);
    } catch (e) {
      // ตรวจเสียงเงียบไม่ได้: ให้ผู้ใช้กดไมค์ซ้ำเพื่อหยุดเอง, ถือว่ามีเสียงพูดเสมอ
      state.heardSpeech = true;
    }
  }

  function cleanupRec(state) {
    if (state.timer) clearInterval(state.timer);
    try { state.ctx && state.ctx.close(); } catch (e) { /* ignore */ }
    if (!(voiceMode && state.stream === voiceStream)) { try { state.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ } }
  }

  function stopRecording(cancel) {
    if (!rec) return;
    rec.cancelled = !!cancel;
    try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); else { cleanupRec(rec); rec = null; renderMic(); } } catch (e) { cleanupRec(rec); rec = null; renderMic(); }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  let unclearStreak = 0;   // จำนวนครั้งติดกันที่ฟังไม่ได้ความ
  async function transcribeAndSend(blob) {
    setBotState('thinking');
    $('stateLabel').textContent = 'กำลังถอดเสียง...';
    if (voiceMode && !voicePaused) $('vState').textContent = 'กำลังถอดเสียง...';
    try {
      const audio = await blobToBase64(blob);
      const { text, unclear } = await api('POST', '/api/chat/transcribe', { audio, mimeType: blob.type || 'audio/webm' });
      if (unclear) {   // มีเสียงแต่ฟังไม่ได้ความ (เสียงแทรก/ไมค์ไวเกิน) → ไม่ส่งเข้าเลขา ให้เลขาถามกลับสั้นๆ ขอพูดใหม่ (ถามไม่เกิน 2 ครั้งติด ถ้ายังเป็นอีกให้เงียบรอ ไม่วนพูดเสียค่าเสียง)
        unclearStreak++;
        setBotState('idle');
        if (unclearStreak <= 2) {
          const ask = 'ยังฟังไม่เข้าใจความหมายค่ะ ขอพูดอีกครั้งนะคะ';
          if (voiceMode) vCaption('(ฟังไม่ได้ความ)', ask); else addBubble('hint', ask);
          if (voiceMode ? !voicePaused : (ttsOn || realtime)) { speak(ask, afterSpeech); return; }
        } else if (voiceMode) vCaption('(ฟังไม่ได้ความ)', null);
        if (voiceMode && ++idleCycles >= IDLE_LIMIT) { pauseVoice('ฟังไม่ได้ความนานแล้ว หยุดฟังชั่วคราวค่ะ — แตะไมค์เพื่อคุยต่อ'); return; }
        if (realtime) startListening();
        return;
      }
      if (!text || !text.trim()) {
        setBotState('idle');
        addBubble('hint', 'ไม่ได้ยินเสียงชัดๆ ค่ะ ลองพูดใหม่อีกครั้งนะคะ');
        if (voiceMode) {
          vCaption('(ไม่ได้ยินชัด ลองพูดใหม่ได้เลยค่ะ)', null);
          if (++idleCycles >= IDLE_LIMIT) { pauseVoice('ไม่ได้ยินเสียงชัดเจนนานแล้ว หยุดฟังชั่วคราวค่ะ — แตะไมค์เพื่อคุยต่อ'); return; }
        }
        if (realtime) startListening();
        return;
      }
      unclearStreak = 0;
      await send(text, 'voice');
    } catch (err) {
      setBotState('idle');
      addBubble('error', err.message);
      if (voiceMode) { vCaption(null, err.message); pauseVoice('มีปัญหา หยุดฟังชั่วคราวค่ะ — แตะไมค์เพื่อลองใหม่'); return; }
      realtime = false; unlockScreen(); renderMic();
    }
  }

  // ---------- แผ่นด้านล่าง (เมนู / หัวข้อ / จำไว้ในหมวด) ----------
  function openSheet(title) {
    $('sheetTitle').textContent = title;
    $('sheetBody').textContent = '';
    $('sheetOverlay').hidden = false;
    return $('sheetBody');
  }
  function closeSheet() { $('sheetOverlay').hidden = true; }
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetOverlay').addEventListener('click', (e) => { if (e.target === $('sheetOverlay')) closeSheet(); });

  function sheetButton(body, label, onClick, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    body.appendChild(b);
    return b;
  }

  async function showTopics() {
    const body = openSheet('หัวข้อการคุย');
    try {
      const { conversations } = await api('GET', '/api/chat/conversations');
      if (!conversations.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'ยังไม่มีหัวข้อ'; body.appendChild(d); }
      conversations.forEach((c) => sheetButton(body, c.title || 'หัวข้อใหม่', () => openConversation(c.id), c.id === conversationId ? 'current' : ''));
    } catch (err) {
      const d = document.createElement('div'); d.className = 'empty'; d.textContent = err.message; body.appendChild(d);
    }
  }

  // รายการเมนูเดิม 4 ข้อ (เริ่มหัวข้อใหม่ / หัวข้อที่เคยคุย / ให้เลขาทบทวน / คุยด้วยเสียงต่อเนื่อง) — ซ่อนตามคำขอคุณต้น เพราะมีทางอื่นแล้ว
  // (ปุ่ม "เลือกหัวข้อการสนทนา" หน้าหลัก, เลขาทบทวนเองทุก 5 ข้อความ, ปุ่มไมค์ 🎤 เข้าโหมดเสียงต่อเนื่อง) — โค้ดยังอยู่ เปิดกลับได้โดยเปลี่ยนเป็น true
  const SHOW_LEGACY_MENU = false;
  $('menuBtn').addEventListener('click', () => {
    const body = openSheet('เมนู');
    if (me) {
      const head = document.createElement('div'); head.className = 'menu-head';
      const av = document.createElement('div'); av.className = 'av'; avatarContent(av);
      const who = document.createElement('div'); who.className = 'who';
      const nm = document.createElement('b'); nm.textContent = me.callName || me.name; const sm = document.createElement('small'); sm.textContent = 'เลขา: ' + me.secretaryName;
      who.append(nm, sm); head.append(av, who); body.appendChild(head);
    }
    if (SHOW_LEGACY_MENU) sheetButton(body, '➕ เริ่มหัวข้อใหม่', async () => { try { await newConversation(); } catch (err) { addBubble('error', err.message); } });
    if (SHOW_LEGACY_MENU) sheetButton(body, '🗂️ หัวข้อที่เคยคุย', showTopics);
    if (SHOW_LEGACY_MENU) sheetButton(body, '💡 ให้เลขาทบทวนสิ่งที่ฉันสอน', async () => { closeSheet(); try { const r = await api('POST', '/api/chat/reflect', {}); showProposals(r.proposals); if (!r.proposals.length) addBubble('assistant', 'ตอนนี้ยังไม่มีอะไรใหม่ที่เลขาอยากจดไว้ค่ะ คุยกันอีกสักพักแล้วลองใหม่นะคะ'); } catch (err) { addBubble('error', err.message); } });
    sheetButton(body, '🖼️ อัลบั้ม', showAlbum);
    sheetButton(body, '📅 ปฏิทิน & เตือน' + (dueCount ? ' (' + dueCount + ')' : ''), () => { closeSheet(); openCal(); });
    if (SHOW_LEGACY_MENU) sheetButton(body, '🎙️ คุยด้วยเสียงต่อเนื่อง (ใช้กับหูฟังบลูทูธ)', () => { closeSheet(); enterVoiceMode(false); });
    if (!isStandalone()) sheetButton(body, '📲 ติดตั้งไอคอนบนหน้าจอหลัก', installApp);
    sheetButton(body, '💰 เครดิต / เติมเงิน', showCredits);
    sheetButton(body, '⚙️ ตั้งค่าข้อมูล (ฟรี / คิดค่าบริการ)', showDataSettings);
    if (inLine) sheetButton(body, '🌐 เปิดในเบราว์เซอร์ (ใช้เสียงได้ครบ)', () => { closeSheet(); openExternal(); });
    if (me && me.isAdmin) sheetButton(body, '🛠️ หลังบ้านแอดมิน', () => { location.href = '/admin'; });
    sheetButton(body, '🚪 ออกจากระบบ', async () => {
      closeSheet();
      try { await api('POST', '/api/auth/logout'); } catch (e) { /* ออกต่อได้แม้เรียกไม่สำเร็จ */ }
      showAuth();
    }, 'danger');
  });

  // ---------- เครดิต ----------
  const LEDGER_LABEL = { topup: 'เติมเครดิต', spend: 'ใช้ถามเลขาคนอื่น', earn: 'รายได้จากการตอบ', refund: 'คืนเครดิต', adjust: 'ปรับยอด' };

  // ย่อรูปสลิปก่อนส่ง (ไม่ให้ใหญ่เกินเพดาน และประหยัดเน็ตมือถือ) — คืน base64 ของ JPEG
  function fileToJpegBase64(file, maxDim) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้ ลองเลือกรูปสลิปใหม่')); };
      img.src = url;
    });
  }

  function note(body, text, cls) { const d = document.createElement('div'); d.className = cls || 'empty'; d.textContent = text; body.appendChild(d); return d; }

  async function showCredits() {
    const body = openSheet('เครดิตของฉัน');
    let info;
    try { info = await api('GET', '/api/credits/me'); } catch (err) { note(body, err.message); return; }
    note(body, info.balance.toLocaleString('th-TH') + ' เครดิต', 'bal');
    note(body, 'เครดิต 1 = 1 บาท' + (info.pendingTopups ? ' • มี ' + info.pendingTopups + ' รายการรอแอดมินตรวจสลิป' : ''));
    info.ledger.slice(0, 5).forEach((l) => note(body, (l.amount > 0 ? '+' : '') + l.amount + '  ' + (l.ref_type === 'tts' ? 'เสียงเลขาพรีเมียม' : (LEDGER_LABEL[l.type] || l.type)) + (l.note && l.ref_type !== 'tts' ? ' (' + l.note + ')' : ''), 'ledger'));

    note(body, 'เติมเครดิต', 'sub');
    if (!info.qrAvailable) { note(body, 'ยังไม่ได้ตั้งค่า QR รับเงิน — แจ้งแอดมิน'); return; }
    try {
      const r = await fetch('/api/credits/payment-qr', { credentials: 'same-origin' });
      if (r.ok) { const im = document.createElement('img'); im.alt = 'QR รับเงิน'; im.src = URL.createObjectURL(await r.blob()); body.appendChild(im); }
    } catch (e) { /* โหลดรูปไม่ได้ก็ยังส่งสลิปได้ถ้าเคยโอนแล้ว */ }
    note(body, '1) สแกน QR โอนผ่านแอปธนาคาร  2) กรอกยอดที่โอน  3) แนบรูปสลิป แล้วกดส่ง — แอดมินตรวจแล้วเครดิตจะเข้า');
    const amt = document.createElement('input'); amt.type = 'number'; amt.inputMode = 'decimal'; amt.placeholder = 'ยอดที่โอน (บาท)'; body.appendChild(amt);
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; body.appendChild(file);
    const status = note(body, '');
    sheetButton(body, '📤 ส่งสลิปขอเติมเครดิต', async () => {
      const amount = Number(amt.value);
      if (!(amount > 0)) { status.textContent = 'กรอกยอดที่โอนก่อน'; return; }
      if (!file.files[0]) { status.textContent = 'เลือกรูปสลิปก่อน'; return; }
      status.textContent = 'กำลังส่ง...';
      try {
        const slip = await fileToJpegBase64(file.files[0], 1100);
        await api('POST', '/api/credits/topups', { amount, slip, mimeType: 'image/jpeg' });
        closeSheet();
        addBubble('hint', 'ส่งสลิปแล้วค่ะ รอแอดมินตรวจสอบ เครดิตจะเข้าและแจ้งเตือนทางไลน์');
      } catch (err) { status.textContent = err.message; }
    });
  }

  // ---------- เสียงปลุก (ดังจนกว่าจะกดรับทราบ) ----------
  // เบราว์เซอร์ห้ามเล่นเสียงก่อนผู้ใช้แตะหน้าจอ → ปลดล็อกเสียงตอนแตะครั้งแรกของหน้านี้ แล้วค่อยใช้ตอนถึงเวลาเตือน (ใช้ได้เฉพาะตอนเปิดแอปค้างอยู่)
  let audioCtx = null; let alarmTimer = null; let alarmStop = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && AC) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* ไม่รองรับเสียงก็ข้ามไป */ }
  }
  ['pointerdown', 'touchstart', 'keydown', 'click'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));

  function beep(freq, when, dur) {
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.35, when + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(when); o.stop(when + dur + 0.02);
  }
  function ringOnce() {
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) { /* ไม่รองรับการสั่น */ }
    if (!audioCtx || audioCtx.state !== 'running') return false;
    const t = audioCtx.currentTime;
    for (let i = 0; i < 4; i++) beep(i % 2 ? 988 : 784, t + i * 0.26, 0.2);
    return true;
  }
  function stopAlarm() {
    clearInterval(alarmTimer); clearTimeout(alarmStop); alarmTimer = null; alarmStop = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* ignore */ }
  }
  function startAlarm() {
    stopAlarm();
    unlockAudio();
    ringOnce();
    alarmTimer = setInterval(ringOnce, 1800);
    alarmStop = setTimeout(stopAlarm, 3 * 60 * 1000);   // กันดังไม่หยุดเกิน 3 นาที (popup ยังอยู่จนกว่าจะรับทราบ)
  }

  // ปุ่ม ⏰ ตั้งนาฬิกาปลุกในมือถือ (Android) — ดู alarm.js
  function setPhoneAlarm(e) {
    const r = window.aqAlarm.buildAlarm({ remindAt: e.remindAt, remindTime: e.remindTime, title: e.title, ua: navigator.userAgent });
    if (!r.ok) { alert(window.aqAlarm.MESSAGES[r.reason]); return; }
    location.href = r.url;
    addBubble('hint', 'ส่งคำสั่งตั้งปลุกให้แอปนาฬิกาแล้วค่ะ (เวลา ' + e.remindTime + ' น.)' + (inLine ? '\nถ้าไม่เด้งไปที่แอปนาฬิกา ให้เปิดแอปนี้ในเบราว์เซอร์ Chrome (เมนู ☰ → เปิดในเบราว์เซอร์) แล้วกดปุ่ม ⏰ อีกครั้ง' : '\nถ้าไม่เด้งไปที่แอปนาฬิกา ลองเปิดจาก Chrome แล้วกดอีกครั้ง'));
  }

  // ---------- ปฏิทิน & เตือน (popup กลางจอ) ----------
  const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const bkkToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());   // YYYY-MM-DD เวลาไทย
  const thDate = (key) => { const [y, m, d] = key.split('-').map(Number); return d + ' ' + TH_MONTHS[m - 1] + ' ' + (y + 543); };
  const calCard = () => $('calCard');
  let cal = { y: 0, m: 0, sel: '', events: [] };
  let dueCount = 0;
  const shownDue = new Map();      // id → เวลาที่เด้ง popup ล่าสุด (ยังไม่รับทราบ → เด้งซ้ำทุก 5 นาที ตราบที่ยังเปิดแอปค้างอยู่)

  function calClose() { stopAlarm(); $('calOverlay').hidden = true; calCard().textContent = ''; }
  $('calOverlay').addEventListener('click', (e) => { if (e.target === $('calOverlay')) calClose(); });

  function ce(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }

  async function openCal(dateKey) {
    const key = dateKey || bkkToday();
    const [y, m] = key.split('-').map(Number);
    cal = { y, m, sel: key, events: [] };
    $('calOverlay').hidden = false;
    await calReload();
  }

  async function calReload() {
    try { cal.events = (await api('GET', '/api/calendar?month=' + cal.y + '-' + pad2(cal.m))).events; }
    catch (err) { calCard().textContent = ''; calCard().append(ce('div', err.message, 'cal-err'), calCloseBtn()); return; }
    calRender();
  }

  function calCloseBtn() { const b = ce('button', 'ปิด', 'cal-btn'); b.type = 'button'; b.addEventListener('click', calClose); return b; }

  function calRender() {
    const card = calCard(); card.textContent = '';
    const head = ce('div', undefined, 'cal-head');
    const prev = ce('button', '‹', 'cal-nav'); prev.type = 'button'; prev.setAttribute('aria-label', 'เดือนก่อน');
    const next = ce('button', '›', 'cal-nav'); next.type = 'button'; next.setAttribute('aria-label', 'เดือนถัดไป');
    const shift = (d) => { let m = cal.m + d, y = cal.y; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } cal.y = y; cal.m = m; cal.sel = y + '-' + pad2(m) + '-01'; calReload(); };
    prev.addEventListener('click', () => shift(-1)); next.addEventListener('click', () => shift(1));
    head.append(prev, ce('b', '📅 ' + TH_MONTHS[cal.m - 1] + ' ' + (cal.y + 543)), next);
    card.appendChild(head);

    const byDay = {};
    cal.events.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    const grid = ce('div', undefined, 'cal-grid');
    TH_DOW.forEach((d) => grid.appendChild(ce('div', d, 'cal-dow')));
    const first = new Date(Date.UTC(cal.y, cal.m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(cal.y, cal.m, 0)).getUTCDate();
    for (let i = 0; i < first; i++) grid.appendChild(ce('div', '', 'cal-day empty'));
    const today = bkkToday();
    for (let d = 1; d <= days; d++) {
      const key = cal.y + '-' + pad2(cal.m) + '-' + pad2(d);
      const list = byDay[key] || [];
      const cell = ce('button', undefined, 'cal-day' + (key === today ? ' today' : '') + (key === cal.sel ? ' sel' : ''));
      cell.type = 'button';
      cell.appendChild(ce('span', String(d)));
      if (list.length) {
        const dot = ce('span', undefined, 'dot' + (list.some((e) => e.due) ? ' due' : '')); cell.appendChild(dot);
        if (list.length > 1) cell.appendChild(ce('span', '×' + list.length, 'cnt'));
      }
      cell.addEventListener('click', () => { cal.sel = key; calRender(); });
      grid.appendChild(cell);
    }
    card.appendChild(grid);

    card.appendChild(ce('div', thDate(cal.sel), 'cal-sub'));
    const todays = byDay[cal.sel] || [];
    if (!todays.length) card.appendChild(ce('div', 'ไม่มีนัดหมายหรือบันทึกในวันนี้', 'cal-empty'));
    todays.forEach((e) => card.appendChild(calEventCard(e)));

    const add = ce('button', '＋ เพิ่มนัด / บันทึก (' + thDate(cal.sel) + ')', 'cal-btn primary'); add.type = 'button';
    add.addEventListener('click', () => calForm(cal.sel));
    const test = ce('button', '🔔 ทดสอบเสียงปลุก (เช็กว่าเสียงดังพอ)', 'cal-btn'); test.type = 'button';
    test.addEventListener('click', () => { unlockAudio(); setTimeout(() => { if (!ringOnce()) alert('เครื่องนี้ยังเปิดเสียงไม่ได้ — ลองแตะหน้าจออีกครั้ง หรือเช็กว่าไม่ได้ปิดเสียงมือถือไว้'); }, 150); });
    card.append(add, test, calCloseBtn());
  }

  function calEventCard(e) {
    const box = ce('div', undefined, 'cal-ev');
    const t = ce('div', undefined, 't');
    t.append((e.allDay ? 'ทั้งวัน' : e.time + ' น.') + ' · ' + e.title);
    if (e.acknowledged) t.appendChild(ce('span', 'รับทราบแล้ว', 'st ok'));
    else if (e.due) t.appendChild(ce('span', 'ถึงเวลาเตือนแล้ว', 'st due'));
    box.appendChild(t);
    if (e.note) box.appendChild(ce('small', e.note));
    box.appendChild(ce('small', '🔔 เตือน ' + thDate(e.remindDate) + ' ' + e.remindTime + ' น.' + (e.reminded ? ' (แจ้งแล้ว)' : '') + (e.createdVia === 'secretary' ? ' · เลขาตั้งให้' : '')));
    const row = ce('div', undefined, 'row2');
    if (!e.acknowledged && e.due) {
      const ok = ce('button', '✅ รับทราบแล้ว', 'ok'); ok.type = 'button';
      ok.addEventListener('click', async () => { try { await api('POST', '/api/calendar/' + e.id + '/ack'); await calReload(); pollDue(); } catch (err) { alert(err.message); } });
      row.appendChild(ok);
    }
    if (!e.acknowledged) {
      const al = ce('button', '⏰ ตั้งปลุกในมือถือ'); al.type = 'button';
      al.addEventListener('click', () => setPhoneAlarm(e));
      row.appendChild(al);
    }
    const del = ce('button', '🗑 ลบ', 'danger'); del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm('ลบนัด "' + e.title + '" ?')) return;
      try { await api('DELETE', '/api/calendar/' + e.id); await calReload(); pollDue(); } catch (err) { alert(err.message); }
    });
    row.appendChild(del);
    box.appendChild(row);
    return box;
  }

  function calForm(dateKey) {
    const card = calCard(); card.textContent = '';
    const form = ce('div', undefined, 'cal-form');
    form.appendChild(ce('div', '📅 เพิ่มนัด / บันทึกให้เลขาเตือน', 'cal-sub'));
    const mkInput = (type, label, attrs) => { const w = ce('div'); w.appendChild(ce('label', label)); const i = document.createElement(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') i.type = type; Object.assign(i, attrs || {}); w.appendChild(i); return { w, i }; };
    const title = mkInput('text', 'เรื่อง (เช่น ประชุมกับบริษัท A)', { maxLength: 120, placeholder: 'ชื่อนัดหมาย' });
    const date = mkInput('date', 'วันที่นัด', { value: dateKey });
    const time = mkInput('time', 'เวลา', { value: '09:00' });
    const two = ce('div', undefined, 'two'); two.append(date.w, time.w);
    const allDay = document.createElement('input'); allDay.type = 'checkbox';
    const chk = ce('label', undefined, 'chk'); chk.append(allDay, document.createTextNode(' นัดทั้งวัน (ไม่ระบุเวลา)'));
    allDay.addEventListener('change', () => { time.i.disabled = allDay.checked; });
    const note = mkInput('textarea', 'บันทึกเพิ่มเติม (ไม่บังคับ)', { maxLength: 500, placeholder: 'เช่น ห้องประชุม ต้องเตรียมอะไร' });

    const rw = ce('div'); rw.appendChild(ce('label', '🔔 ให้เลขาเตือนเมื่อไหร่'));
    const sel = document.createElement('select');
    [['at', 'ตรงเวลานัด (นัดทั้งวัน = 8 โมงเช้า)'], ['15', 'ก่อนนัด 15 นาที'], ['60', 'ก่อนนัด 1 ชั่วโมง'], ['180', 'ก่อนนัด 3 ชั่วโมง'], ['1440', 'ก่อนนัด 1 วัน (เวลาเดียวกัน)'], ['custom', 'กำหนดวัน-เวลาเตือนเอง']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    rw.appendChild(sel);
    const rdate = mkInput('date', 'วันที่เตือน', { value: dateKey }); const rtime = mkInput('time', 'เวลาเตือน', { value: '08:00' });
    const rtwo = ce('div', undefined, 'two'); rtwo.append(rdate.w, rtime.w); rtwo.hidden = true;
    sel.addEventListener('change', () => { rtwo.hidden = sel.value !== 'custom'; });
    const err = ce('div', '', 'cal-err');
    const save = ce('button', '💾 บันทึกนัด', 'cal-btn primary'); save.type = 'button';
    const back = ce('button', 'ยกเลิก', 'cal-btn'); back.type = 'button'; back.addEventListener('click', calRender);
    save.addEventListener('click', async () => {
      err.textContent = '';
      if (!title.i.value.trim()) { err.textContent = 'ใส่ชื่อนัดก่อน'; return; }
      if (!date.i.value) { err.textContent = 'เลือกวันที่นัด'; return; }
      const remind = sel.value === 'at' ? { mode: 'at' } : sel.value === 'custom' ? { mode: 'custom', date: rdate.i.value, time: rtime.i.value } : { mode: 'minutes', minutes: Number(sel.value) };
      save.disabled = true;
      try {
        const r = await api('POST', '/api/calendar', { title: title.i.value, note: note.i.value, date: date.i.value, time: allDay.checked ? '' : time.i.value, allDay: allDay.checked, remind });
        cal.sel = r.event.date; const [y, m] = r.event.date.split('-').map(Number); cal.y = y; cal.m = m;
        await calReload();
        pollDue();
      } catch (e) { err.textContent = e.message; save.disabled = false; }
    });
    form.append(title.w, two, chk, note.w, rw, rtwo, err, save, back);
    card.appendChild(form);
    title.i.focus();
  }

  // ถึงเวลาเตือนแล้วแต่ยังไม่กดรับทราบ → เด้ง popup กลางจอ (สำหรับคนที่ไม่ได้ดูไลน์ หรือยังไม่ผูกไลน์)
  function showDuePopup(list) {
    const card = calCard(); card.textContent = '';
    $('calOverlay').hidden = false;
    card.appendChild(ce('div', '🔔 ถึงเวลาแจ้งเตือน', 'cal-sub'));
    startAlarm();
    if (!audioCtx || audioCtx.state !== 'running') card.appendChild(ce('div', '🔇 แตะหน้าจอ 1 ครั้งเพื่อเปิดเสียงปลุก', 'cal-empty'));
    list.forEach((e) => {
      const box = ce('div', undefined, 'cal-ev');
      box.appendChild(ce('div', e.title, 't'));
      box.appendChild(ce('small', '📅 ' + thDate(e.date) + (e.allDay ? ' (ทั้งวัน)' : ' เวลา ' + e.time + ' น.')));
      if (e.note) box.appendChild(ce('small', e.note));
      const row = ce('div', undefined, 'row2');
      const ok = ce('button', '✅ รับทราบแล้ว', 'ok'); ok.type = 'button';
      ok.addEventListener('click', async () => {
        try { await api('POST', '/api/calendar/' + e.id + '/ack'); box.remove(); dueCount = Math.max(0, dueCount - 1); if (!card.querySelector('.cal-ev')) calClose(); pollDue(); }
        catch (err) { alert(err.message); }
      });
      row.appendChild(ok); box.appendChild(row); card.appendChild(box);
    });
    const mute = ce('button', '🔇 ปิดเสียง (ยังไม่รับทราบ)', 'cal-btn'); mute.type = 'button'; mute.addEventListener('click', stopAlarm);
    const open = ce('button', '📅 เปิดปฏิทิน', 'cal-btn'); open.type = 'button'; open.addEventListener('click', () => { stopAlarm(); openCal(); });
    card.append(mute, open, calCloseBtn());
  }

  async function pollDue() {
    if (!me) return;
    try {
      const { events } = await api('GET', '/api/calendar/due');
      dueCount = events.length;
      const fresh = events.filter((e) => !shownDue.has(e.id) || Date.now() - shownDue.get(e.id) > 5 * 60000);
      if (fresh.length && !voiceMode && $('calOverlay').hidden && $('sheetOverlay').hidden) { fresh.forEach((e) => shownDue.set(e.id, Date.now())); showDuePopup(events); }
    } catch (e) { /* ครั้งนี้เช็กไม่ได้ ไว้รอบหน้า */ }
  }
  setInterval(() => { if (me && !appEl.hidden && document.visibilityState === 'visible') pollDue(); }, 60000);

  function addEventChip(ev) {
    const chip = document.createElement('div');
    chip.className = 'chip-saved';
    chip.textContent = '📅 ตั้งเตือนแล้ว: ' + ev.title + ' · ' + thDate(ev.date) + (ev.time ? ' ' + ev.time + ' น.' : '') + ' (เตือน ' + thDate(ev.remindDate) + ' ' + ev.remindTime + ')';
    logEl.appendChild(chip);
    scrollToBottom();
  }

  // ---------- เชื่อมต่อข้อมูล ----------
  function priceText(c, block) {
    if (c.visibility !== 'paid') return 'ฟรี';
    if (c.price_type === 'question') return c.price_credits + ' เครดิต/คำถาม';
    const per = Math.round((c.price_credits / 60) * block * 100) / 100;
    return c.price_credits + ' เครดิต/ชั่วโมง (คิดเป็นก้อนละ ' + block + ' นาที ก้อนละ ' + per + ' เครดิต)';
  }

  let connectOpen = true;
  function renderConnToggle(open) {
    connectOpen = open;
    const b = $('connToggle');
    b.textContent = (open ? '🔓' : '🔒') + ' อนุญาตใช้ข้อมูล: ' + (open ? 'เปิด' : 'ปิด');
    b.classList.toggle('on', open);
    b.classList.toggle('off', !open);
  }
  $('connToggle').addEventListener('click', async () => {
    const next = !connectOpen;
    if (!next && !confirm('ปิดการอนุญาตใช้ข้อมูลชั่วคราว?\nจะไม่มีใครขอหรือใช้ข้อมูลของคุณได้ (สิทธิ์ที่เคยอนุญาตไว้ยังอยู่ เปิดใหม่แล้วใช้ต่อได้)')) return;
    try {
      const r = await api('POST', '/api/connect/enabled', { enabled: next });
      renderConnToggle(r.connectEnabled);
      addBubble('hint', r.connectEnabled
        ? 'เปิดการอนุญาตใช้ข้อมูลแล้วค่ะ คนอื่นขอและใช้ข้อมูลในหมวดที่คุณเปิดแชร์ไว้ได้ (ต้องให้คุณกดอนุญาตก่อนทุกครั้ง)'
        : 'ปิดการอนุญาตใช้ข้อมูลแล้วค่ะ ตอนนี้ไม่มีใครขอหรือใช้ข้อมูลของคุณได้ (สิทธิ์เดิมยังอยู่)');
    } catch (err) { addBubble('error', err.message); }
  });

  async function refreshConnectBadge() {
    try {
      const { incoming, outgoing, connectEnabled } = await api('GET', '/api/connect/mine');
      if (!connected) {
        const fresh = outgoing.filter((r) => r.status === 'approved' && !endedRequests.has(r.request_id) && r.decided_at && Date.now() - new Date(r.decided_at).getTime() < 15 * 60 * 1000 && (!r.expires_at || new Date(r.expires_at) > new Date()))
          .sort((x, y) => new Date(y.decided_at) - new Date(x.decided_at))[0];
        if (fresh) startConnected(fresh, labelOf(fresh), fresh.expires_at);
      }
      renderConnToggle(connectEnabled !== false);
      const n = incoming.filter((r) => r.status === 'pending').length;
      $('connectBtn').textContent = '🔗 เชื่อมข้อมูลภายนอก' + (n ? ' (' + n + ')' : '');
      $('connectBtn').classList.toggle('on', n > 0);
    } catch (e) { /* ครั้งนี้เช็กไม่ได้ ไว้รอบหน้า */ }
  }
  setInterval(() => { if (me && !appEl.hidden && document.visibilityState === 'visible') refreshConnectBadge(); }, 60000);

  const endedRequests = new Set();    // เชื่อมต่อที่ผู้ใช้กด "จบ" หรือหมดเวลาแล้ว — ไม่เชื่อมซ้ำอัตโนมัติ
  let connTimer = null;
  function renderConnBar() {
    if (!connected) return;
    let t = 'กำลังใช้ข้อมูลของคุณ' + connected.owner + ' · หมวด ' + connected.category + ' · ' + connected.priceLabel;
    if (connected.expiresAt) {
      const left = Math.max(0, Math.round((connected.expiresAt - Date.now()) / 1000));
      t += ' · เหลือ ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    }
    $('connText').textContent = t;
  }
  function startConnected(req, priceLabel, expiresAt) {
    const id = req.request_id || req.my_request_id || req.requestId;
    if (connected && connected.requestId === id) return;
    connected = { requestId: id, owner: req.owner_name || req.owner, category: req.category, priceLabel, expiresAt: expiresAt ? new Date(expiresAt).getTime() : null };
    closeSheet();
    $('connBar').hidden = false;
    renderConnBar();
    clearInterval(connTimer);
    connTimer = setInterval(() => {
      if (!connected) { clearInterval(connTimer); return; }
      if (connected.expiresAt && Date.now() >= connected.expiresAt) { expireConnected(); return; }
      renderConnBar();
    }, 1000);
    addBubble('hint', 'เชื่อมต่อข้อมูลของคุณ' + connected.owner + ' หมวด "' + connected.category + '" แล้วค่ะ (' + priceLabel + ')' +
      (connected.expiresAt ? '\nหมวดฟรีใช้ได้ถึงเวลาที่นับถอยหลังบนแถบสีม่วง ครบแล้วระบบตัดการเชื่อมต่อ ต้องขอใหม่' : '') +
      '\nพิมพ์หรือพูดคำถามได้เลย' + (connected.expiresAt ? '' : ' ค่าบริการจะเริ่มคิดตั้งแต่คำถามแรก'));
  }
  function endConnected(silent) {
    if (!connected) return;
    endedRequests.add(connected.requestId);
    connected = null;
    clearInterval(connTimer);
    $('connBar').hidden = true;
    if (!silent) addBubble('hint', 'จบการใช้ข้อมูลของคนอื่นแล้วค่ะ กลับมาคุยกับเลขาของคุณตามปกติ');
  }
  function expireConnected() {
    const who = connected ? 'คุณ' + connected.owner + ' หมวด "' + connected.category + '"' : '';
    endConnected(true);
    addBubble('hint', 'ครบเวลาใช้ข้อมูลฟรี ตัดการเชื่อมต่อ' + who + ' แล้วค่ะ ถ้าจะใช้ต่อ กด "เชื่อมข้อมูลภายนอก" แล้วขอเข้าใช้ใหม่อีกครั้ง');
  }

  // เฝ้าคำขอที่ส่งไป: เจ้าของกดอนุญาตเมื่อไหร่ ระบบเชื่อมต่อให้เองทันที (ผู้ขอไม่ต้องกดอะไรเพิ่ม)
  const watchers = new Map();
  function labelOf(r) {
    return priceText({ visibility: r.visibility, price_type: r.price_type, price_credits: r.price_credits === null || r.price_credits === undefined ? null : Number(r.price_credits) }, 5);
  }
  function watchRequest(requestId, ownerName, category) {
    if (watchers.has(requestId)) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (!me || Date.now() - started > 10 * 60 * 1000) { clearInterval(timer); watchers.delete(requestId); return; }
      try {
        const { outgoing } = await api('GET', '/api/connect/mine');
        const r = outgoing.find((x) => x.request_id === requestId);
        if (!r || r.status === 'pending') return;
        clearInterval(timer); watchers.delete(requestId);
        if (r.status === 'approved') { if (!connected) startConnected(r, labelOf(r), r.expires_at); }
        else addBubble('hint', 'คุณ' + ownerName + ' ไม่อนุญาตให้ใช้ข้อมูลหมวด "' + category + '" ค่ะ');
      } catch (e) { /* ไว้รอบหน้า */ }
    }, 4000);
    watchers.set(requestId, timer);
  }
  $('connEnd').addEventListener('click', () => endConnected(false));

  // 2 หมวดหลัก (ทั่วไป / ความสามารถเลขา) แยกสีและไอคอนให้เห็นชัด อยู่บนสุดเสมอ (เรียงจากเซิร์ฟเวอร์)
  const catIcon = (n) => (n === 'ทั่วไป' ? '📘' : n === 'ความสามารถเลขา' ? '🧠' : n === 'ข้อมูลแชท' ? '💬' : n === 'การใช้งานแพลตฟอร์ม' ? '📖' : '📁');
  const mainCatClass = (n) => (n === 'ทั่วไป' ? 'cat-general' : n === 'ความสามารถเลขา' ? 'cat-skill' : n === 'ข้อมูลแชท' ? 'cat-chat' : n === 'การใช้งานแพลตฟอร์ม' ? 'cat-guide' : '');
  function pcard(body, title, sub, extraCls) {
    const d = document.createElement('div'); d.className = 'pcard' + (extraCls ? ' ' + extraCls : '');
    const b = document.createElement('b'); b.textContent = title; d.appendChild(b);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; d.appendChild(s); }
    body.appendChild(d);
    return d;
  }
  function miniBtn(parent, label, onClick, cls) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
    b.addEventListener('click', onClick); parent.appendChild(b); return b;
  }

  async function showConnect() {
    const body = openSheet('เชื่อมข้อมูลภายนอก');
    let mine; let people;
    try { [mine, people] = await Promise.all([api('GET', '/api/connect/mine'), api('GET', '/api/connect/people')]); }
    catch (err) { note(body, err.message); return; }
    const pending = mine.incoming.filter((r) => r.status === 'pending');
    $('connectBtn').textContent = '🔗 เชื่อมข้อมูลภายนอก' + (pending.length ? ' (' + pending.length + ')' : '');

    if (pending.length) {
      note(body, 'รอคุณอนุญาต', 'sub');
      pending.forEach((r) => {
        const d = pcard(body, 'คุณ' + r.requester_name + ' ขอเข้าใช้หมวด "' + r.category + '"', r.message || '');
        const row = document.createElement('div'); row.className = 'row2'; d.appendChild(row);
        const decide = (decision) => async () => {
          try { await api('POST', '/api/connect/decide', { requestId: r.request_id, decision }); showConnect(); }
          catch (err) { note(body, err.message); }
        };
        miniBtn(row, '✅ อนุญาต', decide('approve'), 'ok');
        miniBtn(row, '✖ ไม่อนุญาต', decide('deny'), 'danger');
      });
    }

    const usable = mine.outgoing.filter((r) => r.status === 'approved');
    if (usable.length) {
      note(body, 'ข้อมูลที่คุณใช้ได้ตอนนี้', 'sub');
      usable.forEach((r) => {
        const label = priceText({ visibility: r.visibility, price_type: r.price_type, price_credits: r.price_credits === null ? null : Number(r.price_credits) }, 5);
        const d = pcard(body, 'คุณ' + r.owner_name + ' · ' + r.category, label);
        const row = document.createElement('div'); row.className = 'row2'; d.appendChild(row);
        miniBtn(row, '💬 เริ่มใช้ข้อมูล', () => startConnected(r, label, r.expires_at), 'ok');
      });
    }

    const given = mine.incoming.filter((r) => r.status === 'approved');
    if (given.length) {
      note(body, 'คนที่คุณอนุญาตไว้', 'sub');
      given.forEach((r) => {
        const d = pcard(body, 'คุณ' + r.requester_name + ' · ' + r.category);
        const row = document.createElement('div'); row.className = 'row2'; d.appendChild(row);
        miniBtn(row, 'ถอนสิทธิ์', async () => {
          if (!confirm('ถอนสิทธิ์ของคุณ' + r.requester_name + ' ?')) return;
          try { await api('POST', '/api/connect/decide', { requestId: r.request_id, decision: 'revoke' }); showConnect(); } catch (err) { note(body, err.message); }
        }, 'danger');
      });
    }

    note(body, 'รายชื่อสมาชิก — เลือกคนที่จะเชื่อมต่อ', 'sub');
    if (!people.people.length) note(body, 'ตอนนี้ยังไม่มีสมาชิกคนอื่นในระบบ');
    people.people.forEach((p) => {
      if (p.open === false) sheetButton(body, '👤 ' + p.name + '  · ปิดการอนุญาตใช้ข้อมูลชั่วคราว', () => { note(body, 'คุณ' + p.name + ' ปิดการอนุญาตใช้ข้อมูลไว้ชั่วคราวค่ะ'); }, 'dim');
      else if (p.categories > 0) sheetButton(body, '👤 ' + p.name + '  · เปิดให้ ' + p.categories + ' หมวด', () => showPerson(p));
      else sheetButton(body, '👤 ' + p.name + '  · ยังไม่ได้เปิดข้อมูล', () => { note(body, 'คุณ' + p.name + ' ยังไม่ได้เปิดหมวดข้อมูลให้เชื่อมต่อ — เมื่อเปิดแล้วจะเข้าใช้ได้ค่ะ'); }, 'dim');
    });
  }

  function backButton(body, to) { sheetButton(body, '← กลับ', to); }

  function showPerson(p) {
    const body = openSheet('คุณ' + p.name);
    sheetButton(body, '👁️ เข้าดูข้อมูล — ดูว่ามีหมวดอะไรบ้าง และค่าบริการ', () => showView(p));
    sheetButton(body, '🔑 เข้าใช้ข้อมูล — ขออนุญาตเจ้าของเพื่อถามข้อมูล', () => showUse(p));
    backButton(body, showConnect);
  }

  async function showView(p) {
    const body = openSheet('ข้อมูลของคุณ' + p.name);
    let r;
    try { r = await api('GET', '/api/connect/people/' + p.id); } catch (err) { note(body, err.message); backButton(body, () => showPerson(p)); return; }
    note(body, 'ดูรายการนี้ไม่มีค่าใช้จ่าย และจะยังไม่เห็นเนื้อหาข้อมูล — ค่าบริการเริ่มคิดเมื่อได้รับอนุญาตและเริ่มใช้ข้อมูลเท่านั้น');
    r.categories.forEach((c) => pcard(body, c.name + '  · ' + c.items + ' รายการ', (c.description ? c.description + '\n' : '') + 'ค่าบริการ: ' + priceText(c, r.blockMinutes)));
    backButton(body, () => showPerson(p));
  }

  async function showUse(p) {
    const body = openSheet('เข้าใช้ข้อมูลของคุณ' + p.name);
    let r;
    try { r = await api('GET', '/api/connect/people/' + p.id); } catch (err) { note(body, err.message); backButton(body, () => showPerson(p)); return; }
    note(body, 'เลือกหมวดที่ต้องการ — เจ้าของจะได้รับแจ้งพร้อมปุ่มอนุญาต เมื่ออนุญาตแล้วกลับมากด "เริ่มใช้ข้อมูล" ค่าบริการเริ่มคิดตั้งแต่คำถามแรก');
    r.categories.forEach((c) => {
      const label = priceText(c, r.blockMinutes);
      const d = pcard(body, c.name + '  · ' + c.items + ' รายการ', 'ค่าบริการ: ' + label);
      const row = document.createElement('div'); row.className = 'row2'; d.appendChild(row);
      if (c.my_status === 'approved') {
        miniBtn(row, '💬 เริ่มใช้ข้อมูล', () => startConnected({ my_request_id: c.my_request_id, owner: p.name, category: c.name }, label, c.my_expires_at), 'ok');
      } else if (c.my_status === 'pending') {
        miniBtn(row, '⏳ รอเจ้าของอนุญาต', () => {}).disabled = true;
        watchRequest(c.my_request_id, p.name, c.name);
      } else {
        miniBtn(row, c.my_status ? '🔁 ขอเข้าใช้อีกครั้ง' : '🔑 ขอเข้าใช้', async (e) => {
          e.target.disabled = true;
          try { const rq = await api('POST', '/api/connect/request', { ownerId: p.id, category: c.name }); watchRequest(rq.requestId, p.name, c.name); showUse(p); addBubble('hint', 'ส่งคำขอถึงคุณ' + p.name + ' แล้วค่ะ รอเจ้าของกดอนุญาต — พออนุญาตแล้วระบบเชื่อมต่อให้อัตโนมัติ ไม่ต้องกดอะไรเพิ่ม'); }
          catch (err) { e.target.disabled = false; note(body, err.message); }
        });
      }
    });
    backButton(body, () => showPerson(p));
  }
  $('connectBtn').addEventListener('click', showConnect);

  // ---------- ตั้งค่าข้อมูลของฉัน (ดูจำนวนเนื้อหา + ตั้งส่วนตัว/ฟรี/เสียเงิน) ----------
  function statusText(c, block) {
    if (c.visibility === 'private') return 'ส่วนตัว — ไม่มีใครเห็น';
    return 'เปิดแชร์ · ค่าบริการ: ' + priceText(c, block);
  }

  async function showCategoryItems(c, back) {
    const body = openSheet('เนื้อหาในหมวด "' + c.name + '"');
    try {
      const r = await api('GET', '/api/connect/my-categories/' + c.id + '/items');
      if (!r.items.length) note(body, 'ยังไม่มีเนื้อหาในหมวดนี้');
      r.items.forEach((it) => {
        if (!it.created_at) { const nl = it.text.indexOf('\n'); pcard(body, '📖 ' + it.text.slice(0, nl), it.text.slice(nl + 1)); return; }   // คู่มือแพลตฟอร์ม: หัวข้อ + เนื้อหา
        pcard(body, new Date(it.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }), it.text);
      });
      if (r.items.length >= 30) note(body, 'แสดง 30 รายการล่าสุด');
    } catch (err) { note(body, err.message); }
    backButton(body, back || showDataSettings);
  }

  async function saveCategorySetting(c, visibility, priceType, price) {
    const warn = visibility === 'private'
      ? 'ตั้งหมวด "' + c.name + '" เป็นส่วนตัว?\nสิทธิ์ที่เคยอนุญาตให้คนอื่นไว้จะถูกตัดทันที'
      : 'เปิดหมวด "' + c.name + '" ให้คนอื่นเชื่อมต่อ (' + (visibility === 'free' ? 'ฟรี' : price + ' เครดิต/' + (priceType === 'hour' ? 'ชั่วโมง' : 'คำถาม')) + ')?\nคนอื่นจะเห็นชื่อหมวดและขอเข้าใช้ได้ แต่ต้องให้คุณกดอนุญาตก่อนทุกครั้ง';
    if (!confirm(warn)) return false;
    await api('POST', '/api/connect/category-setting', { category: c.name, visibility, priceType, price });
    return true;
  }

  // popup ยืนยันก่อนลบ: บอกชื่อหมวด จำนวนรายการ และว่ากู้คืนไม่ได้ — ต้องกดปุ่มแดงเองอีกครั้ง
  function confirmDeleteCategory(c, isMain, after) {
    const goBack = after || showDataSettings;
    const body = openSheet(isMain ? 'ยืนยันล้างเนื้อหาทั้งหมด?' : 'ยืนยันลบหมวดและเนื้อหาทั้งหมด?');
    note(body, '⚠️ หมวด "' + c.name + '" มี ' + c.items + ' รายการ\n' + (isMain ? 'เนื้อหาทั้งหมดในหมวดนี้จะถูกลบ (ตัวหมวดยังอยู่)' : 'ตัวหมวดและเนื้อหาทุกรายการจะถูกลบ (ถ้าเคยมีคนใช้หรือจ่ายเครดิตผ่านหมวดนี้ ระบบจะเก็บแค่ชื่อหมวดไว้เป็นประวัติ แต่ล้างเนื้อหาทั้งหมด)') + '\nและกู้คืนไม่ได้');
    miniBtn(body, '🗑️ ยืนยัน ลบเลย', async () => {
      try {
        const res = await api('DELETE', '/api/connect/my-categories/' + c.id);
        if (focusCategory && focusCategory.toLowerCase() === c.name.toLowerCase()) setFocus('');
        await goBack();
        addBubble('assistant', res.categoryRemoved ? 'ลบหมวด "' + c.name + '" และเนื้อหา ' + res.deletedMemories + ' รายการแล้วค่ะ' : 'ล้างเนื้อหาในหมวด "' + c.name + '" ' + res.deletedMemories + ' รายการแล้วค่ะ');
      } catch (err) { note(body, err.message); }
    }, 'danger');
    miniBtn(body, 'ยกเลิก', () => goBack());
  }

  async function showDataSettings() {
    const body = openSheet('ตั้งค่าข้อมูลของฉัน');
    let r;
    try { r = await api('GET', '/api/connect/my-categories'); } catch (err) { note(body, err.message); return; }
    note(body, 'แต่ละหมวดตั้งได้ว่าส่วนตัว ฟรี หรือคิดค่าบริการ (เครดิต) คนอื่นต้องขออนุญาตและคุณกดอนุญาตก่อนจึงจะใช้ข้อมูลได้' +
      (r.connectEnabled ? '' : '\n⚠️ ตอนนี้คุณปิด "อนุญาตใช้ข้อมูล" อยู่ ไม่มีใครเห็นหมวดของคุณ (เปิดได้ที่ปุ่ม 🔓 อนุญาตใช้ข้อมูล ข้างรูปโปรไฟล์)'));
    if (!r.categories.length) note(body, 'ยังไม่มีหมวด — บอกเลขาให้จำเรื่องต่างๆ แล้วหมวดจะมาอยู่ที่นี่');
    r.categories.forEach((c) => buildCategoryCard(body, c, r, () => showDataSettings(), () => showDataSettings(), () => showDataSettings()));
    if (r.categories.some((c) => c.visibility === 'free')) note(body, 'หมวดฟรี: ผู้ใช้ใช้ได้ครั้งละ ' + r.freeMinutes + ' นาทีหลังคุณอนุญาต แล้วระบบตัด ต้องขอใหม่');
  }

  // การ์ดตั้งค่า 1 หมวด (ส่วนตัว/ฟรี/เสียเงิน + ดูเนื้อหา + ล้าง/ลบ) — ใช้ทั้งหน้า "ตั้งค่าข้อมูล" และปุ่ม ⚙️ ในหน้าเลือกหัวข้อ
  // reload = วาดหน้านี้ใหม่หลังบันทึก • itemsBack = ปุ่มกลับจากหน้าดูเนื้อหา • afterDelete = กลับไปหน้าไหนหลังลบ/ล้าง
  function buildCategoryCard(body, c, r, reload, itemsBack, afterDelete) {
      const d = pcard(body, catIcon(c.name) + ' ' + c.name + '  · ' + c.items + ' รายการ', statusText(c, r.blockMinutes), mainCatClass(c.name));
      const row = document.createElement('div'); row.className = 'row2'; d.appendChild(row);
      miniBtn(row, 'ดูเนื้อหา', () => showCategoryItems(c, itemsBack));
      if (c.readonly) { const ro = document.createElement('small'); ro.style.color = 'var(--muted)'; ro.textContent = 'คู่มือของระบบ — อ่านอย่างเดียว ลบ/แก้/แชร์ไม่ได้ (ถามเลขาได้เลยว่าใช้งานอย่างไร)'; d.appendChild(ro); return; }
      miniBtn(row, 'ส่วนตัว', async () => { try { if (await saveCategorySetting(c, 'private')) reload(); } catch (err) { note(body, err.message); } }, c.visibility === 'private' ? 'ok' : '');
      miniBtn(row, 'ฟรี', async () => { try { if (await saveCategorySetting(c, 'free')) reload(); } catch (err) { note(body, err.message); } }, c.visibility === 'free' ? 'ok' : '');

      // เสียเงิน: เลือกหน่วย (ต่อชั่วโมง/ต่อคำถาม) + ราคาเป็นเครดิต
      const paidRow = document.createElement('div'); paidRow.className = 'row2'; d.appendChild(paidRow);
      const unit = document.createElement('select');
      [['hour', 'เครดิต / ชั่วโมง'], ['question', 'เครดิต / คำถาม']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; unit.appendChild(o); });
      unit.value = c.price_type || 'hour';
      const price = document.createElement('input'); price.type = 'number'; price.min = '1'; price.step = 'any'; price.placeholder = 'ราคา เช่น 150'; price.value = c.visibility === 'paid' && c.price_credits ? c.price_credits : '';
      paidRow.append(price, unit);
      const hint = document.createElement('small'); hint.style.color = 'var(--muted)';
      const showHint = () => { const v = Number(price.value); hint.textContent = unit.value === 'hour' && v > 0 ? 'คิดเป็นก้อนละ ' + r.blockMinutes + ' นาที ก้อนละ ' + (Math.round((v / 60) * r.blockMinutes * 100) / 100) + ' เครดิต' : 'เครดิต 1 = 1 บาท · แพลตฟอร์มหักส่วนแบ่งก่อนเข้ากระเป๋าคุณ'; };
      price.addEventListener('input', showHint); unit.addEventListener('change', showHint); showHint();
      d.appendChild(hint);
      const rowSave = document.createElement('div'); rowSave.className = 'row2'; d.appendChild(rowSave);
      miniBtn(rowSave, c.visibility === 'paid' ? '💾 บันทึกราคาใหม่' : '💰 ตั้งเป็นเสียเงิน', async () => {
        const v = Number(price.value);
        if (!(v > 0)) { note(body, 'ใส่ราคาเป็นตัวเลขมากกว่า 0 ก่อน'); return; }
        try { if (await saveCategorySetting(c, 'paid', unit.value, v)) reload(); } catch (err) { note(body, err.message); }
      }, c.visibility === 'paid' ? 'ok' : '');
      // ลบเนื้อหาทั้งหมดของหมวด (หมวดหลักลบตัวหมวดไม่ได้ ล้างได้เฉพาะเนื้อหา) — ต้องยืนยันก่อนเสมอ
      const isMain = c.name === 'ทั่วไป' || c.name === 'ความสามารถเลขา' || c.name === 'ข้อมูลแชท';
      const rowDel = document.createElement('div'); rowDel.className = 'row2'; d.appendChild(rowDel);
      miniBtn(rowDel, isMain ? '🗑️ ล้างเนื้อหาทั้งหมด' : '🗑️ ลบหมวดและเนื้อหาทั้งหมด', () => confirmDeleteCategory(c, isMain, afterDelete), 'danger');
  }

  // ตั้งค่าเฉพาะหมวดเดียว (เปิดจากปุ่ม ⚙️ ในหน้าเลือกหัวข้อการสนทนา)
  async function showCategorySettings(name, back) {
    const body = openSheet('ตั้งค่าหมวด "' + name + '"');
    let r;
    try { r = await api('GET', '/api/connect/my-categories'); } catch (err) { note(body, err.message); backButton(body, back); return; }
    const c = r.categories.find((x) => x.name === name);
    if (!c) { note(body, 'ไม่พบหมวดนี้'); backButton(body, back); return; }
    if (!r.connectEnabled) note(body, '⚠️ ตอนนี้คุณปิด "อนุญาตใช้ข้อมูล" อยู่ ไม่มีใครเห็นหมวดของคุณ (เปิดได้ที่ป้าย 🔓 อนุญาตใช้ข้อมูล บนหน้าหลัก)');
    buildCategoryCard(body, c, r, () => showCategorySettings(name, back), () => showCategorySettings(name, back), back);
    if (c.visibility === 'free') note(body, 'หมวดฟรี: ผู้ใช้ใช้ได้ครั้งละ ' + r.freeMinutes + ' นาทีหลังคุณอนุญาต แล้วระบบตัด ต้องขอใหม่');
    backButton(body, back);
  }

  // ปุ่ม "จำไว้ให้เลขา": เลือกหมวด (หรือพิมพ์ชื่อหมวดใหม่) แล้วสั่งให้เลขาสรุปบทสนทนานี้เก็บเข้าความจำ
  // เลือกหัวข้อการสนทนา: แตะชื่อหมวด = คุยต่อ/อัปเดตในหมวดนั้น • ⚙️ ตั้งค่า = ส่วนตัว/ฟรี/เสียเงินของหมวดนั้น • 🗑️ ลบ = ล้างเนื้อหา (หมวดหลัก 3 หมวดลบตัวหมวดไม่ได้) พร้อม popup ยืนยัน
  async function showTopicChooser() {
    const body = openSheet('เลือกหัวข้อที่จะคุยต่อ / อัปเดตข้อมูล');
    const go = (cat, count) => {
      closeSheet();
      setFocus(cat);
      addBubble('assistant', 'เลือกหมวด "' + cat + '" แล้วค่ะ' + (count ? ' ตอนนี้มีข้อมูลอยู่ ' + count + ' รายการ' : ' เป็นหมวดใหม่ค่ะ') + ' เล่าข้อมูลใหม่หรือเรื่องที่จะอัปเดตได้เลย เลขาจะถามยืนยันก่อนบันทึกค่ะ');
    };
    try {
      const r = await api('GET', '/api/connect/my-categories');
      r.categories.forEach((c) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:stretch;margin-bottom:8px';
        const main = sheetButton(row, catIcon(c.name) + ' ' + c.name + ' (' + c.items + ')', () => go(c.name, c.items), mainCatClass(c.name));
        main.style.flex = '1'; main.style.minWidth = '0';
        if (!c.readonly) {   // คู่มือแพลตฟอร์มอ่านอย่างเดียว ไม่มีตั้งค่า/ลบ
          const isMain = c.name === 'ทั่วไป' || c.name === 'ความสามารถเลขา' || c.name === 'ข้อมูลแชท';
          const st = sheetButton(row, '⚙️ ตั้งค่า', () => showCategorySettings(c.name, showTopicChooser)); st.style.padding = '8px 10px'; st.style.fontSize = '13px';
          const del = sheetButton(row, '🗑️ ' + (isMain ? 'ล้าง' : 'ลบ'), () => confirmDeleteCategory(c, isMain, showTopicChooser), 'danger'); del.style.padding = '8px 10px'; del.style.fontSize = '13px';
        }
        body.appendChild(row);
      });
    } catch (e) { /* โหลดหมวดไม่ได้ก็ยังเพิ่มหัวข้อใหม่ได้ */ }
    note(body, 'เพิ่มหัวข้อใหม่', 'sub');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 40; inp.placeholder = 'พิมพ์ชื่อหัวข้อใหม่ เช่น ฟาร์มกุ้ง แล้วกดเริ่มคุย';
    body.appendChild(inp);
    sheetButton(body, '✓ เพิ่มหัวข้อใหม่ และเริ่มคุย', () => {
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      go(v);
    });
  }
  $('saveMemoryBtn').addEventListener('click', () => { if (sending) return; showTopicChooser(); });

  // ---------- เปิดผ่านไลน์ (LIFF) ----------
  async function initLiff() {
    try {
      const cfg = await api('GET', '/api/line/config');
      if (!cfg.liffId || !window.liff) return null;
      await window.liff.init({ liffId: cfg.liffId });
      inLine = window.liff.isInClient();
      if (!inLine) return null;
      if (!window.liff.isLoggedIn()) { window.liff.login(); return 'redirect'; }
      try { const prof = await window.liff.getProfile(); liffPicture = prof && prof.pictureUrl ? prof.pictureUrl : null; } catch (e) { /* ไม่มีรูปก็แสดงตัวอักษรแทน */ }
      return window.liff.getIDToken() || null;
    } catch (e) {
      return null;
    }
  }

  // ---------- เปิดหน้าครั้งแรก ----------
  (async function init() {
    const token = await initLiff();
    if (token === 'redirect') return;
    lineIdToken = token;

    if (lineIdToken) {
      try {
        const r = await api('POST', '/api/auth/line', { idToken: lineIdToken });
        if (r.ok) return enterChat(r.user);
        showAuth();
        return;
      } catch (e) { /* ตรวจกับไลน์ไม่ผ่าน → ลองแบบปกติต่อ */ }
    }

    try {
      const { user } = await api('GET', '/api/auth/me');
      if (user) return enterChat(user);
    } catch (e) { /* เช็คไม่ได้ก็แสดงหน้าเข้าสู่ระบบ */ }
    showAuth();
  })();

  // กลับมาที่แท็บ: ขอ wake lock คืน (เบราว์เซอร์ปล่อยให้เองตอนซ่อนแท็บ)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (realtime || voiceMode)) lockScreen(); });
})();
