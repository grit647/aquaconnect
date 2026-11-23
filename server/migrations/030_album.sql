-- อัลบั้มรูปส่วนตัวของผู้ใช้: เก็บรูป (ย่อแล้วที่หน้าเว็บ) + รูปย่อ + คำอธิบาย/แท็กที่เลขาอ่านจากรูปตอนอัปโหลด ให้เลขาค้นและดึงรูปมาแสดงในแชทได้
-- เป็นข้อมูลส่วนตัวเท่านั้น: ดู/แก้/ลบได้เฉพาะเจ้าของ (ไม่ผูกกับระบบแชร์หมวดข้อมูล ไม่ส่งให้คนอื่น/ในกลุ่ม)
CREATE TABLE IF NOT EXISTS album_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption      text NOT NULL DEFAULT '',          -- ชื่อ/คำบรรยายที่ผู้ใช้ตั้ง (หรือที่เลขาเสนอตอนอัปโหลด)
  description  text NOT NULL DEFAULT '',          -- เลขาอ่านรูปแล้วบรรยายสั้นๆ (ใช้ค้นหา)
  tags         text[] NOT NULL DEFAULT '{}',      -- แท็กจากเลขา (ใช้ค้นหา)
  mime         text NOT NULL,
  image        bytea NOT NULL,
  thumb        bytea NOT NULL,
  bytes        integer NOT NULL,                  -- image + thumb (นับโควตา)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_album_owner ON album_photos (owner_id, created_at DESC);
ALTER TABLE album_photos ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value, note) VALUES
  ('album_max_photos', '30', 'อัลบั้ม: เก็บรูปได้สูงสุดกี่รูปต่อคน'),
  ('album_max_mb',     '30', 'อัลบั้ม: ขนาดรวมของรูปต่อคน (MB)')
ON CONFLICT (key) DO NOTHING;
