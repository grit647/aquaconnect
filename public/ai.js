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
    refreshConnectBadge();
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
      const { reply, savedMemories } = await api('POST', '/api/chat/conversations/' + conversationId + '/messages', { content: text, source: source || 'text', askRequestId: connected ? connected.requestId : undefined });
      typing.remove();
      addBubble('assistant', reply);
      (savedMemories || []).forEach((m) => addSavedChip(m.category));
      replyText = reply;
    } catch (err) {
      typing.remove();
      addBubble('error', err.message);
      if (connected && /หมดเวลา|ถอนสิทธิ์|ปิดรับ|ไม่ได้รับอนุมัติ/.test(err.message)) endConnected(true);
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
    sheetButton(body, '💰 เครดิต / เติมเงิน', showCredits);
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
    b.textContent = '🔗 เชื่อมต่อ: ' + (open ? 'เปิด' : 'ปิด');
    b.classList.toggle('on', open);
    b.classList.toggle('off', !open);
  }
  $('connToggle').addEventListener('click', async () => {
    const next = !connectOpen;
    if (!next && !confirm('ปิดรับการเชื่อมต่อข้อมูลชั่วคราว?\nจะไม่มีใครขอหรือใช้ข้อมูลของคุณได้ (สิทธิ์ที่เคยอนุญาตไว้ยังอยู่ เปิดใหม่แล้วใช้ต่อได้)')) return;
    try {
      const r = await api('POST', '/api/connect/enabled', { enabled: next });
      renderConnToggle(r.connectEnabled);
      addBubble('hint', r.connectEnabled
        ? 'เปิดรับการเชื่อมต่อข้อมูลแล้วค่ะ คนอื่นขอและใช้ข้อมูลในหมวดที่คุณเปิดแชร์ไว้ได้'
        : 'ปิดรับการเชื่อมต่อข้อมูลแล้วค่ะ ตอนนี้ไม่มีใครขอหรือใช้ข้อมูลของคุณได้ (สิทธิ์เดิมยังอยู่)');
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
      $('connectBtn').textContent = '🔗 เชื่อมต่อข้อมูล' + (n ? ' (' + n + ')' : '');
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
    addBubble('hint', 'ครบเวลาใช้ข้อมูลฟรี ตัดการเชื่อมต่อ' + who + ' แล้วค่ะ ถ้าจะใช้ต่อ กด "เชื่อมต่อข้อมูล" แล้วขอเข้าใช้ใหม่อีกครั้ง');
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
    const body = openSheet('เชื่อมต่อข้อมูล');
    let mine; let people;
    try { [mine, people] = await Promise.all([api('GET', '/api/connect/mine'), api('GET', '/api/connect/people')]); }
    catch (err) { note(body, err.message); return; }
    const pending = mine.incoming.filter((r) => r.status === 'pending');
    $('connectBtn').textContent = '🔗 เชื่อมต่อข้อมูล' + (pending.length ? ' (' + pending.length + ')' : '');

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
      if (p.open === false) sheetButton(body, '👤 ' + p.name + '  · ปิดรับการเชื่อมต่อชั่วคราว', () => { note(body, 'คุณ' + p.name + ' ปิดรับการเชื่อมต่อข้อมูลไว้ชั่วคราวค่ะ'); }, 'dim');
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
