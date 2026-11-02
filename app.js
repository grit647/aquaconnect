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
