// ปฏิทิน & เตือน: สร้าง/ดู/ลบนัดหมาย + กดรับทราบ — ทุกฟังก์ชันรับ userId จากฝั่งเซิร์ฟเวอร์เสมอ (ของใครของมัน)
// เวลาทุกอย่างตีความเป็นเวลาไทย (Asia/Bangkok, UTC+7) ไม่ขึ้นกับเขตเวลาของเซิร์ฟเวอร์/เบราว์เซอร์
const { query } = require('./db');

const MAX_TITLE = 120;
const MAX_NOTE = 500;
const MAX_UPCOMING = 200;                    // นัดที่ยังไม่ถึงวัน ต่อคน
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALLDAY_REMIND_HOUR = '08:00';          // นัดทั้งวัน: เตือนตอน 8 โมงเช้าของวันนั้น (ถ้าไม่ระบุอย่างอื่น)

class CalendarError extends Error {}

const bkkDateKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);   // YYYY-MM-DD

// "2026-12-01" + "10:00" (เวลาไทย) → Date  (ปฏิเสธวันที่ที่ไม่มีจริง เช่น 31 ก.พ.)
function bangkokDate(dateStr, timeStr) {
  if (!DATE_RE.test(String(dateStr || ''))) throw new CalendarError('วันที่ไม่ถูกต้อง (ใช้รูปแบบ ปปปป-ดด-วว ปีเป็น ค.ศ.)');
  if (timeStr && !TIME_RE.test(timeStr)) throw new CalendarError('เวลาไม่ถูกต้อง (ใช้รูปแบบ ชช:นน แบบ 24 ชั่วโมง)');
  const d = new Date(`${dateStr}T${timeStr || '00:00'}:00+07:00`);
  if (Number.isNaN(d.getTime()) || bkkDateKey(d) !== dateStr) throw new CalendarError('วันที่นี้ไม่มีในปฏิทิน');
  return d;
}

function fmtThai(date, allDay) {
  const d = new Date(date);
  const day = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  if (allDay) return day;
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day} เวลา ${t} น.`;
}

function nowText() {
  const d = new Date();
  const dow = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long' }).format(d);
  return `${dow}ที่ ${fmtThai(d)} (วันที่แบบ ค.ศ. ${bkkDateKey(d)})`;
}

const COLS = `id, title, note, all_day, created_via, remind_count, fail_count,
  event_at, remind_at, remind_sent_at, acknowledged_at,
  to_char(event_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS date_key,
  to_char(event_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time_key,
  to_char(remind_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS remind_date_key,
  to_char(remind_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS remind_time_key`;

function shape(r) {
  return {
    id: r.id, title: r.title, note: r.note || '', allDay: r.all_day, createdVia: r.created_via,
    date: r.date_key, time: r.all_day ? null : r.time_key,
    remindDate: r.remind_date_key, remindTime: r.remind_time_key,
    eventAt: r.event_at, remindAt: r.remind_at,
    reminded: r.remind_count > 0, acknowledged: !!r.acknowledged_at,
    due: !r.acknowledged_at && new Date(r.remind_at) <= new Date(),
  };
}

// remind: { mode: 'at' | 'minutes' | 'custom', minutes, date, time }
function computeRemindAt(eventAt, allDay, dateStr, remind) {
  const mode = (remind && remind.mode) || 'at';
  if (mode === 'at') return allDay ? bangkokDate(dateStr, ALLDAY_REMIND_HOUR) : eventAt;
  if (mode === 'minutes') {
    const m = Number(remind.minutes);
    if (!Number.isFinite(m) || m < 0 || m > 60 * 24 * 30) throw new CalendarError('ระบุเวลาเตือนล่วงหน้าเป็นนาที 0 ถึง 43,200 (30 วัน)');
    const base = allDay ? bangkokDate(dateStr, ALLDAY_REMIND_HOUR) : eventAt;
    return new Date(base.getTime() - m * 60000);
  }
  if (mode === 'custom') return bangkokDate(remind.date, remind.time || ALLDAY_REMIND_HOUR);
  throw new CalendarError('รูปแบบการเตือนไม่ถูกต้อง');
}

async function createEvent(userId, input, via = 'app') {
  const title = String((input && input.title) || '').replace(/\s+/g, ' ').trim();
  if (!title) throw new CalendarError('ต้องระบุชื่อนัดหมาย');
  if (title.length > MAX_TITLE) throw new CalendarError(`ชื่อนัดหมายยาวเกิน ${MAX_TITLE} ตัวอักษร`);
  const note = String((input && input.note) || '').trim();
  if (note.length > MAX_NOTE) throw new CalendarError(`บันทึกยาวเกิน ${MAX_NOTE} ตัวอักษร`);

  const allDay = !!(input && (input.allDay || !input.time));
  const eventAt = bangkokDate(input && input.date, allDay ? null : input.time);
  const now = Date.now();
  if (eventAt.getTime() < now - 24 * 3600 * 1000) throw new CalendarError('วันที่นัดผ่านไปแล้ว');
  if (eventAt.getTime() > now + 3 * 365 * 24 * 3600 * 1000) throw new CalendarError('นัดล่วงหน้าได้ไม่เกิน 3 ปี');

  const remindAt = computeRemindAt(eventAt, allDay, input.date, input.remind);
  if (remindAt.getTime() < now - 5 * 60000) throw new CalendarError('เวลาแจ้งเตือนผ่านไปแล้ว — เลือกเวลาเตือนที่ยังไม่ถึง หรือเตือน "ตรงเวลา"');
  if (remindAt.getTime() > eventAt.getTime() + 24 * 3600 * 1000) throw new CalendarError('เวลาแจ้งเตือนต้องไม่เกินวันนัดไปมากกว่า 1 วัน');

  const cnt = await query('SELECT count(*)::int AS n FROM events WHERE user_id = $1 AND event_at >= now()', [userId]);
  if (cnt.rows[0].n >= MAX_UPCOMING) throw new CalendarError(`มีนัดที่ยังไม่ถึงวันครบ ${MAX_UPCOMING} รายการแล้ว ลบรายการเก่าก่อน`);

  const r = await query(
    `INSERT INTO events (user_id, title, note, event_at, all_day, remind_at, created_via)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
    [userId, title, note || null, eventAt, allDay, remindAt, via === 'secretary' ? 'secretary' : 'app']
  );
  return shape(r.rows[0]);
}

// นัดทั้งเดือน (เดือนแบบ 'YYYY-MM' เวลาไทย)
async function listMonth(userId, ym) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''))) throw new CalendarError('เดือนไม่ถูกต้อง (ใช้ ปปปป-ดด)');
  const start = new Date(`${ym}-01T00:00:00+07:00`);
  const [y, m] = ym.split('-').map(Number);
  const end = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+07:00`);
  const r = await query(`SELECT ${COLS} FROM events WHERE user_id = $1 AND event_at >= $2 AND event_at < $3 ORDER BY event_at`, [userId, start, end]);
  return r.rows.map(shape);
}

// ช่วงวันที่ (ให้เลขาดูนัด) — from/to เป็น YYYY-MM-DD เวลาไทย (to นับรวมทั้งวัน)
async function listRange(userId, from, to) {
  const f = bangkokDate(from || bkkDateKey(new Date()));
  const t = bangkokDate(to || bkkDateKey(new Date(Date.now() + 30 * 24 * 3600 * 1000)));
  const end = new Date(t.getTime() + 24 * 3600 * 1000);
  const r = await query(`SELECT ${COLS} FROM events WHERE user_id = $1 AND event_at >= $2 AND event_at < $3 ORDER BY event_at LIMIT 60`, [userId, f, end]);
  return r.rows.map(shape);
}

// ถึงเวลาเตือนแล้วแต่ยังไม่กดรับทราบ (ให้หน้าแอปเด้ง popup)
async function listDue(userId) {
  const r = await query(
    `SELECT ${COLS} FROM events WHERE user_id = $1 AND acknowledged_at IS NULL AND remind_at <= now() AND event_at > now() - interval '7 days'
      ORDER BY remind_at LIMIT 20`, [userId]);
  return r.rows.map(shape);
}

async function acknowledge(userId, id) {
  const r = await query('UPDATE events SET acknowledged_at = now() WHERE id = $1 AND user_id = $2 AND acknowledged_at IS NULL RETURNING title', [id, userId]);
  return r.rows[0] ? { ok: true, title: r.rows[0].title } : null;
}

async function removeEvent(userId, id) {
  const r = await query('DELETE FROM events WHERE id = $1 AND user_id = $2 RETURNING title', [id, userId]);
  return r.rows[0] ? { ok: true, title: r.rows[0].title } : null;
}

module.exports = { CalendarError, createEvent, listMonth, listRange, listDue, acknowledge, removeEvent, fmtThai, nowText, bangkokDate, bkkDateKey };
