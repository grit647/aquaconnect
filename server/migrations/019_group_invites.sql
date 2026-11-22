-- คำเชิญเข้ากลุ่ม: แอดมินกลุ่ม (ผู้สร้าง) เลือกจากรายชื่อผู้ใช้ทั้งระบบแล้วส่งคำเชิญ — ผู้ถูกเชิญกดตอบรับ/ปฏิเสธเอง (ไม่บังคับเข้ากลุ่ม)
CREATE TABLE IF NOT EXISTS chat_group_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  inviter_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_group_invites_pending ON chat_group_invites (group_id, invitee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_chat_group_invites_invitee ON chat_group_invites (invitee_id, status);
ALTER TABLE chat_group_invites ENABLE ROW LEVEL SECURITY;
