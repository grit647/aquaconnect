-- ปฏิทิน & เตือน: นัดหมาย/บันทึกที่ให้เลขาแจ้งเตือนทางไลน์ (พร้อมปุ่ม "รับทราบแล้ว") และในแอป
CREATE TABLE IF NOT EXISTS events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            text NOT NULL,
  note             text,
  event_at         timestamptz NOT NULL,          -- วัน-เวลานัดจริง (ตีความเป็นเวลาไทย UTC+7 ตอนบันทึก)
  all_day          boolean NOT NULL DEFAULT false,
  remind_at        timestamptz NOT NULL,          -- เวลาที่ให้แจ้งเตือน
  remind_sent_at   timestamptz,                   -- ส่งแจ้งเตือนครั้งล่าสุดเมื่อไหร่
  remind_count     integer NOT NULL DEFAULT 0,    -- ส่งไปกี่ครั้งแล้ว (ส่งซ้ำได้จำกัดจนกว่าจะกดรับทราบ)
  fail_count       integer NOT NULL DEFAULT 0,    -- ส่งไลน์ไม่สำเร็จกี่ครั้ง (ครบ 5 หยุดลอง)
  acknowledged_at  timestamptz,                   -- กด "รับทราบแล้ว" เมื่อไหร่ (มีค่า = เลิกเตือน)
  created_via      text NOT NULL DEFAULT 'app' CHECK (created_via IN ('app', 'secretary')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events (user_id, event_at);
CREATE INDEX IF NOT EXISTS idx_events_due ON events (remind_at) WHERE acknowledged_at IS NULL;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value, note) VALUES
  ('reminder_repeat_max', '1',  'ส่งแจ้งเตือนซ้ำได้อีกกี่ครั้งถ้ายังไม่กดรับทราบ (แต่ละครั้งนับโควตา push ของไลน์)'),
  ('reminder_repeat_min', '30', 'ส่งซ้ำห่างกันกี่นาที')
ON CONFLICT (key) DO NOTHING;
