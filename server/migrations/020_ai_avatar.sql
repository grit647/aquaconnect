-- รูป AI ส่วนตัวของผู้ใช้ (เก็บในฐานข้อมูล ย่อเป็นรูปเล็กฝั่งหน้าเว็บก่อนอัปโหลด — ดิสก์ของ Render ถาวรไม่ได้) เห็นได้เฉพาะเจ้าของบัญชี
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_avatar bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_avatar_mime text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_avatar_at timestamptz;
