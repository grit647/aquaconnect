-- ค่าตั้งของระบบแชท: เพดานข้อความต่อวันต่อคน (คุมค่า Gemini ที่ใช้โปรเจกต์ Google Cloud ร่วมกับเช่าสุข/ครีม)
INSERT INTO app_settings (key, value, note) VALUES
  ('chat_daily_limit', '200', 'ส่งข้อความหาเลขาได้สูงสุดกี่ข้อความต่อวันต่อคน (ปรับได้ทุกเมื่อ)')
ON CONFLICT (key) DO NOTHING;
