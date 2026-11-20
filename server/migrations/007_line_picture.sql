-- รูปโปรไฟล์ไลน์ (URL จาก LINE) — เก็บไว้ให้แสดงได้แม้เปิดผ่านเบราว์เซอร์ปกติ (ไม่ใช่ในไลน์)
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_picture_url text;
