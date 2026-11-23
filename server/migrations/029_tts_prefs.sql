-- ผู้ใช้เลือกลักษณะเสียงพรีเมียมเอง: เสียงที่ชอบ (ชื่อเสียงในรายการที่อนุญาต) + สไตล์การพูด (ติ๊กได้หลายข้อ) — null/ว่าง = มาตรฐาน (ใช้เสียงเริ่มต้นที่แอดมินตั้ง)
ALTER TABLE users ADD COLUMN IF NOT EXISTS tts_voice text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tts_styles text[] NOT NULL DEFAULT '{}';
