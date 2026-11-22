-- หมวดหลักที่ 4 "การใช้งานแพลตฟอร์ม" (คู่มือที่ทีมงานเขียน — เนื้อหาอยู่ในโค้ด server/platformGuide.js ไม่ได้เก็บเป็นแถวใน memories)
-- ทุกคนมีตั้งแต่เริ่ม ลบ/แก้/แชร์ไม่ได้ (เป็นส่วนตัวเสมอ)
INSERT INTO memory_categories (owner_id, name)
SELECT u.id, 'การใช้งานแพลตฟอร์ม' FROM users u
ON CONFLICT (owner_id, name) DO NOTHING;
