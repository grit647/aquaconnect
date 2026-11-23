// ห้องสัมมนา / ประชุมออนไลน์ — สร้างห้อง (ลิงก์สุ่ม) + ให้คนที่มีลิงก์เข้าได้ ตัววิดีโอใช้ Jitsi Meet ฝังในหน้า /meet/<code>
// ฝั่งเซิร์ฟเวอร์ไม่แตะภาพ/เสียงเลย: เก็บแค่ "ห้อง" (ชื่อ ประเภท ผู้จัด วันหมดอายุ) • ชื่อห้องใน Jitsi สุ่มเดาไม่ได้ (ไม่ใช้ชื่อที่ผู้ใช้ตั้ง)
const crypto = require('crypto');
const { query } = require('./db');
const jaas = require('./jaas');

const TYPES = { meeting: 'ประชุม', seminar: 'สัมมนา' };
const MAX_TITLE = 80;
const CODE_RE = /^[a-z0-9]{12}$/;

async function setting(key, fallback) {
  const r = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  const n = Number(r.rows[0] && r.rows[0].value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// รหัส 12 ตัว a-z0-9 (สุ่มจาก crypto) ~62 บิต เดาไม่ได้
function newCode() {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36];
  return out;
}

const roomName = (code) => 'aquaconnect-' + code;   // ชื่อห้องที่ส่งให้ Jitsi

function present(m, hostName) {
  return {
    id: m.id, code: m.code, title: m.title, type: m.type, typeLabel: TYPES[m.type] || m.type,
    createdAt: m.created_at, expiresAt: m.expires_at, ended: !!m.ended_at || new Date(m.expires_at) <= new Date(),
    hostName: hostName || undefined,
  };
}

async function createMeeting(userId, rawTitle, rawType) {
  const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('ตั้งชื่อห้องก่อน');
  if (title.length > MAX_TITLE) throw new Error(`ชื่อห้องยาวเกิน ${MAX_TITLE} ตัวอักษร`);
  const type = TYPES[rawType] ? rawType : 'meeting';
  const perDay = await setting('meetings_per_day', 5);
  const used = await query("SELECT count(*)::int AS n FROM meetings WHERE host_id = $1 AND created_at > now() - interval '24 hours'", [userId]);
  if (used.rows[0].n >= perDay) throw new Error(`วันนี้สร้างห้องครบ ${perDay} ห้องแล้ว ลองใหม่พรุ่งนี้ หรือจบห้องเก่าที่ไม่ใช้แล้ว`);
  const days = await setting('meeting_valid_days', 7);
  for (let i = 0; i < 5; i++) {
    try {
      const r = await query(
        `INSERT INTO meetings (code, host_id, title, type, expires_at) VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 day')) RETURNING *`,
        [newCode(), userId, title, type, days]
      );
      return present(r.rows[0]);
    } catch (err) { if (err.code !== '23505') throw err; }   // รหัสชนกัน (แทบไม่มี) → สุ่มใหม่
  }
  throw new Error('สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง');
}

async function myMeetings(userId) {
  const r = await query(
    "SELECT * FROM meetings WHERE host_id = $1 AND ended_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 20", [userId]);
  return r.rows.map((m) => present(m));
}

async function endMeeting(userId, id) {
  const r = await query('UPDATE meetings SET ended_at = now() WHERE id::text = $1 AND host_id = $2 AND ended_at IS NULL RETURNING id', [String(id || ''), userId]);
  if (!r.rows[0]) throw new Error('ไม่พบห้องนี้ของคุณ หรือจบไปแล้ว');
  return { ok: true };
}

// ข้อมูลห้องสำหรับหน้า /meet/<code> (เปิดสาธารณะ — คืนเฉพาะข้อมูลที่ต้องใช้เข้าห้อง ไม่มีเบอร์/ไอดีผู้จัด)
async function publicInfo(code, viewerUserId, viewerName) {
  const c = String(code || '').toLowerCase();
  if (!CODE_RE.test(c)) return null;
  const r = await query('SELECT m.*, u.name AS host_name FROM meetings m JOIN users u ON u.id = m.host_id WHERE m.code = $1', [c]);
  const m = r.rows[0];
  if (!m) return null;
  const out = present(m, m.host_name);
  out.room = roomName(m.code);
  out.isHost = !!viewerUserId && String(m.host_id) === String(viewerUserId);
  // ใช้ JaaS (ผู้จัดเป็น moderator โดยไม่ต้องล็อกอิน Jitsi) เมื่อตั้งค่าไว้ครบ — โทเค็นออกให้เฉพาะผู้จัดตัวจริงของห้องนี้ ผู้เข้าร่วมอื่นไม่ต้องมีโทเค็น
  if (jaas.configured() && !out.ended) {
    out.jaas = { appId: jaas.appId(), room: m.code };
    if (out.isHost) out.jaas.jwt = jaas.hostToken({ room: m.code, userId: m.host_id, name: viewerName || out.hostName });
  }
  return out;
}

module.exports = { createMeeting, myMeetings, endMeeting, publicInfo, roomName, TYPES, CODE_RE };
