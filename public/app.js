// หน้า UI เริ่มต้น — เมนูมือถือพับ/กาง + popup รายละเอียดการ์ดฟีเจอร์
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('mainNav').classList.toggle('open');
});

// ข้อมูลเต็มของแต่ละการ์ด (การ์ดบนหน้าแสดงแค่ไอคอน+หัวข้อ กดแล้วเด้ง popup นี้)
const CARD_DETAILS = {
  ad1: {
    icon: '📢', badge: 'พื้นที่โฆษณา', title: 'พื้นที่สำหรับผู้ค้า 1',
    desc: 'ตำแหน่งโฆษณาสินค้า/บริการจากผู้ค้าปัจจัยการผลิต แสดงให้เกษตรกรที่ใช้งานจริงเห็น',
    buttons: [{ text: 'สนใจลงโฆษณา', href: '#advertise', style: 'ghost' }],
  },
  ad2: {
    icon: '📢', badge: 'พื้นที่โฆษณา', title: 'พื้นที่สำหรับผู้ค้า 2',
    desc: 'ตำแหน่งโฆษณาสินค้า/บริการจากผู้ค้าปัจจัยการผลิต แสดงให้เกษตรกรที่ใช้งานจริงเห็น',
    buttons: [{ text: 'สนใจลงโฆษณา', href: '#advertise', style: 'ghost' }],
  },
  ad3: {
    icon: '📢', badge: 'พื้นที่โฆษณา', title: 'พื้นที่สำหรับผู้ค้า 3',
    desc: 'ตำแหน่งโฆษณาสินค้า/บริการจากผู้ค้าปัจจัยการผลิต แสดงให้เกษตรกรที่ใช้งานจริงเห็น',
    buttons: [{ text: 'สนใจลงโฆษณา', href: '#advertise', style: 'ghost' }],
  },
  farm: {
    icon: '📊', badge: 'ใช้งานหลัก', title: 'จัดการการเลี้ยง',
    desc: 'บันทึกข้อมูลรายวัน ติดตามคุณภาพน้ำ อาหาร และวิเคราะห์ผลการเลี้ยงแบบเรียลไทม์',
    list: [
      'กรอกข้อมูลรายวัน (pH, ALK, แคลเซียม ฯลฯ)',
      'ติดตามคุณภาพน้ำ/ไนโตรเจน',
      'บันทึกการให้อาหาร คำนวณ FCR',
      'กราฟวิเคราะห์แนวโน้ม',
    ],
    buttons: [{ text: 'เริ่มใช้งาน', href: '#farm-start', style: 'primary' }],
  },
  info: {
    icon: '📚', title: 'ข้อมูล',
    desc: 'ความรู้/ข่าวสารวงการสัตว์น้ำ เทคนิคการเลี้ยง สถานการณ์ตลาด อัปเดตสม่ำเสมอ',
    buttons: [{ text: '➕ เพิ่มข้อมูล', href: '#add-info', style: 'ghost' }],
  },
  larvae: {
    icon: '🐚', title: 'ขายลูกกุ้ง',
    desc: 'ตลาดซื้อขายลูกพันธุ์กุ้ง เชื่อมฟาร์มอนุบาลกับเกษตรกรโดยตรง',
    buttons: [
      { text: '➕ เพิ่มข้อมูล', href: '#add-larvae', style: 'ghost' },
      { text: '🛒 จอง/สั่งซื้อ', href: '#order-larvae', style: 'primary' },
    ],
  },
  suppliers: {
    icon: '🧪', title: 'ปัจจัยการผลิต',
    desc: 'ไดเรกทอรีร้านค้าอาหารสัตว์น้ำ เคมีภัณฑ์ และอุปกรณ์การเลี้ยงที่เชื่อถือได้',
    buttons: [
      { text: '➕ เพิ่มข้อมูล', href: '#add-supplier', style: 'ghost' },
      { text: '🛒 จอง/สั่งซื้อ', href: '#order-supplier', style: 'primary' },
    ],
  },
  community: {
    icon: '💬', title: 'ชุมชนผู้เลี้ยง',
    desc: 'พูดคุย ถามตอบ แชร์ประสบการณ์ ประกาศซื้อ-ขาย กับเกษตรกรคนอื่นๆ เหมือนโพสต์บนโซเชียล',
    buttons: [{ text: 'เข้าชุมชน →', href: 'community.html', style: 'primary' }],
  },
};

function openCardModal(key) {
  const data = CARD_DETAILS[key];
  if (!data) return;

  const badgeEl = document.getElementById('modalBadge');
  if (data.badge) {
    badgeEl.textContent = data.badge;
    badgeEl.style.display = 'inline-block';
  } else {
    badgeEl.style.display = 'none';
  }

  document.getElementById('modalIcon').textContent = data.icon;
  document.getElementById('modalTitle').textContent = data.title;
  document.getElementById('modalDesc').textContent = data.desc;

  const listEl = document.getElementById('modalList');
  listEl.innerHTML = '';
  if (data.list && data.list.length) {
    data.list.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      listEl.appendChild(li);
    });
    listEl.style.display = 'flex';
  } else {
    listEl.style.display = 'none';
  }

  const btnRow = document.getElementById('modalButtons');
  btnRow.innerHTML = '';
  (data.buttons || []).forEach((btn) => {
    const a = document.createElement('a');
    a.href = btn.href;
    a.className = `btn btn-${btn.style} feature-card-btn`;
    a.textContent = btn.text;
    btnRow.appendChild(a);
  });

  document.getElementById('cardModal').style.display = 'flex';
}

function closeCardModal() {
  document.getElementById('cardModal').style.display = 'none';
}

document.querySelectorAll('.feature-card-compact').forEach((card) => {
  card.addEventListener('click', () => openCardModal(card.dataset.card));
});

// หน้าอื่น (เช่น community.html) ไม่มี popup นี้ กันพังด้วยการเช็คก่อน
const modalCloseBtn = document.getElementById('modalCloseBtn');
const cardModalEl = document.getElementById('cardModal');
if (modalCloseBtn && cardModalEl) {
  modalCloseBtn.addEventListener('click', closeCardModal);
  cardModalEl.addEventListener('click', (e) => {
    if (e.target.id === 'cardModal') closeCardModal(); // คลิกพื้นหลังมืดๆ ปิด popup ได้ด้วย
  });
}

// ============================================================
// เข้าสู่ระบบ / สมัครสมาชิก — ออกแบบหน้าตา UI เท่านั้น ยังไม่มี backend จริง
// เลือกหมวดหมู่ได้สูงสุด 2 หมวด, สมัครปุ๊บใช้งานได้เลย, รหัสผ่านเป็น PIN ตัวเลข 6 หลัก
// ============================================================

const PROVINCES = [
  'กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา',
  'ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก',
  'นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน',
  'บึงกาฬ','บุรีรัมย์','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา',
  'พะเยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต',
  'มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี',
  'ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ',
  'สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี',
  'สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี',
  'อุตรดิตถ์','อุทัยธานี','อุบลราชธานี',
];

// ข้อมูลหมวดหมู่ผู้ใช้ 5 แบบ (แอดมินไม่อยู่ในนี้ — ไม่เปิดให้สมัครเอง) +
// ฟิลด์เพิ่มเติมเฉพาะหมวด (ต่อยอดจากคอลัมน์ Users sheet: id, role, name, phone, email, province, registeredDate, status)
const ROLES = {
  farmer: {
    label: 'เกษตรกร', icon: '🧑‍🌾',
    desc: 'ผู้เลี้ยงกุ้ง/ปลา ใช้งานจัดการการเลี้ยง ซื้อลูกพันธุ์ โพสต์ชุมชน',
    fields: [
      { key: 'farmerSpecies', label: 'ชนิดที่เลี้ยง', type: 'select', options: ['กุ้ง', 'ปลา', 'อื่นๆ'] },
      { key: 'farmerPondCount', label: 'จำนวนบ่อ / ขนาดฟาร์ม', type: 'text', placeholder: 'เช่น 5 บ่อ, 10 ไร่' },
    ],
  },
  supplier: {
    label: 'ผู้ค้าปัจจัย', icon: '🧪',
    desc: 'ผู้ขายอาหาร/เคมีภัณฑ์/อุปกรณ์/ลูกพันธุ์',
    fields: [
      { key: 'supplierShopName', label: 'ชื่อร้าน / บริษัท', type: 'text', placeholder: 'เช่น ร้านอาหารกุ้งใจดี' },
      { key: 'supplierCategory', label: 'ประเภทสินค้าที่ขาย', type: 'checkboxGroup',
        options: ['อาหารสัตว์น้ำ', 'เคมีภัณฑ์', 'อุปกรณ์การเลี้ยง', 'ลูกพันธุ์'] },
    ],
  },
  general: {
    label: 'ทั่วไป', icon: '👤',
    desc: 'ดูข้อมูล เข้าชุมชน โพสต์/คอมเมนต์ได้ตามปกติ',
    fields: [],
  },
  reporter: {
    label: 'ผู้ลงข้อมูล', icon: '📝',
    desc: 'ลงราคา/ข่าวสาร/กิจกรรมให้ชุมชนเห็น',
    fields: [
      { key: 'reporterOrg', label: 'หน่วยงาน / สังกัด (ถ้ามี)', type: 'text', optional: true },
      { key: 'reporterScope', label: 'ขอบเขตข้อมูลที่จะลง', type: 'checkboxGroup',
        options: ['ราคากุ้ง/ปลา', 'ข่าวสาร', 'กิจกรรม'] },
    ],
  },
  academic: {
    label: 'นักวิชาการ', icon: '🎓',
    desc: 'ผู้เชี่ยวชาญ ให้ความรู้/ตอบคำถามเชิงวิชาการ',
    fields: [
      { key: 'academicOrg', label: 'หน่วยงาน / สถาบัน', type: 'text' },
      { key: 'academicField', label: 'สาขาความเชี่ยวชาญ', type: 'text' },
    ],
  },
};
const ROLE_MAX_SELECT = 2;

// บทบาท "แอดมิน" ไม่เปิดให้สมัครเอง (ไม่อยู่ใน ROLES) แต่ยังต้องมี meta ไว้โชว์ผลหลัง login
const ADMIN_META = { label: 'แอดมิน', icon: '🛡️', desc: 'ผู้ดูแลระบบ' };
function getRoleMeta(key) {
  return ROLES[key] || (key === 'admin' ? ADMIN_META : { label: key, icon: '👤', desc: '' });
}

// เรียก API backend จริง (register/login/logout/me) — คุกกี้ session แนบไปอัตโนมัติ
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore: response ไม่มี body */ }
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
  return data;
}
async function apiGet(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  return res.json();
}

// เก็บค่าจากฟิลด์เพิ่มเติมตามหมวด (ที่ renderFieldHtml สร้างไว้) เป็น { roleKey: { fieldKey: value } }
function collectRoleDetails() {
  const details = {};
  authState.selectedRoles.forEach((roleKey) => {
    const r = ROLES[roleKey];
    if (!r.fields.length) return;
    const roleData = {};
    r.fields.forEach((f) => {
      const id = `f_${roleKey}_${f.key}`;
      if (f.type === 'checkboxGroup') {
        roleData[f.key] = Array.from(document.querySelectorAll(`#${id} input[type="checkbox"]:checked`)).map((c) => c.value);
      } else {
        const el = document.getElementById(id);
        roleData[f.key] = el ? el.value.trim() : '';
      }
    });
    details[roleKey] = roleData;
  });
  return details;
}

const authModalEl = document.getElementById('authModal');
const authModalContentEl = document.getElementById('authModalContent');
const authModalCloseBtn = document.getElementById('authModalCloseBtn');
const loginNavBtn = document.getElementById('loginNavBtn');

// สถานะชั่วคราวในหน้าเว็บเท่านั้น (ไม่มี backend — รีเฟรชหน้าแล้วหายเหมือนเดิม)
const authState = {
  selectedRoles: [],       // ตอนสมัคร: หมวดที่เลือก (สูงสุด 2)
  loggedInUser: null,      // { name, roles: [...], activeRole } หลัง "เข้าสู่ระบบ" สำเร็จ
};

function provinceOptionsHtml(selected) {
  return PROVINCES.map((p) => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
}

function openAuthModal(view) {
  if (!authModalEl) return;
  authModalEl.style.display = 'flex';
  renderAuthView(view || 'login');
}
function closeAuthModal() {
  if (!authModalEl) return;
  authModalEl.style.display = 'none';
}

function renderAuthView(view, opts) {
  if (view === 'login') return renderLoginView();
  if (view === 'registerRoles') return renderRegisterRolesView();
  if (view === 'registerForm') return renderRegisterFormView();
  if (view === 'roleSwitch') return renderRoleSwitchView(opts && opts.roles, opts && opts.afterLabel);
  if (view === 'accountMenu') return renderAccountMenuView();
}

// ---------- 1) หน้าเข้าสู่ระบบ ----------
function renderLoginView() {
  authModalContentEl.innerHTML = `
    <div class="auth-head">
      <div class="auth-icon">🦐</div>
      <h3>เข้าสู่ระบบ</h3>
      <p>เบอร์โทรศัพท์ + รหัส PIN 6 หลัก</p>
    </div>
    <form class="auth-form" id="loginForm">
      <div class="form-error" id="loginError"></div>
      <div class="form-group">
        <label for="loginPhone">เบอร์โทรศัพท์</label>
        <input type="tel" id="loginPhone" placeholder="08XXXXXXXX" maxlength="10" required>
      </div>
      <div class="form-group">
        <label for="loginPin">รหัส PIN 6 หลัก</label>
        <input type="password" id="loginPin" inputmode="numeric" maxlength="6" placeholder="••••••" required>
      </div>
      <div class="auth-submit-row">
        <button type="submit" class="btn btn-primary">เข้าสู่ระบบ</button>
      </div>
    </form>
    <p class="auth-switch-note">ยังไม่มีบัญชี? <button type="button" id="goRegisterBtn">สมัครสมาชิก</button></p>
  `;

  document.getElementById('goRegisterBtn').addEventListener('click', () => {
    authState.selectedRoles = [];
    renderAuthView('registerRoles');
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('loginPhone').value.trim();
    const pin = document.getElementById('loginPin').value.trim();
    const errEl = document.getElementById('loginError');
    errEl.classList.remove('show');
    if (!/^\d{9,10}$/.test(phone)) {
      errEl.textContent = 'กรอกเบอร์โทรศัพท์ให้ถูกต้อง';
      errEl.classList.add('show');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      errEl.textContent = 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก';
      errEl.classList.add('show');
      return;
    }
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const { user } = await apiPost('/api/auth/login', { phone, pin });
      authState.loggedInUser = { name: user.name, roles: user.roles, activeRole: user.roles[0] };
      if (user.roles.length > 1) {
        renderAuthView('roleSwitch', { roles: user.roles, afterLabel: 'เข้าสู่ระบบสำเร็จ! เลือกสถานะที่จะใช้งานตอนนี้' });
      } else {
        finishLogin(user.roles[0]);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ---------- 2) สมัครสมาชิก ขั้นที่ 1: เลือกหมวดหมู่ (สูงสุด 2) ----------
function renderRegisterRolesView() {
  const rolesHtml = Object.entries(ROLES).map(([key, r]) => {
    const isSelected = authState.selectedRoles.includes(key);
    const isDisabled = !isSelected && authState.selectedRoles.length >= ROLE_MAX_SELECT;
    return `
      <div class="role-select-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" data-role="${key}">
        <span class="role-select-icon">${r.icon}</span>
        <div class="role-select-text">
          <strong>${r.label}</strong>
          <span>${r.desc}</span>
        </div>
        <span class="role-select-check">${isSelected ? '✓' : ''}</span>
      </div>`;
  }).join('');

  authModalContentEl.innerHTML = `
    <button type="button" class="auth-back-link" id="backToLoginBtn">‹ กลับ</button>
    <div class="auth-head">
      <div class="auth-icon">📋</div>
      <h3>เลือกหมวดหมู่ของคุณ</h3>
      <p>เลือกได้สูงสุด ${ROLE_MAX_SELECT} หมวด</p>
    </div>
    <div class="role-select-list">${rolesHtml}</div>
    <p class="role-select-limit-note">เลือกแล้ว ${authState.selectedRoles.length}/${ROLE_MAX_SELECT} หมวด</p>
    <div class="auth-submit-row">
      <button type="button" class="btn btn-primary" id="goRegisterFormBtn" ${authState.selectedRoles.length === 0 ? 'disabled' : ''}>ถัดไป</button>
    </div>
  `;

  document.getElementById('backToLoginBtn').addEventListener('click', () => renderAuthView('login'));

  authModalContentEl.querySelectorAll('.role-select-card').forEach((card) => {
    card.addEventListener('click', () => {
      const key = card.dataset.role;
      const idx = authState.selectedRoles.indexOf(key);
      if (idx >= 0) {
        authState.selectedRoles.splice(idx, 1);
      } else if (authState.selectedRoles.length < ROLE_MAX_SELECT) {
        authState.selectedRoles.push(key);
      }
      renderRegisterRolesView();
    });
  });

  document.getElementById('goRegisterFormBtn').addEventListener('click', () => {
    if (authState.selectedRoles.length === 0) return;
    renderAuthView('registerForm');
  });
}

// สร้าง HTML ของฟิลด์ 1 ช่อง ตามชนิดที่กำหนดไว้ใน ROLES[x].fields
function renderFieldHtml(roleKey, field) {
  const id = `f_${roleKey}_${field.key}`;
  const labelHtml = `<label for="${id}">${field.label}${field.optional ? ' <span class="field-note">(ไม่บังคับ)</span>' : ''}</label>`;
  if (field.type === 'select') {
    const opts = field.options.map((o) => `<option value="${o}">${o}</option>`).join('');
    return `<div class="form-group">${labelHtml}<select id="${id}">${opts}</select></div>`;
  }
  if (field.type === 'checkboxGroup') {
    const chips = field.options.map((o, i) => `
      <label class="checkbox-chip">
        <input type="checkbox" value="${o}" name="${id}">
        <span>${o}</span>
      </label>`).join('');
    return `<div class="form-group">${labelHtml}<div class="checkbox-group" id="${id}">${chips}</div></div>`;
  }
  return `<div class="form-group">${labelHtml}<input type="text" id="${id}" placeholder="${field.placeholder || ''}" ${field.optional ? '' : 'required'}></div>`;
}

// ---------- 3) สมัครสมาชิก ขั้นที่ 2: ฟอร์มตามหมวดที่เลือก ----------
function renderRegisterFormView() {
  const extraBlocksHtml = authState.selectedRoles.map((key) => {
    const r = ROLES[key];
    if (!r.fields.length) return '';
    return `
      <div class="role-extra-block">
        <div class="role-extra-head"><span>${r.icon}</span><span>ข้อมูลเพิ่มเติม — ${r.label}</span></div>
        ${r.fields.map((f) => renderFieldHtml(key, f)).join('')}
      </div>`;
  }).join('');

  const roleLabelsText = authState.selectedRoles.map((k) => ROLES[k].label).join(' + ');

  authModalContentEl.innerHTML = `
    <button type="button" class="auth-back-link" id="backToRolesBtn">‹ แก้ไขหมวดหมู่</button>
    <div class="auth-head">
      <div class="auth-icon">📝</div>
      <h3>สมัครสมาชิก</h3>
      <p>หมวดหมู่ที่เลือก: ${roleLabelsText}</p>
    </div>
    <form class="auth-form" id="registerForm">
      <div class="form-error" id="registerError"></div>

      <div class="form-group">
        <label for="regName">ชื่อ-นามสกุล</label>
        <input type="text" id="regName" required>
      </div>
      <div class="form-group">
        <label for="regProvince">จังหวัด</label>
        <select id="regProvince">${provinceOptionsHtml('กรุงเทพมหานคร')}</select>
      </div>
      <div class="form-group">
        <label for="regPhone">เบอร์โทรศัพท์ (ใช้ล็อกอิน)</label>
        <input type="tel" id="regPhone" placeholder="08XXXXXXXX" maxlength="10" required>
      </div>
      <div class="form-row-2">
        <div class="form-group">
          <label for="regPin">รหัส PIN 6 หลัก</label>
          <input type="password" id="regPin" inputmode="numeric" maxlength="6" placeholder="••••••" required>
        </div>
        <div class="form-group">
          <label for="regPinConfirm">ยืนยัน PIN</label>
          <input type="password" id="regPinConfirm" inputmode="numeric" maxlength="6" placeholder="••••••" required>
        </div>
      </div>

      ${extraBlocksHtml}

      <div class="auth-submit-row">
        <button type="submit" class="btn btn-primary">สมัครสมาชิก</button>
      </div>
    </form>
  `;

  document.getElementById('backToRolesBtn').addEventListener('click', () => renderAuthView('registerRoles'));

  authModalContentEl.querySelectorAll('.checkbox-chip').forEach((chip) => {
    chip.querySelector('input').addEventListener('change', (e) => {
      chip.classList.toggle('checked', e.target.checked);
    });
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('registerError');
    errEl.classList.remove('show');
    const name = document.getElementById('regName').value.trim();
    const province = document.getElementById('regProvince').value;
    const phone = document.getElementById('regPhone').value.trim();
    const pin = document.getElementById('regPin').value.trim();
    const pinConfirm = document.getElementById('regPinConfirm').value.trim();

    if (!name) {
      errEl.textContent = 'กรอกชื่อ-นามสกุล';
      errEl.classList.add('show');
      return;
    }
    if (!/^\d{9,10}$/.test(phone)) {
      errEl.textContent = 'กรอกเบอร์โทรศัพท์ให้ถูกต้อง';
      errEl.classList.add('show');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      errEl.textContent = 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก';
      errEl.classList.add('show');
      return;
    }
    if (pin !== pinConfirm) {
      errEl.textContent = 'รหัส PIN ทั้งสองช่องไม่ตรงกัน';
      errEl.classList.add('show');
      return;
    }

    const roleDetails = collectRoleDetails();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const { user } = await apiPost('/api/auth/register', {
        name, phone, pin, province, roles: authState.selectedRoles, roleDetails,
      });
      authState.loggedInUser = { name: user.name, roles: user.roles, activeRole: user.roles[0] };
      if (user.roles.length > 1) {
        renderAuthView('roleSwitch', { roles: user.roles, afterLabel: 'สมัครสมาชิกสำเร็จ! เลือกสถานะที่จะใช้งานตอนนี้' });
      } else {
        finishLogin(user.roles[0]);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ---------- 4) หลัง login/สมัครสำเร็จ และมีมากกว่า 1 หมวด — เลือกว่าจะใช้งานสถานะไหน ----------
function renderRoleSwitchView(roles, afterLabel) {
  const listHtml = roles.map((key) => {
    const meta = getRoleMeta(key);
    return `
      <div class="role-switch-card" data-role="${key}">
        <span class="role-select-icon">${meta.icon}</span>
        <div class="role-select-text">
          <strong>${meta.label}</strong>
          <span>${meta.desc}</span>
        </div>
      </div>`;
  }).join('');

  authModalContentEl.innerHTML = `
    <div class="auth-head">
      <div class="auth-icon">✅</div>
      <h3>เลือกสถานะที่ใช้งาน</h3>
      <p>${afterLabel || 'บัญชีนี้มีมากกว่า 1 สถานะ — ใช้งานเป็นสถานะไหนตอนนี้?'}</p>
    </div>
    <div class="role-switch-list">${listHtml}</div>
    <p class="auth-mock-note">* เลือกแล้วค่อยสลับใหม่ภายหลังได้ที่เมนูชื่อผู้ใช้</p>
  `;

  authModalContentEl.querySelectorAll('.role-switch-card').forEach((card) => {
    card.addEventListener('click', () => finishLogin(card.dataset.role));
  });
}

// ---------- เมนูบัญชี (เปิดจากปุ่มชื่อผู้ใช้บน header เมื่อ login อยู่แล้ว) ----------
function renderAccountMenuView() {
  const user = authState.loggedInUser;
  if (!user) return renderLoginView();

  const listHtml = user.roles.map((key) => {
    const meta = getRoleMeta(key);
    const isActive = key === user.activeRole;
    return `
      <div class="role-switch-card ${isActive ? 'active' : ''}" data-role="${key}">
        <span class="role-select-icon">${meta.icon}</span>
        <div class="role-select-text">
          <strong>${meta.label}</strong>
          <span>${meta.desc}</span>
        </div>
      </div>`;
  }).join('');

  authModalContentEl.innerHTML = `
    <div class="auth-head">
      <div class="auth-icon">${getRoleMeta(user.activeRole).icon}</div>
      <h3>${user.name}</h3>
      <p>${user.roles.length > 1 ? 'เลือกสถานะที่จะใช้งาน' : getRoleMeta(user.activeRole).label}</p>
    </div>
    ${user.roles.length > 1 ? `<div class="role-switch-list">${listHtml}</div>` : ''}
    <div class="auth-submit-row">
      <button type="button" class="btn btn-ghost" id="logoutBtn">ออกจากระบบ</button>
    </div>
  `;

  authModalContentEl.querySelectorAll('.role-switch-card').forEach((card) => {
    card.addEventListener('click', () => finishLogin(card.dataset.role));
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await apiPost('/api/auth/logout', {}); } catch (e) { /* ล้าง state ฝั่งหน้าเว็บต่อได้ แม้ call ล้มเหลว */ }
    authState.loggedInUser = null;
    updateHeaderAuthButton();
    closeAuthModal();
  });
}

// ---------- 5) ปิดการล็อกอิน: อัปเดตปุ่มบน header ให้เป็นชื่อ+สถานะ ----------
function finishLogin(activeRoleKey) {
  if (authState.loggedInUser) authState.loggedInUser.activeRole = activeRoleKey;
  updateHeaderAuthButton();
  closeAuthModal();
}

function updateHeaderAuthButton() {
  if (!loginNavBtn) return;
  const user = authState.loggedInUser;
  if (!user) {
    loginNavBtn.textContent = 'เข้าสู่ระบบ';
    loginNavBtn.classList.remove('user-chip');
    return;
  }
  const meta = getRoleMeta(user.activeRole);
  loginNavBtn.classList.add('user-chip');
  loginNavBtn.innerHTML = `<span class="user-chip-icon">${meta.icon}</span><span>${user.name}<br><span class="user-chip-role">${meta.label}${user.roles.length > 1 ? ' · กดเพื่อสลับสถานะ' : ''}</span></span>`;
}

if (loginNavBtn) {
  loginNavBtn.addEventListener('click', () => {
    if (authState.loggedInUser) {
      openAuthModal('accountMenu');
      return;
    }
    openAuthModal('login');
  });
}

if (authModalCloseBtn && authModalEl) {
  authModalCloseBtn.addEventListener('click', closeAuthModal);
  authModalEl.addEventListener('click', (e) => {
    if (e.target.id === 'authModal') closeAuthModal();
  });
}

// โหลดหน้าแรก: เช็ค session เดิม (คุกกี้) ว่ายัง login ค้างอยู่ไหม แล้วคืนสถานะปุ่ม header ให้ตรง
(async function restoreSession() {
  try {
    const { user } = await apiGet('/api/auth/me');
    if (user && user.roles && user.roles.length) {
      authState.loggedInUser = { name: user.name, roles: user.roles, activeRole: user.roles[0] };
      updateHeaderAuthButton();
    }
  } catch (e) { /* ยังไม่ login หรือเช็คไม่ได้ ก็ปล่อยเป็นสถานะ "เข้าสู่ระบบ" ตามปกติ */ }
})();
