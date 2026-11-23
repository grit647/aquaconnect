-- ห้องสัมมนา / ประชุมออนไลน์ (ฝังวิดีโอ Jitsi Meet) — ใครมีลิงก์ก็เข้าได้โดยไม่ต้องสมัคร
-- code = รหัสสุ่มในลิงก์ /meet/<code> (เดาไม่ได้) • type: meeting = ทุกคนพูดได้ / seminar = ผู้จัดพูด ผู้ฟังปิดไมค์กล้องไว้ก่อน
CREATE TABLE IF NOT EXISTS meetings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  host_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  type        text NOT NULL DEFAULT 'meeting' CHECK (type IN ('meeting', 'seminar')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings (host_id, created_at DESC);
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value, note) VALUES
  ('meetings_per_day',   '5',  'สมาชิก 1 คนสร้างห้องสัมมนา/ประชุมได้กี่ห้องต่อวัน (คุมการสร้างห้องมั่ว)'),
  ('meeting_valid_days', '7',  'ลิงก์ห้องสัมมนา/ประชุมใช้ได้กี่วันหลังสร้าง')
ON CONFLICT (key) DO NOTHING;
