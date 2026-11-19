-- AquaConnect AI เลขา — โครงสร้างฐานข้อมูลชุดแรก (2026-11-19)
-- แนวคิด: ผู้ใช้ทุกคนมี AI เลขาของตัวเอง คุยด้วยเสียง/ข้อความ, AI สรุปเก็บลง "หมวด" ใน Memory Pack,
-- เจ้าของตั้งหมวดเป็น ส่วนตัว/ฟรี/เสียเงิน, AI คุยกับ AI ผ่านระบบขออนุญาต, จ่ายด้วยเครดิตในระบบ
-- เขียนให้รันซ้ำได้ปลอดภัย (IF NOT EXISTS)

-- ---------- ผู้ใช้ ----------
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone              text NOT NULL UNIQUE,
  pin_hash           text NOT NULL,                       -- เก็บเฉพาะค่า hash ไม่เก็บ PIN จริง
  name               text NOT NULL,
  is_admin           boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  line_user_id       text UNIQUE,                         -- ผูกบัญชี LINE (ไว้เข้าสู่ระบบอัตโนมัติ + แจ้งเตือน)
  secretary_name     text NOT NULL DEFAULT 'เลขา',        -- ชื่อ AI เลขาของคนนี้ (ตั้งเองได้)
  secretary_persona  text,                                -- บุคลิกของเลขา (เช่น น้ำเสียง/วิธีพูด)
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------- การคุย (หัวข้อ) และข้อความทุกคำพูด ----------
CREATE TABLE IF NOT EXISTS conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            text,                                  -- หัวข้อการคุย
  summary          text,                                  -- สรุปที่ AI ทำไว้ตอนปิดหัวข้อ
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id               bigserial PRIMARY KEY,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- เจ้าของบทสนทนา (คนอื่นไม่เห็น)
  role             text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          text NOT NULL,
  source           text NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);

-- ---------- Memory Pack: หมวด + ความจำ ----------
CREATE TABLE IF NOT EXISTS memory_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  visibility     text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'free', 'paid')),  -- หมวดใหม่เป็นส่วนตัวก่อนเสมอ
  price_type     text CHECK (price_type IN ('hour', 'question')),
  price_credits  numeric(12, 2) CHECK (price_credits > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name),
  -- หมวดเสียเงินต้องมีหน่วยราคาและราคาเสมอ
  CONSTRAINT chk_paid_has_price CHECK (
    visibility <> 'paid' OR (price_type IS NOT NULL AND price_credits IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS memories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id             uuid NOT NULL REFERENCES memory_categories(id) ON DELETE CASCADE,
  owner_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content                 text NOT NULL,
  source_conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories (category_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories (owner_id);

-- ---------- เครดิต (เงินในระบบ) ----------
-- ยอดคงเหลือ: ห้ามติดลบ (กันที่ระดับฐานข้อมูลเอง ไม่พึ่งแค่โค้ด)
CREATE TABLE IF NOT EXISTS credit_balances (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance     numeric(14, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- สมุดบัญชี: ทุกการเปลี่ยนแปลงยอดต้องมีแถวบันทึก (บวก = เข้า, ลบ = ออก)
CREATE TABLE IF NOT EXISTS credit_ledger (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id),
  amount         numeric(14, 2) NOT NULL CHECK (amount <> 0),
  type           text NOT NULL CHECK (type IN ('topup', 'spend', 'earn', 'adjust', 'refund')),
  ref_type       text,                       -- เช่น 'topup', 'access_session'
  ref_id         text,
  note           text,
  balance_after  numeric(14, 2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger (user_id, created_at DESC);

-- คำขอเติมเงิน (โอน PromptPay → ส่งสลิป → แอดมินยืนยัน)
CREATE TABLE IF NOT EXISTS topups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  amount_claimed    numeric(14, 2),          -- ยอดที่ผู้ใช้แจ้ง
  slip_image_url    text,
  slip_amount_read  numeric(14, 2),          -- ยอดที่ AI อ่านจากสลิป
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_topups_status ON topups (status, created_at);

-- ---------- ขออนุญาตเข้าถึงข้อมูล (AI ขอถาม AI) ----------
CREATE TABLE IF NOT EXISTS access_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES memory_categories(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'revoked', 'expired')),
  message       text,
  decided_at    timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> owner_id)
);
-- ขอซ้ำระหว่างรอตอบไม่ได้ (1 คน/1 หมวด/1 คำขอที่ค้างอยู่)
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_pending
  ON access_requests (requester_id, category_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_access_owner ON access_requests (owner_id, status);

-- รอบการคุยที่คิดเงิน: เก็บราคาและส่วนแบ่งแพลตฟอร์ม "ณ ตอนนั้น" ไว้ในแถว
-- เพื่อให้เปลี่ยนราคา/อัตราส่วนแบ่งภายหลังแล้วประวัติเก่าไม่เพี้ยน
CREATE TABLE IF NOT EXISTS access_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id       uuid NOT NULL REFERENCES users(id),
  owner_id           uuid NOT NULL REFERENCES users(id),
  category_id        uuid NOT NULL REFERENCES memory_categories(id),
  price_type         text CHECK (price_type IN ('hour', 'question')),
  unit_price         numeric(12, 2) NOT NULL DEFAULT 0,     -- 0 = หมวดฟรี
  commission_rate    numeric(5, 2) NOT NULL DEFAULT 0,      -- % ที่แพลตฟอร์มหัก ณ ตอนนั้น
  started_at         timestamptz NOT NULL DEFAULT now(),
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  units_billed       integer NOT NULL DEFAULT 0,            -- นาทีหรือจำนวนคำถามที่คิดเงินแล้ว
  credits_charged    numeric(14, 2) NOT NULL DEFAULT 0,     -- ที่หักจากผู้ถาม
  platform_fee       numeric(14, 2) NOT NULL DEFAULT 0,     -- ส่วนของแพลตฟอร์ม
  owner_earned       numeric(14, 2) NOT NULL DEFAULT 0      -- ส่วนที่เข้าเจ้าของข้อมูล
);
CREATE INDEX IF NOT EXISTS idx_sessions_requester ON access_sessions (requester_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON access_sessions (owner_id, started_at DESC);

-- ---------- ค่าตั้งระบบ (แก้ได้โดยไม่ต้องแก้โค้ด) ----------
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value, note) VALUES
  ('commission_rate',    '20',  'ส่วนแบ่งแพลตฟอร์ม (%) หมวดเสียเงินเท่านั้น ช่วงที่คุยกัน 10-30'),
  ('idle_timeout_min',   '5',   'เงียบเกินกี่นาทีถือว่าจบรอบการคุยที่คิดเงิน'),
  ('credit_per_baht',    '1',   'เครดิต 1 = กี่บาท (ตอนนี้ 1 เครดิต = 1 บาท)'),
  ('withdraw_enabled',   'false', 'เปิดให้ถอนเครดิตเป็นเงินจริงหรือไม่ (ช่วงแรกปิด)')
ON CONFLICT (key) DO NOTHING;

-- ---------- ความปลอดภัย ----------
-- Supabase เปิด API สาธารณะให้ตารางในสคีมา public โดยอัตโนมัติ — เราใช้ผ่านเซิร์ฟเวอร์ของเราเองเท่านั้น
-- จึงเปิด Row Level Security ไว้ทุกตารางโดยไม่ตั้งนโยบายเปิด (คนนอกยิง API ตรงจะไม่เห็นข้อมูลเลย)
-- เซิร์ฟเวอร์เรา (เจ้าของตาราง) ยังอ่านเขียนได้ตามปกติ
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger       ENABLE ROW LEVEL SECURITY;
ALTER TABLE topups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings        ENABLE ROW LEVEL SECURITY;

-- ปิดสิทธิ์ของบทบาทสาธารณะ (anon/authenticated) ซ้ำอีกชั้น ถ้ามีบทบาทนี้อยู่ในฐานข้อมูล
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
