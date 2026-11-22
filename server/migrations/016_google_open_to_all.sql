-- เปิดค้นหาด้วย Google ให้ทุกคนเป็นค่าเริ่มต้น (เจ้าของสั่ง 2026-11-22) — แอดมินยังปิดรายคนได้ในหลังบ้าน; ผู้ใช้เดิมทุกคนถูกเปิดให้ด้วย
ALTER TABLE users ALTER COLUMN google_search_enabled SET DEFAULT true;
UPDATE users SET google_search_enabled = true WHERE google_search_enabled = false;
