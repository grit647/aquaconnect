-- กลุ่มสนทนาบนแพลตฟอร์มของเราเอง (ไม่ผ่านไลน์): สร้างกลุ่ม (คนละไม่เกิน 2 กลุ่ม — ตรวจในโค้ด), ขอเข้าร่วม → ผู้สร้างอนุญาต, แชทกลุ่ม
CREATE TABLE IF NOT EXISTS chat_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text,
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- ผู้สร้าง = แอดมินกลุ่ม
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_groups_name ON chat_groups (lower(name));
CREATE INDEX IF NOT EXISTS idx_chat_groups_owner ON chat_groups (owner_id);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id   uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON chat_group_members (user_id);

CREATE TABLE IF NOT EXISTS chat_group_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
-- ขอซ้ำตอนยังรออยู่ไม่ได้ (หนึ่งคำขอที่รออยู่ต่อคนต่อกลุ่ม)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_group_requests_pending ON chat_group_requests (group_id, user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS chat_group_messages (
  id          bigserial PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_group_messages_group ON chat_group_messages (group_id, id DESC);

ALTER TABLE chat_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_messages  ENABLE ROW LEVEL SECURITY;
