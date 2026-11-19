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

  // ---------- สถานะบอท ----------
  const STATE_TEXT = { idle: 'พร้อมคุยค่ะ', thinking: 'เลขากำลังคิด...', speaking: 'เลขากำลังพูด...', listening: 'กำลังฟังอยู่ค่ะ...' };
  let botState = 'idle';
  function setBotState(s) {
    botState = s;
    botStage.className = 'state-' + s;
    $('stateLabel').textContent = STATE_TEXT[s] || '';
    const bot = $('bot');
    if (bot) bot.autoRotate = (s === 'idle');
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
  function openExternal() {
    try { window.liff.openWindow({ url: location.origin + '/', external: true }); }
    catch (e) { addBubble('error', 'เปิดอัตโนมัติไม่ได้ — คัดลอกลิงก์ ' + location.origin + ' ไปวางใน Chrome เองได้ค่ะ'); }
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
    try {
      const { conversations } = await api('GET', '/api/chat/conversations');
      if (conversations.length) await openConversation(conversations[0].id);
      else await newConversation();
    } catch (err) {
      addBubble('error', err.message);
    }
  }

  // ---------- ส่งข้อความ ----------
  async function send(text, source) {
    text = (text || '').trim();
    if (!text || sending || !conversationId) return false;
    sending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    cancelSpeech();
    addBubble('user', text);
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.textContent = me.secretaryName + ' กำลังพิมพ์...';
    logEl.appendChild(typing);
    scrollToBottom();
    setBotState('thinking');
    let replyText = null;
    try {
      const { reply, savedMemories } = await api('POST', '/api/chat/conversations/' + conversationId + '/messages', { content: text, source: source || 'text' });
      typing.remove();
      addBubble('assistant', reply);
      (savedMemories || []).forEach((m) => addSavedChip(m.category));
      replyText = reply;
    } catch (err) {
      typing.remove();
      addBubble('error', err.message);
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
  function cleanForSpeech(t) {
    return String(t)
      .replace(/[*_`#>~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ').trim();
  }
  function chunkText(t) {
    const parts = t.split(/(?<=[.!?。！？\n])\s*|\s{2,}/).filter(Boolean);
    const out = [];
    let cur = '';
    for (const p of parts) {
      if ((cur + ' ' + p).length > 160 && cur) { out.push(cur); cur = p; } else { cur = cur ? cur + ' ' + p : p; }
    }
    if (cur) out.push(cur);
    return out;
  }
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
    const b = $('realtimeMicToggle');
    b.textContent = realtime ? '🎙️ โหมดเรียลไทม์' : '🎙️ โหมดปกติ';
    b.classList.toggle('on', realtime);
  }

  $('realtimeMicToggle').addEventListener('click', () => {
    realtime = !realtime;
    if (realtime) {
      if (ttsSupported) unlockSpeech();
      lockScreen();
      renderMic();
      if (!sending && botState === 'idle') startListening();
    } else {
      unlockScreen();
      stopRecording(true);
      renderMic();
    }
  });

  $('micBtn').addEventListener('click', () => {
    if (rec) { stopRecording(false); return; }  // กดซ้ำ = หยุดอัดและส่งเลย
    if (ttsSupported) unlockSpeech();
    cancelSpeech();
    startListening();
  });

  function stopAllVoice() {
    realtime = false;
    unlockScreen();
    cancelSpeech();
    stopRecording(true);
    renderMic();
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      addBubble('error', 'เปิดไมโครโฟนไม่ได้ (ยังไม่ได้อนุญาต หรือเบราว์เซอร์ในไลน์ไม่รองรับ) — ลองเปิดในเบราว์เซอร์ปกติ หรือพิมพ์แทนได้ค่ะ');
      addBrowserButton();
      realtime = false; unlockScreen(); renderMic();
      return;
    }
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
        // เรียลไทม์: ไม่มีใครพูดเลยก็หยุดฟัง ไม่วนฟังเปล่าๆ ไม่สิ้นสุด
        if (realtime && !state.cancelled) { realtime = false; unlockScreen(); renderMic(); }
        return;
      }
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
    try { state.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
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
    try {
      const audio = await blobToBase64(blob);
      const { text } = await api('POST', '/api/chat/transcribe', { audio, mimeType: blob.type || 'audio/webm' });
      if (!text || !text.trim()) {
        setBotState('idle');
        addBubble('hint', 'ไม่ได้ยินเสียงชัดๆ ค่ะ ลองพูดใหม่อีกครั้งนะคะ');
        if (realtime) startListening();
        return;
      }
      await send(text, 'voice');
    } catch (err) {
      setBotState('idle');
      addBubble('error', err.message);
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
    const body = openSheet(me ? me.name + ' · ' + me.secretaryName : 'เมนู');
    sheetButton(body, '➕ เริ่มหัวข้อใหม่', async () => { try { await newConversation(); } catch (err) { addBubble('error', err.message); } });
    sheetButton(body, '🗂️ หัวข้อที่เคยคุย', showTopics);
    if (inLine) sheetButton(body, '🌐 เปิดในเบราว์เซอร์ (ใช้เสียงได้ครบ)', () => { closeSheet(); openExternal(); });
    sheetButton(body, '🚪 ออกจากระบบ', async () => {
      closeSheet();
      try { await api('POST', '/api/auth/logout'); } catch (e) { /* ออกต่อได้แม้เรียกไม่สำเร็จ */ }
      showAuth();
    }, 'danger');
  });

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
