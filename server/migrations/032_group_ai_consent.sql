-- ช่วง "ให้เลขาคุยกันเอง": เลขาของสมาชิกคนอื่นจะร่วมได้ก็ต่อเมื่อ "เจ้าของเลขากดยอมรับ" ในช่วงนั้น (ผู้เริ่มยอมรับอัตโนมัติ)
-- เดิมใครติ๊ก "ร่วมคุยในกลุ่มนี้" ไว้ เลขาจะถูกดึงเข้าช่วงคุยกันเองทันที แม้เจ้าของไม่ได้เข้าแอป
CREATE TABLE IF NOT EXISTS chat_group_ai_session_consent (
  session_id    uuid NOT NULL REFERENCES chat_group_ai_sessions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  responded_at  timestamptz,
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gai_consent_user ON chat_group_ai_session_consent (user_id, status);
ALTER TABLE chat_group_ai_session_consent ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value, note) VALUES
  ('group_ai_consent_seconds', '90', 'ช่วงเลขาคุยกันเอง: รอเจ้าของเลขาตัวอื่นกดยอมรับกี่วินาที (ถ้าครบเวลายังมีเลขาร่วมไม่ถึง 2 ตัว ยกเลิกช่วงนั้น)')
ON CONFLICT (key) DO NOTHING;
