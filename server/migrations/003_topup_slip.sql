-- ระยะ 3: เติมเครดิต — เก็บรูปสลิปไว้ในฐานข้อมูลเอง (Render ดิสก์ไม่ถาวร) + กันใช้สลิปใบเดียวเติมซ้ำ
ALTER TABLE topups ADD COLUMN IF NOT EXISTS slip_data  text;     -- รูปสลิป base64 (ย่อขนาดมาจากหน้าเว็บแล้ว)
ALTER TABLE topups ADD COLUMN IF NOT EXISTS slip_mime  text;
ALTER TABLE topups ADD COLUMN IF NOT EXISTS slip_hash  text;     -- sha256 ของรูป ใช้กันสลิปซ้ำ
ALTER TABLE topups ADD COLUMN IF NOT EXISTS approved_amount numeric(14, 2);  -- ยอดที่แอดมินยืนยันให้เครดิตจริง
CREATE UNIQUE INDEX IF NOT EXISTS uq_topups_slip_hash ON topups (slip_hash) WHERE slip_hash IS NOT NULL AND status <> 'rejected';

INSERT INTO app_settings (key, value, note) VALUES
  ('topup_min',  '20',    'เติมเครดิตขั้นต่ำต่อครั้ง'),
  ('topup_max',  '20000', 'เติมเครดิตสูงสุดต่อครั้ง')
ON CONFLICT (key) DO NOTHING;
