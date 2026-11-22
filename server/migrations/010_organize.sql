-- เลขาสรุปบทสนทนาที่ยังไม่ได้จัดหมวด แล้วเสนอให้เจ้าของยืนยัน (ถามตอนกลับเข้าแอป ไม่ถามถี่ระหว่างคุย)
-- organize_mode: ask = ถามก่อนทุกครั้งที่กลับเข้ามา / auto = สรุปแล้วบันทึกเองเลย / off = ไม่ถามและไม่บันทึกเอง (เจ้าของตั้งเองได้)
ALTER TABLE users ADD COLUMN IF NOT EXISTS organize_mode text NOT NULL DEFAULT 'ask' CHECK (organize_mode IN ('ask', 'auto', 'off'));
-- บทสนทนานี้จัดเก็บ/ตัดสินใจเรื่องจัดหมวดแล้ว (มีค่า = ไม่ถามซ้ำ)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS organized_at timestamptz;
