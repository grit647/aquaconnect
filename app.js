// หน้า UI เริ่มต้น — ตอนนี้แค่ทำเมนูมือถือพับ/กางได้ ยังไม่มีระบบจริงด้านหลัง
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('mainNav').classList.toggle('open');
});
