-- เสียงเลขาพรีเมียม (Gemini TTS ผ่าน Vertex) — แอดมินเปิดสิทธิ์รายคน (ค่าเริ่มต้นปิด เหมือนสิทธิ์ค้น Google)
ALTER TABLE users ADD COLUMN IF NOT EXISTS tts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tts_seconds_month text;          -- เดือนที่นับวินาที (YYYY-MM) ขึ้นเดือนใหม่รีเซ็ตโควตาฟรี
ALTER TABLE users ADD COLUMN IF NOT EXISTS tts_seconds_used numeric(10, 2) NOT NULL DEFAULT 0;

-- บันทึกการสังเคราะห์เสียงทุกครั้ง: ใช้คุมงบรวมของแพลตฟอร์ม + ดูว่าใครใช้เท่าไหร่ (ไม่เก็บตัวข้อความที่พูด)
CREATE TABLE IF NOT EXISTS tts_usage (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month            text NOT NULL,                  -- YYYY-MM
  chars            integer NOT NULL,
  seconds          numeric(10, 2) NOT NULL,        -- ความยาวเสียงจริงที่ได้
  free_seconds     numeric(10, 2) NOT NULL DEFAULT 0,   -- ส่วนที่ใช้โควตาฟรี
  credits_charged  numeric(14, 2) NOT NULL DEFAULT 0,   -- เครดิตที่หักผู้ใช้
  cost_thb         numeric(12, 4) NOT NULL,        -- ต้นทุนของเราโดยประมาณ (ตามอัตราที่แอดมินตั้ง)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tts_usage_month ON tts_usage (month);
CREATE INDEX IF NOT EXISTS idx_tts_usage_user ON tts_usage (user_id, created_at DESC);
ALTER TABLE tts_usage ENABLE ROW LEVEL SECURITY;

INSERT INTO app_settings (key, value, note) VALUES
  ('tts_free_seconds_per_month', '300',  'เสียงพรีเมียม: โควตาฟรีต่อคนต่อเดือน (วินาที) เกินแล้วหักเครดิต'),
  ('tts_credits_per_minute',     '2',    'เสียงพรีเมียม: เกินโควตาฟรีแล้วหักกี่เครดิตต่อนาทีของเสียง'),
  ('tts_cost_thb_per_minute',    '0.5',  'เสียงพรีเมียม: ต้นทุนจริงของเราต่อนาทีเสียง (บาท) ใช้คิดงบรวม — ปรับเป็นราว 1 บาทตั้งแต่ 1 ม.ค. 2570 ตามราคาใหม่ของ Google'),
  ('tts_monthly_budget_thb',     '200',  'เสียงพรีเมียม: งบรวมของแพลตฟอร์มต่อเดือน (บาท) ครบแล้วปิดเสียงพรีเมียมทั้งระบบ (0 = ปิดทั้งหมด)'),
  ('tts_voice_index',            '0',    'เสียงพรีเมียม: เลขเสียงที่ใช้ (0 Kore, 1 Aoede, 2 Zephyr, 3 Leda, 4 Puck, 5 Charon)')
ON CONFLICT (key) DO NOTHING;
