-- (1) ข้อความที่ยังไม่อ่านในกลุ่ม: จำว่าสมาชิกแต่ละคนอ่านถึงข้อความที่เท่าไหร่ (null = ยังไม่เคยเปิดห้องเลย นับจากวันที่เข้ากลุ่ม)
ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS last_read_id bigint;
-- สมาชิกเดิมทุกคน: ถือว่าอ่านถึงข้อความล่าสุดแล้ว (กันป้ายแจ้งเตือนพรั่งพรูจากประวัติเก่าตอนเปิดฟีเจอร์ครั้งแรก)
UPDATE chat_group_members m SET last_read_id = COALESCE((SELECT max(x.id) FROM chat_group_messages x WHERE x.group_id = m.group_id), 0) WHERE m.last_read_id IS NULL;

-- (2) คำแนะนำข้อความถัดไปจากเลขา: เก็บว่าเสนออะไรไป ผู้ใช้กดรับ (accepted=true) หรือพิมพ์เอง/ข้าม (false)
-- ใช้ 2 อย่าง: ให้เลขาเห็นว่าแบบไหนผู้ใช้ชอบ (ปรับคำแนะนำรอบหน้า) และให้เราวัดว่าฟีเจอร์นี้มีประโยชน์จริงไหม
CREATE TABLE IF NOT EXISTS suggestion_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'ai',      -- ai = เลขาแนบมากับคำตอบ • rule = ระบบเตือนของค้าง/แนะนำตอนเปิดแอป
  text        text NOT NULL,
  accepted    boolean,                          -- null = ยังรอผู้ใช้ตัดสินใจ
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_suggestion_log_user ON suggestion_log (user_id, created_at DESC);
ALTER TABLE suggestion_log ENABLE ROW LEVEL SECURITY;
