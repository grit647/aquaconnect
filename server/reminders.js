// ส่งแจ้งเตือนนัดหมายทางไลน์ (พร้อมปุ่ม "รับทราบแล้ว") เมื่อถึงเวลา
// เรียกจาก: ตัวจับเวลาในเซิร์ฟเวอร์ทุก 1 นาที (ตอนเซิร์ฟเวอร์ตื่นอยู่) + ทุกครั้งที่มีคนยิง /api/health (UptimeRobot ทุก 5 นาทีปลุกเซิร์ฟเวอร์ Render ให้ทันเวลา)
// ปลอดภัยต่อการเรียกซ้อน: จองแถวด้วย FOR UPDATE SKIP LOCKED ก่อนส่ง ไม่มีทางส่งซ้ำจากการรันสองรอบพร้อมกัน
const { query } = require('./db');
const line = require('./line');
const { fmtThai } = require('./calendar');

const MAX_FAILS = 5;
const BATCH = 30;
const MIN_GAP_MS = 20000;            // กันถูกเรียกถี่เกินไป (เช่น คนยิง health รัวๆ)
let lastRun = 0;
let running = false;

async function setting(key, fallback) {
  const r = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  const n = Number(r.rows[0] && r.rows[0].value);
  return Number.isFinite(n) ? n : fallback;
}

// ข้อความ (ไม่เกิน 160 ตัวอักษรตามข้อจำกัดของข้อความมีปุ่มของไลน์)
function buildText(ev) {
  const head = `🔔 ${ev.title}`.slice(0, 70);
  const when = `\n📅 ${fmtThai(ev.event_at, ev.all_day)}`;
  const room = 160 - head.length - when.length - 1;
  const note = ev.note && room > 12 ? '\n' + (ev.note.length > room ? ev.note.slice(0, room - 1) + '…' : ev.note) : '';
  return (head + when + note).slice(0, 160);
}

// userIds: ใช้ตอนทดสอบเท่านั้น — จำกัดให้ประมวลผลเฉพาะผู้ใช้ทดสอบ (กันชุดทดสอบ "แอบกวาด" นัดจริงของผู้ใช้จริงไปทำเครื่องหมายว่าส่งแล้วทั้งที่ใช้ตัวส่งจำลอง)
async function runDueReminders({ force = false, userIds = null } = {}) {
  const now = Date.now();
  if (running || (!force && now - lastRun < MIN_GAP_MS)) return { skipped: true };
  running = true; lastRun = now;
  const result = { claimed: 0, sent: 0, noLine: 0, failed: 0 };
  try {
    const [repeatMax, repeatMin] = await Promise.all([setting('reminder_repeat_max', 1), setting('reminder_repeat_min', 30)]);
    const claimed = await query(
      `UPDATE events e SET remind_sent_at = now(), remind_count = e.remind_count + 1
        WHERE e.id IN (
          SELECT id FROM events
           WHERE acknowledged_at IS NULL AND remind_at <= now() AND fail_count < $1
             AND event_at > now() - interval '2 days'
             AND (remind_count = 0 OR (remind_count <= $2 AND remind_sent_at <= now() - ($3 || ' minutes')::interval))
             AND ($5::uuid[] IS NULL OR user_id = ANY($5::uuid[]))
           ORDER BY remind_at LIMIT $4 FOR UPDATE SKIP LOCKED)
        RETURNING e.id, e.user_id, e.title, e.note, e.event_at, e.all_day, e.remind_count`,
      [MAX_FAILS, Math.max(0, Math.round(repeatMax)), String(Math.max(1, Math.round(repeatMin))), BATCH, userIds]
    );
    result.claimed = claimed.rows.length;
    for (const ev of claimed.rows) {
      const u = await query("SELECT line_user_id FROM users WHERE id = $1 AND status = 'active'", [ev.user_id]);
      const lineId = u.rows[0] && u.rows[0].line_user_id;
      if (!lineId || !line.isConfigured()) {
        // ไม่มีไลน์ให้ส่ง: ไม่ต้องรอส่งซ้ำ (คนนี้จะเห็นในแอปเป็น popup ตอนเปิดแอป)
        await query('UPDATE events SET remind_count = $2 WHERE id = $1', [ev.id, Math.round(repeatMax) + 1]);
        result.noLine++;
        continue;
      }
      try {
        await line.pushButtons(lineId, `🔔 ${ev.title}`, buildText(ev), [{ label: 'รับทราบแล้ว', data: `act=remind&id=${ev.id}` }]);
        result.sent++;
      } catch (err) {
        console.error('[reminders] ส่งไลน์ไม่สำเร็จ:', err.message);
        await query(
          `UPDATE events SET fail_count = fail_count + 1, remind_count = GREATEST(remind_count - 1, 0),
                  remind_sent_at = CASE WHEN remind_count - 1 <= 0 THEN NULL ELSE remind_sent_at END WHERE id = $1`, [ev.id]);
        result.failed++;
      }
    }
  } finally {
    running = false;
  }
  return result;
}

module.exports = { runDueReminders, buildText };
