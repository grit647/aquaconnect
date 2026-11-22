-- โควตาค้นหาด้วย Google เป็นรายเดือน: จำว่านับของเดือนไหน (ปี-เดือน เวลาไทย) ถ้าเดือนเปลี่ยนตัวนับถือเป็น 0 เอง (ไม่ต้องมีตัวรีเซ็ต)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_search_month text;
UPDATE app_settings SET note = 'จำนวนครั้งค้นหาด้วย Google สูงสุดต่อคนต่อเดือน (รีเซ็ตทุกวันที่ 1 เวลาไทย) — ใช้แสดงแถบในเมนูโปรไฟล์' WHERE key = 'google_search_limit';
