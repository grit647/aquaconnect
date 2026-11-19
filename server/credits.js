// ระบบเครดิต (ระยะ 3): ยอดคงเหลือ + สมุดบัญชี + เติมเงิน (สลิป → AI อ่านยอด → แอดมินยืนยัน) + คิดเงินตอนถามหมวดเสียเงิน
// กฎเหล็ก: ทุกการเปลี่ยนยอดต้องผ่าน applyDelta ใน transaction เดียว (ล็อกแถวยอดก่อน) และมีแถวในสมุดบัญชีเสมอ
const crypto = require('crypto');
const { query, withTransaction } = require('./db');
const ai = require('./ai');
const line = require('./line');

const MAX_SLIP_BASE64 = 2 * 1024 * 1024;          // ~1.5MB ของรูปจริง (หน้าเว็บย่อรูปมาก่อนแล้ว)
const SLIP_MIME_RE = /^image\/(jpeg|png|webp)$/;
const MAX_PENDING_TOPUPS = 3;

const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function setting(key, fallback) {
  const r = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  const n = Number(r.rows[0] && r.rows[0].value);
  return Number.isFinite(n) ? n : fallback;
}

class InsufficientCredit extends Error {
  constructor(need, have) {
    super(`เครดิตไม่พอ ต้องใช้ ${round2(need)} เครดิต แต่มี ${round2(have)} เครดิต (เติมเครดิตได้ที่เมนู "เครดิต")`);
    this.need = need; this.have = have; this.code = 'INSUFFICIENT_CREDIT';
  }
}

async function getBalance(userId) {
  const r = await query('SELECT balance FROM credit_balances WHERE user_id = $1', [userId]);
  return r.rows[0] ? Number(r.rows[0].balance) : 0;
}

// ปรับยอดใน transaction ที่เปิดอยู่แล้ว (c) — ล็อกแถวยอดของผู้ใช้ ห้ามติดลบ
async function applyDelta(c, userId, amount, type, refType, refId, note) {
  amount = round2(amount);
  if (!amount) return null;
  await c.query('INSERT INTO credit_balances (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const b = await c.query('SELECT balance FROM credit_balances WHERE user_id = $1 FOR UPDATE', [userId]);
  const have = Number(b.rows[0].balance);
  const after = round2(have + amount);
  if (after < 0) throw new InsufficientCredit(-amount, have);
  await c.query('UPDATE credit_balances SET balance = $2, updated_at = now() WHERE user_id = $1', [userId, after]);
  await c.query(
    'INSERT INTO credit_ledger (user_id, amount, type, ref_type, ref_id, note, balance_after) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [userId, amount, type, refType || null, refId ? String(refId) : null, note || null, after]
  );
  return after;
}

async function notifyUser(userId, text) {
  try {
    if (!line.isConfigured()) return;
    const u = await query('SELECT line_user_id FROM users WHERE id = $1', [userId]);
    if (u.rows[0] && u.rows[0].line_user_id) await line.pushText(u.rows[0].line_user_id, text);
  } catch (err) { console.error('credits notify failed:', err.message); }
}

// ---------- ภาพรวมของฉัน ----------
async function myCredits(userId) {
  const [balance, ledger, pending, qr] = await Promise.all([
    getBalance(userId),
    query('SELECT amount, type, note, balance_after, created_at FROM credit_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [userId]),
    query("SELECT count(*)::int AS n FROM topups WHERE user_id = $1 AND status = 'pending'", [userId]),
    query("SELECT 1 FROM app_settings WHERE key = 'payment_qr'"),
  ]);
  return {
    balance,
    ledger: ledger.rows.map((r) => ({ ...r, amount: Number(r.amount), balance_after: Number(r.balance_after) })),
    pendingTopups: pending.rows[0].n,
    qrAvailable: !!qr.rows[0],
  };
}

// ---------- เติมเงิน ----------
async function createTopup(userId, amountClaimed, slipBase64, mime) {
  const amount = round2(amountClaimed);
  const [min, max] = await Promise.all([setting('topup_min', 20), setting('topup_max', 20000)]);
  if (!(amount >= min) || amount > max) throw new Error(`ยอดเติมต้องอยู่ระหว่าง ${min} ถึง ${max} บาท`);
  if (typeof slipBase64 !== 'string' || !slipBase64) throw new Error('แนบรูปสลิปด้วย');
  if (slipBase64.length > MAX_SLIP_BASE64) throw new Error('รูปสลิปใหญ่เกินไป');
  if (!SLIP_MIME_RE.test(String(mime))) throw new Error('รูปสลิปต้องเป็น JPG, PNG หรือ WEBP');
  const buf = Buffer.from(slipBase64, 'base64');
  if (!buf.length) throw new Error('รูปสลิปไม่ถูกต้อง');

  const pending = await query("SELECT count(*)::int AS n FROM topups WHERE user_id = $1 AND status = 'pending'", [userId]);
  if (pending.rows[0].n >= MAX_PENDING_TOPUPS) throw new Error('มีรายการรอตรวจสอบหลายรายการแล้ว รอแอดมินยืนยันก่อนนะคะ');

  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const dup = await query("SELECT 1 FROM topups WHERE slip_hash = $1 AND status <> 'rejected'", [hash]);
  if (dup.rows[0]) throw new Error('สลิปใบนี้เคยส่งเข้ามาแล้ว');

  let read = null;
  try { read = await ai.readSlipAmount(slipBase64, mime); } catch (err) { console.error('slip read failed:', err.message); }
  const r = await query(
    `INSERT INTO topups (user_id, amount_claimed, slip_amount_read, slip_data, slip_mime, slip_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, amount, read, slipBase64, mime, hash]
  );
  return { topupId: r.rows[0].id, slipAmountRead: read, amountClaimed: amount };
}

async function approveTopup(adminId, topupId, amount) {
  const result = await withTransaction(async (c) => {
    const t = await c.query("SELECT id, user_id, amount_claimed FROM topups WHERE id = $1 AND status = 'pending' FOR UPDATE", [topupId]);
    if (!t.rows[0]) throw new Error('ไม่พบรายการ หรือถูกตัดสินไปแล้ว');
    const max = await setting('topup_max', 20000);
    const final = round2(amount === undefined || amount === null || amount === '' ? t.rows[0].amount_claimed : amount);
    if (!(final > 0) || final > max) throw new Error('ยอดที่ยืนยันไม่ถูกต้อง');
    await c.query("UPDATE topups SET status = 'approved', reviewed_by = $2, reviewed_at = now(), approved_amount = $3 WHERE id = $1", [topupId, adminId, final]);
    const after = await applyDelta(c, t.rows[0].user_id, final, 'topup', 'topup', topupId, 'เติมเครดิต');
    return { userId: t.rows[0].user_id, amount: final, balanceAfter: after };
  });
  await notifyUser(result.userId, `เติมเครดิตสำเร็จ ${result.amount} เครดิต ยอดคงเหลือ ${result.balanceAfter} เครดิตค่ะ`);
  return result;
}

async function rejectTopup(adminId, topupId, note) {
  const r = await query(
    "UPDATE topups SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), note = $3 WHERE id = $1 AND status = 'pending' RETURNING user_id",
    [topupId, adminId, String(note || '').slice(0, 200) || null]
  );
  if (!r.rows[0]) throw new Error('ไม่พบรายการ หรือถูกตัดสินไปแล้ว');
  await notifyUser(r.rows[0].user_id, 'ขออภัยค่ะ รายการเติมเครดิตของคุณไม่ผ่านการตรวจสอบ หากโอนแล้วโปรดติดต่อแอดมิน');
  return { ok: true };
}

// ---------- คิดเงินตอนถามหมวดเสียเงิน ----------
// question: คิดต่อคำถาม • hour: คิดตามเวลา เป็นก้อนละ idle_timeout_min นาที (ราคาต่อชั่วโมง/60 × นาที)
//   ถามครั้งแรก = จ่ายก้อนแรกทันที ถามต่อในรอบเดียวกัน (ไม่เงียบเกิน idle) = จ่ายเพิ่มเมื่อเวลาเกินที่จ่ายไปแล้วเท่านั้น
// ทั้งหมดอยู่ใน transaction เดียว: เครดิตไม่พอ = ไม่หักอะไร ไม่เปิดรอบ
async function chargeAsk({ requesterId, ownerId, categoryId, priceType, unitPrice }) {
  const [idleMin, commission] = await Promise.all([setting('idle_timeout_min', 5), setting('commission_rate', 20)]);
  const block = Math.max(1, Math.round(idleMin));
  const rate = Math.min(100, Math.max(0, commission));
  unitPrice = Number(unitPrice) || 0;

  return withTransaction(async (c) => {
    const s = await c.query(
      `SELECT id, started_at, units_billed, commission_rate FROM access_sessions
        WHERE requester_id = $1 AND category_id = $2 AND ended_at IS NULL
          AND last_activity_at > now() - ($3 || ' minutes')::interval
        ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
      [requesterId, categoryId, String(block)]
    );
    const session = s.rows[0] || null;

    let units; let cost;
    if (priceType !== 'hour') {          // question หรือหมวดฟรี (priceType ว่าง, ราคา 0 → cost 0)
      units = 1; cost = round2(unitPrice || 0);
    } else {
      if (!session) {
        units = block;
      } else {
        const elapsedMin = (Date.now() - new Date(session.started_at).getTime()) / 60000;
        const over = elapsedMin - session.units_billed;
        units = over > 0 ? Math.ceil(over / block) * block : 0;
      }
      cost = round2((unitPrice / 60) * units);
    }
    // รอบที่เปิดอยู่ใช้อัตราส่วนแบ่งตอนเปิดรอบเสมอ (เปลี่ยนค่าตั้งกลางรอบไม่ทำให้ยอดเพี้ยน)
    const useRate = session ? Number(session.commission_rate) : rate;
    const fee = round2((cost * useRate) / 100);
    const earned = round2(cost - fee);

    let sessionId;
    if (session) {
      sessionId = session.id;
    } else {
      const ins = await c.query(
        `INSERT INTO access_sessions (requester_id, owner_id, category_id, price_type, unit_price, commission_rate)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [requesterId, ownerId, categoryId, priceType, unitPrice, rate]
      );
      sessionId = ins.rows[0].id;
    }

    let balanceAfter;
    if (cost > 0) {
      balanceAfter = await applyDelta(c, requesterId, -cost, 'spend', 'access_session', sessionId, 'ถามเลขาหมวดเสียเงิน');
      await applyDelta(c, ownerId, earned, 'earn', 'access_session', sessionId, 'รายได้จากการตอบ');
    } else {
      const b = await c.query('SELECT balance FROM credit_balances WHERE user_id = $1', [requesterId]);
      balanceAfter = b.rows[0] ? Number(b.rows[0].balance) : 0;
    }
    await c.query(
      `UPDATE access_sessions SET units_billed = units_billed + $2, credits_charged = credits_charged + $3,
              platform_fee = platform_fee + $4, owner_earned = owner_earned + $5, ask_count = ask_count + 1, last_activity_at = now()
        WHERE id = $1`,
      [sessionId, units, cost, fee, earned]
    );
    return { sessionId, cost, fee, earned, units, balanceAfter };
  });
}

// ถ้า AI ตอบไม่ได้หลังหักเงินไปแล้ว → คืนเงินผู้ถาม และดึงรายได้เจ้าของกลับ (เท่าที่ยังมีอยู่)
async function refundAsk(requesterId, ownerId, charge) {
  if (!charge || !(charge.cost > 0)) return;
  await withTransaction(async (c) => {
    await applyDelta(c, requesterId, charge.cost, 'refund', 'access_session', charge.sessionId, 'คืนเครดิต: เลขาตอบไม่สำเร็จ');
    await c.query('INSERT INTO credit_balances (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [ownerId]);
    const b = await c.query('SELECT balance FROM credit_balances WHERE user_id = $1 FOR UPDATE', [ownerId]);
    const back = Math.min(Number(b.rows[0].balance), charge.earned);
    if (back > 0) await applyDelta(c, ownerId, -back, 'adjust', 'access_session', charge.sessionId, 'ย้อนรายได้: เลขาตอบไม่สำเร็จ');
    await c.query(
      'UPDATE access_sessions SET credits_charged = credits_charged - $2, platform_fee = platform_fee - $3, owner_earned = owner_earned - $4 WHERE id = $1',
      [charge.sessionId, charge.cost, charge.fee, charge.earned]
    );
  });
}

module.exports = { getBalance, myCredits, createTopup, approveTopup, rejectTopup, chargeAsk, refundAsk, InsufficientCredit };
