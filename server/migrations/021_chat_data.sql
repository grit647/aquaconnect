-- หมวดหลักที่ 3 "ข้อมูลแชท" (เก็บสรุปบทสนทนากลุ่ม) — ทุกคนมีตั้งแต่เริ่ม ลบได้แค่เนื้อหา ลบตัวหมวดไม่ได้ เป็นส่วนตัวเสมอ
INSERT INTO memory_categories (owner_id, name)
SELECT u.id, 'ข้อมูลแชท' FROM users u
ON CONFLICT (owner_id, name) DO NOTHING;

-- ตั้งค่าเลขาของสมาชิกแต่ละคนในแต่ละกลุ่ม: ร่วมคุยไหม + หัวข้อที่จะคุย (ตัวคุยของเลขายังอยู่ระหว่างออกแบบ — เก็บค่าไว้ก่อน)
ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS ai_join boolean NOT NULL DEFAULT false;
ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS ai_topic text;
