-- เลขา AI ร่วมคุยในกลุ่มเอง + ช่วง "เลขาคุยกันเอง" 5 นาที + บันทึกความรู้จักกัน
ALTER TABLE chat_group_messages ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false;      -- ข้อความของเลขา AI (user_id = เจ้าของเลขา)
ALTER TABLE chat_group_messages ADD COLUMN IF NOT EXISTS ai_depth integer NOT NULL DEFAULT 0;       -- ความลึกของสายที่เลขาตอบเลขา (กันวนลูป)
ALTER TABLE chat_group_messages ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;  -- ข้อความระบบ (เริ่ม/จบช่วงคุยกันเอง)
CREATE INDEX IF NOT EXISTS idx_chat_group_messages_ai ON chat_group_messages (user_id, created_at DESC) WHERE is_ai;

-- ความจำที่เลขาจดจากกลุ่มไหน (ใช้ดึง "คนที่รู้จักในกลุ่มนี้" เฉพาะกลุ่มนั้น ไม่ปนข้ามกลุ่ม)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_group_id uuid REFERENCES chat_groups(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS chat_group_ai_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  started_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz NOT NULL,
  ended_at      timestamptz,
  ended_reason  text,
  messages      integer NOT NULL DEFAULT 0
);
-- กลุ่มหนึ่งมีช่วงที่กำลังทำงานได้ครั้งละ 1 ช่วง
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_group_ai_sessions_active ON chat_group_ai_sessions (group_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_group_ai_sessions_group ON chat_group_ai_sessions (group_id, started_at DESC);
ALTER TABLE chat_group_ai_sessions ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value, note) VALUES
  ('group_ai_per_hour',         '12', 'เลขา AI 1 ตัวพูดในกลุ่มหนึ่งได้กี่ข้อความต่อชั่วโมง (นอกช่วงคุยกันเอง)'),
  ('group_ai_per_day',          '60', 'เลขา AI 1 ตัวพูดในกลุ่มทั้งหมดได้กี่ข้อความต่อวัน (รวมช่วงคุยกันเอง)'),
  ('group_ai_chain_max',        '3',  'เลขา AI ตอบเลขา AI ต่อกันได้กี่ชั้น (กันคุยวนไม่จบ)'),
  ('group_ai_session_minutes',  '5',  'ช่วงให้เลขาคุยกันเอง ยาวกี่นาที (สวิตช์ปิดเองเมื่อครบเวลา)'),
  ('group_ai_sessions_per_day', '6',  'กลุ่มหนึ่งเริ่มช่วงให้เลขาคุยกันเองได้กี่ครั้งต่อ 24 ชั่วโมง'),
  ('group_ai_session_max_messages', '30', 'ช่วงให้เลขาคุยกันเองหนึ่งช่วง พูดได้รวมกี่ข้อความ (เพดานค่า AI)')
ON CONFLICT (key) DO NOTHING;
