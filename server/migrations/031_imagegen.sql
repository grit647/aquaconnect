-- เจนภาพด้วย AI (Gemini ผ่าน Vertex) — แอดมินเปิดสิทธิ์รายคน (ค่าเริ่มต้นปิด เหมือนเสียงพรีเมียม)
ALTER TABLE users ADD COLUMN IF NOT EXISTS imagegen_enabled boolean NOT NULL DEFAULT false;

-- ภาพที่เลขาวาดให้ (เก็บเพื่อให้เปิดดูจากประวัติแชทได้ — เก็บล่าสุดคนละ 60 ภาพ ภาพเก่าสุดถูกลบอัตโนมัติ) ผู้ใช้กดบันทึกลงอัลบั้มถาวรได้เอง
CREATE TABLE IF NOT EXISTS generated_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt      text NOT NULL DEFAULT '',
  mime        text NOT NULL,
  image       bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_genimg_owner ON generated_images (owner_id, created_at DESC);
ALTER TABLE generated_images ENABLE ROW LEVEL SECURITY;

-- บันทึกการเจนทุกครั้ง: คุมโควตาฟรีรายคน + งบรวมของแพลตฟอร์ม (ไม่เก็บคำสั่งวาดในตารางนี้ เก็บแค่ตัวเลข)
CREATE TABLE IF NOT EXISTS imagegen_usage (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month            text NOT NULL,                       -- YYYY-MM (เวลาไทย)
  free_used        boolean NOT NULL DEFAULT false,      -- ใช้โควตาฟรีหรือไม่
  credits_charged  numeric(14, 2) NOT NULL DEFAULT 0,
  cost_thb         numeric(12, 4) NOT NULL,             -- ต้นทุนของเราโดยประมาณ (ตามอัตราที่แอดมินตั้ง)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_imagegen_usage_month ON imagegen_usage (month);
CREATE INDEX IF NOT EXISTS idx_imagegen_usage_user ON imagegen_usage (user_id, month);
ALTER TABLE imagegen_usage ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value, note) VALUES
  ('imagegen_free_per_month',   '10',  'เจนภาพ: โควตาฟรีต่อคนต่อเดือน (จำนวนภาพ) เกินแล้วหักเครดิต'),
  ('imagegen_credits_per_image','3',   'เจนภาพ: เกินโควตาฟรีแล้วหักกี่เครดิตต่อภาพ'),
  ('imagegen_cost_thb_per_image','1',  'เจนภาพ: ต้นทุนจริงของเราต่อภาพ (บาท) ใช้คิดงบรวม — ประมาณการ ตรวจจากบิล Google Cloud แล้วปรับ'),
  ('imagegen_monthly_budget_thb','100','เจนภาพ: งบรวมของแพลตฟอร์มต่อเดือน (บาท) ครบแล้วปิดเจนภาพทั้งระบบ (0 = ปิดทั้งหมด)')
ON CONFLICT (key) DO NOTHING;
