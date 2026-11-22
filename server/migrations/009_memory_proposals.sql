-- "ผู้ใช้สอนเลขาเอง": เลขาไตร่ตรองบทสนทนาแล้ว "เสนอ" สิ่งที่ควรจำเกี่ยวกับตัวผู้ใช้ (ตัวตน/บทเรียน/ความฝัน)
-- ยังไม่บันทึกจริงจนกว่าเจ้าของจะยืนยัน (human-in-the-loop) — ข้อเสนอที่ยืนยันแล้วจึงย้ายไปเป็นความจำในหมวดส่วนตัวของเจ้าของ
CREATE TABLE IF NOT EXISTS memory_proposals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category               text NOT NULL,                 -- ชื่อหมวดตัวเลขา (ตัวตนของฉัน / บทเรียนที่สอนเลขา / ความฝันของฉัน)
  content                text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  source_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  decided_at             timestamptz
);
CREATE INDEX IF NOT EXISTS idx_memory_proposals_owner ON memory_proposals (owner_id, status, created_at DESC);
ALTER TABLE memory_proposals ENABLE ROW LEVEL SECURITY;

-- นับข้อความผู้ใช้ที่ไตร่ตรองไปแล้วในแต่ละบทสนทนา (ไว้เว้นระยะ ไม่ไตร่ตรองทุกข้อความ — คุมค่า AI)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reflected_user_msgs integer NOT NULL DEFAULT 0;

-- 2 หมวดหลักที่ทุกคนมีตั้งแต่เริ่มใช้งาน: "ทั่วไป" และ "ความสามารถเลขา" (เติมให้ผู้ใช้เดิมทุกคน; ผู้ใช้ใหม่สร้างตอนสมัคร)
INSERT INTO memory_categories (owner_id, name)
SELECT u.id, n.name FROM users u CROSS JOIN (VALUES ('ทั่วไป'), ('ความสามารถเลขา')) AS n(name)
ON CONFLICT (owner_id, name) DO NOTHING;
