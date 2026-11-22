-- ช่วงเลขาคุยกันเอง: มี "ประเด็น" ให้คุยทีละข้อ (เจ้าของใส่เอง หรือเลขาตั้งให้) + ปรับความเร็วการคุยให้ช้าลง
ALTER TABLE chat_group_ai_sessions ADD COLUMN IF NOT EXISTS agenda text;   -- JSON array ของประเด็น
INSERT INTO app_settings (key, value, note) VALUES
  ('group_ai_session_pace_sec', '20', 'ช่วงเลขาคุยกันเอง: เลขาผลัดกันพูดห่างกันกี่วินาที (ยิ่งมากยิ่งช้า อ่านทัน)'),
  ('group_ai_msgs_per_issue',   '4',  'ช่วงเลขาคุยกันเอง: คุยประเด็นละกี่ข้อความก่อนขยับไปประเด็นถัดไป')
ON CONFLICT (key) DO NOTHING;
