-- โควตาฟรีเสียงพรีเมียม: คุณต้นเลือก 60 นาที/เดือน/คน (2026-11-23) — เปลี่ยนเฉพาะถ้ายังเป็นค่าเริ่มต้นเดิม (300 วินาที) ไม่ทับค่าที่แอดมินตั้งเอง
UPDATE app_settings SET value = '3600'::jsonb, updated_at = now() WHERE key = 'tts_free_seconds_per_month' AND value = '300'::jsonb;
