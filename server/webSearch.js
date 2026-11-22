// ค้นข้อมูลภายนอกด้วย Google ให้เลขา — ควบคุมสิทธิ์/โควตา/คำขอไปทางไลน์
// หลักการ: (1) เลขาต้องถามผู้ใช้ก่อนค้น (คุมด้วย prompt ใน secretary.js) (2) ผู้ใช้ที่แอดมินยังไม่เปิดสิทธิ์ → ส่งคำร้องไปทางไลน์ให้แอดมินกดอนุญาต
// ส่วนคนที่เปิดสิทธิ์อยู่แล้วค้นได้เลยไม่ต้องขอ (3) ผลค้นเป็นข้อมูลดิบภายนอก ไม่บันทึกเป็นความจำส่วนตัว (บังคับใน secretary.js/chat.js)
const { query } = require('./db');
const ai = require('./ai');
const line = require('./line');

const MAX_QUERY_CHARS = 150;
const REQUEST_COOLDOWN_MIN = 10;     // ส่งคำร้องซ้ำได้อย่างน้อยห่างกันกี่นาที (กันสแปมแอดมิน)

// เดือนปัจจุบันเวลาไทย รูปแบบ 2026-11 — ตัวนับของเดือนอื่นถือเป็น 0 (รีเซ็ตเองทุกวันที่ 1)
function currentMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(new Date());
}

async function getLimit() {
  const r = await query("SELECT value FROM app_settings WHERE key = 'google_search_limit'");
  return Number(r.rows[0] && r.rows[0].value) || 100;
}

// ส่งคำร้องให้แอดมินทุกคนที่ผูกไลน์ไว้ (มีปุ่ม อนุญาต/ไม่อนุญาต) — คืนสถานะคำร้องของผู้ใช้
async function requestPermission(userId, topic) {
  const u = await query('SELECT name, google_search_enabled FROM users WHERE id = $1', [userId]);
  if (!u.rows[0]) throw new Error('ไม่พบบัญชี');
  if (u.rows[0].google_search_enabled) return { status: 'already_enabled' };

  const pend = await query("SELECT id, created_at FROM google_requests WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [userId]);
  if (pend.rows[0]) return { status: 'pending', requestId: pend.rows[0].id, alreadyExisted: true };
  const recent = await query(
    `SELECT 1 FROM google_requests WHERE user_id = $1 AND status = 'denied' AND decided_at > now() - ($2 || ' minutes')::interval LIMIT 1`,
    [userId, String(REQUEST_COOLDOWN_MIN)]
  );
  if (recent.rows[0]) return { status: 'denied_recently' };

  const t = String(topic || '').split(/\s+/).join(' ').trim().slice(0, MAX_QUERY_CHARS);
  const r = await query('INSERT INTO google_requests (user_id, topic) VALUES ($1, $2) RETURNING id', [userId, t || null]);
  const admins = await query("SELECT line_user_id FROM users WHERE is_admin AND status = 'active' AND line_user_id IS NOT NULL");
  let notified = 0;
  if (line.isConfigured()) {
    const text = `คุณ${u.rows[0].name} ขอสิทธิ์ให้เลขาค้นข้อมูลภายนอกด้วย Google${t ? ' เรื่อง "' + t + '"' : ''} กดอนุญาตเพื่อเปิดสิทธิ์ให้คนนี้ค่ะ`;
    for (const a of admins.rows) {
      try {
        await line.pushButtons(a.line_user_id, text, text, [
          { label: 'อนุญาต', data: `act=google&d=approve&id=${r.rows[0].id}` },
          { label: 'ไม่อนุญาต', data: `act=google&d=deny&id=${r.rows[0].id}` },
        ]);
        notified++;
      } catch (err) { console.error('notify admin google request failed:', err.message); }
    }
  }
  return { status: 'pending', requestId: r.rows[0].id, alreadyExisted: false, adminsNotified: notified };
}

// แอดมินตัดสิน (จากปุ่มในไลน์) — อนุญาต = เปิดสิทธิ์ค้นหา Google ให้ผู้ขอ แล้วแจ้งผู้ขอทางไลน์
async function decideRequest(adminUserId, requestId, approve) {
  const a = await query("SELECT 1 FROM users WHERE id = $1 AND is_admin AND status = 'active'", [adminUserId]);
  if (!a.rows[0]) throw new Error('เฉพาะแอดมินเท่านั้นที่อนุมัติได้');
  const r = await query(
    `UPDATE google_requests SET status = $3, decided_by = $2, decided_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING user_id, topic`,
    [String(requestId || ''), adminUserId, approve ? 'approved' : 'denied']
  );
  if (!r.rows[0]) throw new Error('ไม่พบคำร้องนี้ หรือมีคนตัดสินไปแล้ว');
  if (approve) await query('UPDATE users SET google_search_enabled = true WHERE id = $1', [r.rows[0].user_id]);
  try {
    const u = await query('SELECT line_user_id FROM users WHERE id = $1', [r.rows[0].user_id]);
    if (u.rows[0] && u.rows[0].line_user_id && line.isConfigured()) {
      await line.pushText(u.rows[0].line_user_id, approve ? 'แอดมินอนุญาตให้เลขาค้นข้อมูลด้วย Google ให้คุณแล้วค่ะ บอกเลขาให้ค้นอีกครั้งได้เลย' : 'แอดมินยังไม่อนุญาตให้ค้นข้อมูลด้วย Google ในตอนนี้ค่ะ');
    }
  } catch (err) { console.error('notify requester failed:', err.message); }
  return { approved: !!approve, userId: r.rows[0].user_id };
}

// ค้นจริง: ต้องมีสิทธิ์ + ไม่เกินโควตา — คืน { ok, findings, sources } หรือ { needsApproval } / { error }
async function search(userId, rawQuery, opts = {}) {
  const q = String(rawQuery || '').split(/\s+/).join(' ').trim();
  if (q.length < 3) return { error: 'ระบุสิ่งที่จะค้นให้ชัดเจนก่อน (อย่างน้อย 3 ตัวอักษร)' };
  if (q.length > MAX_QUERY_CHARS) return { error: `คำค้นยาวเกิน ${MAX_QUERY_CHARS} ตัวอักษร ย่อให้เหลือเฉพาะเรื่องที่ต้องการ` };
  const month = currentMonth();
  const u = await query('SELECT google_search_enabled, google_search_count, google_search_month FROM users WHERE id = $1', [userId]);
  if (!u.rows[0]) return { error: 'ไม่พบบัญชี' };
  const usedThisMonth = u.rows[0].google_search_month === month ? u.rows[0].google_search_count : 0;
  if (!u.rows[0].google_search_enabled) {
    const req = await requestPermission(userId, q);
    return { needsApproval: true, requestStatus: req.status, message: req.status === 'denied_recently' ? 'แอดมินเพิ่งปฏิเสธคำขอไป รอสักพักค่อยขอใหม่' : 'ส่งคำร้องให้แอดมินยืนยันทางไลน์แล้ว รอแอดมินอนุญาต เมื่ออนุญาตระบบจะแจ้งผู้ใช้ทางไลน์ ให้บอกผู้ใช้ตามนี้ ห้ามลองค้นซ้ำ' };
  }
  const limit = await getLimit();
  if (usedThisMonth >= limit) return { error: `ใช้สิทธิ์ค้นหาด้วย Google ครบ ${limit} ครั้งในเดือนนี้แล้ว (รีเซ็ตทุกวันที่ 1) ให้แจ้งผู้ใช้รอเดือนหน้า หรือติดต่อแอดมินเพื่อเพิ่มโควตา` };
  let out;
  try { out = await ai.googleSearch(q, opts.topic || ''); } catch (err) { console.error('google search failed:', err.message); return { error: 'ค้นข้อมูลไม่สำเร็จในตอนนี้ ลองใหม่อีกครั้งภายหลัง' }; }
  // นับเฉพาะที่ค้นสำเร็จ — ถ้าเป็นเดือนใหม่เริ่มนับที่ 1
  await query('UPDATE users SET google_search_count = CASE WHEN google_search_month = $2 THEN google_search_count + 1 ELSE 1 END, google_search_month = $2 WHERE id = $1', [userId, month]);
  return { ok: true, searched: q, findings: out.text || '(ไม่พบข้อมูลที่เชื่อถือได้)', sources: (out.sources || []).map((x) => x.title).filter(Boolean) };   // ส่งแค่ชื่อเว็บให้เลขา (ลิงก์ยาวมากกิน token)
}

module.exports = { search, requestPermission, decideRequest, currentMonth, MAX_QUERY_CHARS };
