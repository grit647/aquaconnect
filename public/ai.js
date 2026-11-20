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
  function renderAvatar() { avatarContent($('avatar')); }

  // ---------- สถานะบอท ----------
  const STATE_TEXT = { idle: 'พร้อมคุยค่ะ', thinking: 'เลขากำลังคิด...', speaking: 'เลขากำลังพูด...', listening: 'กำลังฟังอยู่ค่ะ...' };
  let botState = 'idle';
  function setBotState(s) {
    botState = s;
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
    div.textContent = text;
    logEl.appendChild(div);
    scrollToBottom();
    return div;
  }
  function addSavedChip(category) {
    const chip = document.createElement('div');
    chip.className = 'chip-saved';
    chip.textContent = '✓ จำไว้แล้ว ในหมวด "' + category + '"';
    logEl.appendChild(chip);
    scrollToBottom();
  }
  // ปุ่ม "เปิดในเบราว์เซอร์" — ใช้เมื่อฟีเจอร์เสียง/ไมค์ใช้ในเบราว์เซอร์ของไลน์ไม่ได้
  async function openExternal() {
    try {
      // ขอลิงก์เข้าสู่ระบบครั้งเดียว (อายุ 2 นาที) เพื่อให้ Chrome เข้าบัญชีเดียวกันทันที ไม่ต้องกรอก PIN ซ้ำ
      const { url } = await api('POST', '/api/auth/login-link');
      window.liff.openWindow({ url, external: true });
    } catch (e) { addBubble('error', 'เปิดอัตโนมัติไม่ได้ — คัดลอกลิงก์ ' + location.origin + ' ไปวางใน Chrome เองได้ค่ะ'); }
  }
  function addBrowserButton() {
    if (!inLine) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'open-ext';
    b.textContent = '🌐 เปิดในเบราว์เซอร์ (Chrome)';
    b.addEventListener('click', openExternal);
    logEl.appendChild(b);
    scrollToBottom();
  }
  function scrollToBottom() { logEl.scrollTop = logEl.scrollHeight; }

  function showHint() {
    addBubble('hint', 'สวัสดีค่ะ คุณ' + me.name + ' มีอะไรให้' + me.secretaryName + 'ช่วยไหมคะ\nพิมพ์ หรือกดไมค์🎤 แล้วพูดได้เลย เช่น "จำไว้ในหมวดฟาร์ม ว่าบ่อ 2 ปล่อยกุ้งวันที่ 5"');
  }

  async function openConversation(id) {
    conversationId = id;
    logEl.textContent = '';
    closeSheet();
    try {
      const { messages } = await api('GET', '/api/chat/conversations/' + id + '/messages');
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

  // ---------- ส่งข้อความ ----------
  async function send(text, source) {
    text = (text || '').trim();
    if ((!text && !pendingFiles.length) || sending || !conversationId) return false;
    if (connected && pendingFiles.length) { addBubble('error', 'โหมดใช้ข้อมูลของคนอื่นแนบไฟล์ไม่ได้ — กด "จบการใช้ข้อมูล" ก่อน หรือเอาไฟล์ออกค่ะ'); return false; }
    const files = pendingFiles.slice();
    if (!text) text = 'ช่วยอ่านสิ่งที่แนบให้หน่อย';
    sending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
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
      const { reply, savedMemories, createdEvents } = await api('POST', '/api/chat/conversations/' + conversationId + '/messages', { content: text, source: source || 'text', askRequestId: connected ? connected.requestId : undefined, attachments: files.length ? files : undefined });
      typing.remove();
      addBubble('assistant', reply);
      (savedMemories || []).forEach((m) => addSavedChip(m.category));
      (createdEvents || []).forEach(addEventChip);
      replyText = reply;
      if (voiceMode) vCaption(null, reply);
      if (files.length) { pendingFiles = []; renderTray(); }
    } catch (err) {
      typing.remove();
      addBubble('error', err.message);
      if (voiceMode) vCaption(null, err.message);
      if (connected && /หมดเวลา|ถอนสิทธิ์|ปิดรับ|ปิดการอนุญาต|ไม่ได้รับอนุมัติ/.test(err.message)) endConnected(true);
      if (source !== 'voice') inputEl.value = text;
    } finally {
      sending = false;
      sendBtn.disabled = false;
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

  $('inputBar').addEventListener('submit', (e) => { e.preventDefault(); send(inputEl.value, 'text'); });

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
  function unlockSpeech() { // มือถือบางเครื่องต้องให้ผู้ใช้แตะก่อนถึงจะพูดได้
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }
  function cancelSpeech() {
    speechToken++;
    if (ttsSupported) window.speechSynthesis.cancel();
  }
  // การเตรียมข้อความก่อนอ่านออกเสียง (ทศนิยม "0.25" → "0 จุด 25", เดือนย่อ "พ.ย." → "พฤศจิกายน", ตัด markdown/อีโมจิ)
  // อยู่ที่ speech.js (ไฟล์เดียวกับที่ชุดทดสอบใช้)
  const cleanForSpeech = (t) => window.aqSpeech.forSpeech(t);
  const chunkText = (t) => window.aqSpeech.chunkText(t);
  function speak(text, done) {
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
    try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ไม่รองรับก็ข้าม */ }
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
    if (user !== null) $('vUser').textContent = user;
    if (reply !== null) $('vReply').textContent = String(reply).replace(/[*_`#]/g, '');
  }

  async function enterVoiceMode(startPaused) {
    if (!me) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      addBubble('error', 'เบราว์เซอร์นี้ยังอัดเสียงไม่ได้ — เปิดในเบราว์เซอร์ปกติ หรือพิมพ์แทนได้ค่ะ');
      addBrowserButton();
      return;
    }
    stopRecording(true); cancelSpeech();
    voiceMode = true; voicePaused = !!startPaused; idleCycles = 0; realtime = !startPaused;
    $('voiceScreen').hidden = false;
    vCaption('', '');
    if (ttsSupported) unlockSpeech();
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
    if (ttsSupported) unlockSpeech();
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
    cleanupPip(); pipMicLost = false;
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
    if (!pipSupported()) { alert('เบราว์เซอร์นี้ยังไม่รองรับหน้าต่างลอย (Picture-in-Picture) — ลองเปิดด้วย Chrome ในมือถือ/คอมพิวเตอร์'); return; }
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
      $('vHint').textContent = 'หน้าต่างลอยทำงานอยู่ — ถ้าออกจากแอปแล้วเลขาไม่ได้ยิน แปลว่ามือถือพักไมค์ไว้ ให้กลับมาที่แอปเพื่อคุยต่อ';
    } catch (e) {
      cleanupPip();
      alert('เปิดหน้าต่างลอยไม่ได้: ' + (e && e.message ? e.message : e));
    }
  }
  $('vPip').addEventListener('click', togglePip);
  if (pipSupported()) $('vPip').hidden = false;

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

  async function transcribeAndSend(blob) {
    setBotState('thinking');
    $('stateLabel').textContent = 'กำลังถอดเสียง...';
    if (voiceMode && !voicePaused) $('vState').textContent = 'กำลังถอดเสียง...';
    try {
      const audio = await blobToBase64(blob);
      const { text } = await api('POST', '/api/chat/transcribe', { audio, mimeType: blob.type || 'audio/webm' });
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

  $('menuBtn').addEventListener('click', () => {
    const body = openSheet('เมนู');
    if (me) {
      const head = document.createElement('div'); head.className = 'menu-head';
      const av = document.createElement('div'); av.className = 'av'; avatarContent(av);
      const who = document.createElement('div'); who.className = 'who';
      const nm = document.createElement('b'); nm.textContent = me.name; const sm = document.createElement('small'); sm.textContent = 'เลขา: ' + me.secretaryName;
      who.append(nm, sm); head.append(av, who); body.appendChild(head);
    }
    sheetButton(body, '➕ เริ่มหัวข้อใหม่', async () => { try { await newConversation(); } catch (err) { addBubble('error', err.message); } });
    sheetButton(body, '🗂️ หัวข้อที่เคยคุย', showTopics);
    sheetButton(body, '📅 ปฏิทิน & เตือน' + (dueCount ? ' (' + dueCount + ')' : ''), () => { closeSheet(); openCal(); });
    sheetButton(body, '🎙️ คุยด้วยเสียงต่อเนื่อง (ใช้กับหูฟังบลูทูธ)', () => { closeSheet(); enterVoiceMode(false); });
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
    info.ledger.slice(0, 5).forEach((l) => note(body, (l.amount > 0 ? '+' : '') + l.amount + '  ' + (LEDGER_LABEL[l.type] || l.type) + (l.note ? ' (' + l.note + ')' : ''), 'ledger'));

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

  function pcard(body, title, sub) {
    const d = document.createElement('div'); d.className = 'pcard';
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

  async function showCategoryItems(c) {
    const body = openSheet('เนื้อหาในหมวด "' + c.name + '"');
    try {
      const r = await api('GET', '/api/connect/my-categories/' + c.id + '/items');
      if (!r.items.length) note(body, 'ยังไม่มีเนื้อหาในหมวดนี้');
      r.items.forEach((it) => pcard(body, new Date(it.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }), it.text));
      if (r.items.length >= 30) note(body, 'แสดง 30 รายการล่าสุด');
    } catch (err) { note(body, err.message); }
    backButton(body, showDataSettings);
  }

  async function saveCategorySetting(c, visibility, priceType, price) {
    const warn = visibility === 'private'
      ? 'ตั้งหมวด "' + c.name + '" เป็นส่วนตัว?\nสิทธิ์ที่เคยอนุญาตให้คนอื่นไว้จะถูกตัดทันที'
      : 'เปิดหมวด "' + c.name + '" ให้คนอื่นเชื่อมต่อ (' + (visibility === 'free' ? 'ฟรี' : price + ' เครดิต/' + (priceType === 'hour' ? 'ชั่วโมง' : 'คำถาม')) + ')?\nคนอื่นจะเห็นชื่อหมวดและขอเข้าใช้ได้ แต่ต้องให้คุณกดอนุญาตก่อนทุกครั้ง';
    if (!confirm(warn)) return false;
    await api('POST', '/api/connect/category-setting', { category: c.name, visibility, priceType, price });
    return true;
  }

  async function showDataSettings() {
    const body = openSheet('ตั้งค่าข้อมูลของฉัน');
    let r;
    try { r = await api('GET', '/api/connect/my-categories'); } catch (err) { note(body, err.message); return; }
    note(body, 'แต่ละหมวดตั้งได้ว่าส่วนตัว ฟรี หรือคิดค่าบริการ (เครดิต) คนอื่นต้องขออนุญาตและคุณกดอนุญาตก่อนจึงจะใช้ข้อมูลได้' +
      (r.connectEnabled ? '' : '\n⚠️ ตอนนี้คุณปิด "อนุญาตใช้ข้อมูล" อยู่ ไม่มีใครเห็นหมวดของคุณ (เปิดได้ที่ปุ่ม 🔓 อนุญาตใช้ข้อมูล ข้างรูปโปรไฟล์)'));
    if (!r.categories.length) note(body, 'ยังไม่มีหมวด — บอกเลขาให้จำเรื่องต่างๆ แล้วหมวดจะมาอยู่ที่นี่');
    r.categories.forEach((c) => {
      const d = pcard(body, c.name + '  · ' + c.items + ' รายการ', statusText(c, r.blockMinutes));
      const row = document.createElement('div'); row.className = 'row2'; d.appendChild(row);
      const reload = () => showDataSettings();
      miniBtn(row, 'ดูเนื้อหา', () => showCategoryItems(c));
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
    });
    if (r.categories.some((c) => c.visibility === 'free')) note(body, 'หมวดฟรี: ผู้ใช้ใช้ได้ครั้งละ ' + r.freeMinutes + ' นาทีหลังคุณอนุญาต แล้วระบบตัด ต้องขอใหม่');
  }

  // ปุ่ม "จำไว้ให้เลขา": เลือกหมวด (หรือพิมพ์ชื่อหมวดใหม่) แล้วสั่งให้เลขาสรุปบทสนทนานี้เก็บเข้าความจำ
  $('saveMemoryBtn').addEventListener('click', async () => {
    if (sending) return;
    const body = openSheet('จำสาระสำคัญของบทสนทนานี้ไว้ในหมวดไหน?');
    const go = (cat) => {
      closeSheet();
      send('สรุปสาระสำคัญของหัวข้อที่เราคุยกันนี้ แล้วจำไว้ให้ในหมวด "' + cat + '"', 'text');
    };
    try {
      const { categories } = await api('GET', '/api/chat/categories');
      categories.forEach((c) => sheetButton(body, '📁 ' + c.name + ' (' + c.memories + ')', () => go(c.name)));
    } catch (e) { /* โหลดหมวดไม่ได้ก็ยังตั้งหมวดใหม่ได้ */ }
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 60; inp.placeholder = 'หรือพิมพ์ชื่อหมวดใหม่ แล้วกดตกลง';
    body.appendChild(inp);
    sheetButton(body, '✓ ตกลง จำไว้เลย', () => {
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      go(v);
    });
  });

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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && realtime) lockScreen(); });
})();
