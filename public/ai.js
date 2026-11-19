// หน้า AI เลขา — เข้าสู่ระบบ/สมัคร + แชทกับเลขา (พิมพ์) ข้อมูลที่มาจากผู้ใช้/AI แสดงด้วย textContent เสมอ (กัน XSS)
(function () {
  const $ = (id) => document.getElementById(id);
  const authPage = $('authPage');
  const authView = $('authView');
  const chatView = $('chatView');
  const messagesEl = $('messages');
  const inputEl = $('input');
  const sendBtn = $('sendBtn');

  let mode = 'login';            // 'login' | 'register'
  let me = null;                 // ผู้ใช้ปัจจุบัน
  let conversationId = null;     // หัวข้อที่เปิดอยู่
  let sending = false;
  let lineIdToken = null;        // ID token จาก LIFF (มีเฉพาะตอนเปิดในไลน์) — ส่งไปผูกบัญชีตอนสมัคร/เข้าด้วย PIN

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
    me = null;
    conversationId = null;
    document.body.classList.remove('chat-mode');
    chatView.hidden = true;
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
      if (lineIdToken) body.idToken = lineIdToken; // เปิดจากไลน์: ให้ระบบผูกบัญชีไลน์นี้ให้อัตโนมัติ
      const data = await api('POST', '/api/auth/' + mode, body);
      await enterChat(data.user);
      if (data.line && !data.line.linked) addBubble('error', data.line.error); // ผูกไลน์ไม่สำเร็จ แจ้งให้รู้ (ยังใช้งานต่อได้)
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout'); } catch (e) { /* ออกจากหน้าจอต่อได้แม้เรียกไม่สำเร็จ */ }
    showAuth();
  });

  // ---------- แชท ----------
  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addSavedChip(category) {
    const chip = document.createElement('div');
    chip.className = 'chip-saved';
    chip.textContent = '✓ จำไว้แล้ว ในหมวด "' + category + '"';
    messagesEl.appendChild(chip);
    scrollToBottom();
  }

  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function showHint() {
    addBubble('hint', 'สวัสดี คุณ' + me.name + ' มีอะไรให้' + me.secretaryName + 'ช่วยไหม\nลองพิมพ์ เช่น "จำไว้ในหมวดฟาร์ม ว่าบ่อ 2 ปล่อยกุ้งวันที่ 5"');
  }

  async function openConversation(id) {
    conversationId = id;
    messagesEl.textContent = '';
    $('topicsPanel').hidden = true;
    try {
      const { conversation, messages } = await api('GET', '/api/chat/conversations/' + id + '/messages');
      $('chatTopic').textContent = conversation.title || 'หัวข้อใหม่';
      if (!messages.length) showHint();
      messages.forEach((m) => { if (m.role !== 'system') addBubble(m.role, m.content); });
    } catch (err) {
      addBubble('error', err.message);
    }
    inputEl.focus();
  }

  async function newConversation() {
    const { conversation } = await api('POST', '/api/chat/conversations', {});
    await openConversation(conversation.id);
  }

  async function enterChat(user) {
    me = user;
    authPage.hidden = true;
    authView.hidden = true;
    chatView.hidden = false;
    document.body.classList.add('chat-mode');
    $('chatSecretary').textContent = user.secretaryName;
    try {
      const { conversations } = await api('GET', '/api/chat/conversations');
      if (conversations.length) await openConversation(conversations[0].id);
      else await newConversation();
    } catch (err) {
      addBubble('error', err.message);
    }
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text || sending || !conversationId) return;
    sending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    autoGrow();
    addBubble('user', text);
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.textContent = me.secretaryName + ' กำลังพิมพ์...';
    messagesEl.appendChild(typing);
    scrollToBottom();
    try {
      const { reply, savedMemories } = await api('POST', '/api/chat/conversations/' + conversationId + '/messages', { content: text, source: 'text' });
      typing.remove();
      addBubble('assistant', reply);
      (savedMemories || []).forEach((m) => addSavedChip(m.category));
      if ($('chatTopic').textContent === 'หัวข้อใหม่') $('chatTopic').textContent = text.slice(0, 50);
    } catch (err) {
      typing.remove();
      addBubble('error', err.message);
      inputEl.value = text; // คืนข้อความให้แก้/ส่งใหม่ได้ ไม่ต้องพิมพ์ซ้ำ
      autoGrow();
    } finally {
      sending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }

  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', (e) => {
    // Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่ (ไม่ส่งตอนกำลังพิมพ์ภาษาไทยด้วย IME)
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  $('newTopicBtn').addEventListener('click', async () => {
    try { await newConversation(); } catch (err) { addBubble('error', err.message); }
  });

  $('topicsBtn').addEventListener('click', async () => {
    const panel = $('topicsPanel');
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.textContent = '';
    try {
      const { conversations } = await api('GET', '/api/chat/conversations');
      if (!conversations.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'ยังไม่มีหัวข้อ';
        panel.appendChild(empty);
      }
      conversations.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = c.title || 'หัวข้อใหม่';
        if (c.id === conversationId) b.className = 'current';
        b.addEventListener('click', () => openConversation(c.id));
        panel.appendChild(b);
      });
    } catch (err) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = err.message;
      panel.appendChild(e);
    }
    panel.hidden = false;
  });

  // ---------- เปิดผ่านไลน์ (LIFF) ----------
  // คืน ID token ถ้าเปิดอยู่ในไลน์, null ถ้าเปิดจากเบราว์เซอร์ปกติ/ยังไม่ได้ตั้งค่า LIFF, 'redirect' ถ้ากำลังพาไปล็อกอินไลน์
  async function initLiff() {
    try {
      const cfg = await api('GET', '/api/line/config');
      if (!cfg.liffId || !window.liff) return null;
      await window.liff.init({ liffId: cfg.liffId });
      if (!window.liff.isInClient()) return null; // เปิดนอกไลน์: ใช้เบอร์+PIN ตามปกติ ไม่บังคับ login ไลน์
      if (!window.liff.isLoggedIn()) { window.liff.login(); return 'redirect'; }
      return window.liff.getIDToken() || null;
    } catch (e) {
      return null; // LIFF มีปัญหา ไม่ให้พังทั้งหน้า ใช้เบอร์+PIN แทนได้
    }
  }

  // ---------- เปิดหน้าครั้งแรก ----------
  (async function init() {
    const token = await initLiff();
    if (token === 'redirect') return;
    lineIdToken = token;

    // เปิดจากไลน์: ให้ไลน์ยืนยันว่าเป็นใคร ถ้าเคยผูกบัญชีไว้ก็เข้าเลยโดยไม่ต้องกรอกอะไร
    if (lineIdToken) {
      try {
        const r = await api('POST', '/api/auth/line', { idToken: lineIdToken });
        if (r.ok) return enterChat(r.user);
        // r.needsLink = ยังไม่เคยผูก → แสดงฟอร์มสมัคร/เข้าด้วย PIN พร้อมข้อความอธิบาย (ด้านล่าง)
        showAuth();
        return;
      } catch (e) { /* ตรวจกับไลน์ไม่ผ่าน → ลองแบบปกติต่อ */ }
    }

    try {
      const { user } = await api('GET', '/api/auth/me');
      if (user) return enterChat(user);
    } catch (e) { /* เช็คไม่ได้ก็แสดงหน้าเข้าสู่ระบบตามปกติ */ }
    showAuth();
  })();
})();
