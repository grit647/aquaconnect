-- สิทธิ์ "ค้นหาข้อมูลภายนอกด้วย Google" รายคน — แอดมินเป็นคนกำหนด (ผู้ใช้เปิดเองไม่ได้) + นับจำนวนครั้งที่ใช้
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_search_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_search_count integer NOT NULL DEFAULT 0;
