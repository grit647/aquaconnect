-- ระยะ 3: นับจำนวนครั้งที่ถาม แยกจาก units_billed (หมวดคิดตามชั่วโมง units_billed = นาทีที่คิดเงินแล้ว ใช้นับโควตาไม่ได้)
ALTER TABLE access_sessions ADD COLUMN IF NOT EXISTS ask_count integer NOT NULL DEFAULT 0;
UPDATE access_sessions SET ask_count = units_billed WHERE ask_count = 0 AND price_type IS NULL;
