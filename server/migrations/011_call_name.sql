-- ชื่อที่ให้เลขาเรียกผู้ใช้ (เจ้าของตั้งเอง เช่น ชื่อเล่น) — ว่าง = เรียกตามชื่อที่ใช้สมัคร
ALTER TABLE users ADD COLUMN IF NOT EXISTS call_name text;
