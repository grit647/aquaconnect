-- ขอสิทธิ์ค้นหาข้อมูลภายนอกด้วย Google: ผู้ใช้ที่แอดมินยังไม่เปิดสิทธิ์ให้ → เลขาส่งคำร้องไปทางไลน์ แอดมินกดอนุญาต/ไม่อนุญาต
-- (อนุญาต = เปิด users.google_search_enabled ให้คนนั้น; คนที่เปิดสิทธิ์อยู่แล้วไม่ต้องขอ)
CREATE TABLE IF NOT EXISTS google_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic       text,                                   -- เรื่องที่ผู้ใช้อยากให้หา (สั้นๆ ให้แอดมินเห็นประกอบการตัดสินใจ)
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_google_requests_user ON google_requests (user_id, status, created_at DESC);
ALTER TABLE google_requests ENABLE ROW LEVEL SECURITY;

-- ข้อความของเลขาที่มาจากผลค้น Google ติดป้าย source = 'google' (ไว้กันไม่ให้ถูกสรุป/บันทึกเป็นความจำส่วนตัวของผู้ใช้)
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_source_check;
ALTER TABLE messages ADD CONSTRAINT messages_source_check CHECK (source IN ('text', 'voice', 'google'));
