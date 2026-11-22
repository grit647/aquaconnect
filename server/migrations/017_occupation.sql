-- สถานะปัจจุบันของผู้ใช้ (หมวดหลัก/หัวข้อย่อย/รายละเอียด) — ฐานข้อมูลกลางสำหรับการค้นหา/เชื่อมต่อในฟีเจอร์ถัดไป (ตอนนี้เป็นส่วนตัว ไม่โชว์ให้ใคร)
ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation_main text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation_sub text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation_detail text;
