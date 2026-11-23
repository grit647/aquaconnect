// เสียงเลขาพรีเมียม — แปลงข้อความเป็นเสียงด้วย Gemini TTS ผ่าน Vertex AI (บัญชี service account เดียวกับสมองเลขา)
// กติกา: (1) ต้องมีสิทธิ์ (แอดมินเปิดรายคน users.tts_enabled) (2) งบรวมของแพลตฟอร์มต่อเดือนต้องยังไม่หมด
//        (3) ใช้โควตาฟรีต่อเดือนก่อน เกินแล้วหักเครดิต (credit_ledger type 'spend' ref 'tts') (4) ไม่เก็บข้อความ/เสียงที่พูด เก็บแค่ตัวเลขการใช้
// ฝั่งหน้าจอถ้าได้ error อะไรก็ตามจะถอยกลับไปใช้เสียงเบราว์เซอร์ (ฟรี) — ผู้ใช้ไม่เจอเสียงเงียบ
const { query, withTransaction } = require('./db');
const credits = require('./credits');
const aiLib = require('./ai');

const MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const LOCATION = process.env.TTS_LOCATION || 'global';   // ทดสอบจริง: โมเดลนี้ใช้ได้ที่ location global เท่านั้น (us-central1 = 404)
const VOICES = ['Kore', 'Aoede', 'Zephyr', 'Leda', 'Puck', 'Charon'];
const MAX_CHARS = 1200;
const EST_CHARS_PER_SEC = 9;      // ประมาณการก่อนสังเคราะห์ (วัดจริงภาษาไทย ~11 ตัวอักษร/วินาที — ใช้ค่าต่ำกว่าเพื่อกันประเมินต่ำไป)
const REQUEST_TIMEOUT_MS = 40000;

const round2 = (n) => Math.round(n * 100) / 100;
const monthNow = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);   // เดือนตามเวลาไทย

class TtsError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status || 400; }
}

async function setting(key, fallback) {
  const r = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  const n = Number(r.rows[0] && r.rows[0].value);
  return Number.isFinite(n) ? n : fallback;
}

// ความยาวเสียง (วินาที) จากไฟล์ที่โมเดลส่งกลับ: WAV มี header / PCM ดิบ (audio/L16;rate=24000)
function wavInfo(buf) {
  if (buf.length >= 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let off = 12; let byteRate = 0; let dataLen = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4); const len = buf.readUInt32LE(off + 4);
      if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
      if (id === 'data') { dataLen = Math.min(len, buf.length - off - 8); break; }
      off += 8 + len + (len % 2);
    }
    if (byteRate && dataLen) return { seconds: dataLen / byteRate };
  }
  return null;
}
function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// เรียก Gemini TTS จริง — คืน { wav: Buffer, seconds }
async function realSynth(text, voice) {
  const projectId = aiLib.getVertexProjectId();
  const token = await aiLib.getAccessToken();
  const host = LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${LOCATION}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Vertex TTS error (${res.status})`);
    const data = await res.json();
    const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData && p.inlineData.data);
    if (!part) throw new Error('Vertex TTS ไม่ส่งเสียงกลับมา');
    let buf = Buffer.from(part.inlineData.data, 'base64');
    const mime = String(part.inlineData.mimeType || '');
    if (!(buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF')) {
      const rate = Number((/rate=(\d+)/.exec(mime) || [])[1]) || 24000;
      buf = pcmToWav(buf, rate);
    }
    const info = wavInfo(buf);
    if (!info) throw new Error('อ่านความยาวเสียงไม่ได้');
    return { wav: buf, seconds: info.seconds };
  } finally {
    clearTimeout(timer);
  }
}
let synthImpl = realSynth;
function setSynthForTests(fn) { synthImpl = fn || realSynth; }

async function monthSpentThb() {
  const r = await query('SELECT COALESCE(sum(cost_thb), 0) AS s, COALESCE(sum(seconds), 0) AS sec FROM tts_usage WHERE month = $1', [monthNow()]);
  return { thb: Number(r.rows[0].s), seconds: Number(r.rows[0].sec) };
}

// สถานะของผู้ใช้คนหนึ่ง (หน้าจอใช้ตัดสินว่าจะโชว์ตัวเลือกเสียงพรีเมียมไหม + แสดงโควตาที่เหลือ)
async function status(userId) {
  const u = await query('SELECT tts_enabled, tts_seconds_month, tts_seconds_used FROM users WHERE id = $1', [userId]);
  const row = u.rows[0];
  if (!row) return { allowed: false };
  const [freeTotal, cpm, budget, voiceIdx, spent, balance] = await Promise.all([
    setting('tts_free_seconds_per_month', 300), setting('tts_credits_per_minute', 2), setting('tts_monthly_budget_thb', 200),
    setting('tts_voice_index', 0), monthSpentThb(), credits.getBalance(userId),
  ]);
  const used = row.tts_seconds_month === monthNow() ? Number(row.tts_seconds_used) : 0;
  const budgetOk = budget > 0 && spent.thb < budget;
  return {
    allowed: !!row.tts_enabled,
    available: !!row.tts_enabled && budgetOk,     // ใช้ได้จริงตอนนี้ (มีสิทธิ์ + งบรวมยังไม่หมด)
    budgetOk,
    freeSecondsTotal: freeTotal,
    freeSecondsLeft: Math.max(0, round2(freeTotal - used)),
    creditsPerMinute: cpm,
    balance,
    voice: VOICES[Math.min(VOICES.length - 1, Math.max(0, Math.round(voiceIdx)))],
  };
}

// สังเคราะห์เสียงให้ผู้ใช้: ตรวจสิทธิ์/งบ/โควตา/เครดิต → เรียกโมเดล → บันทึกการใช้ + หักเครดิตตามความยาวจริง
async function synthesizeForUser(userId, rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new TtsError('empty', 'ไม่มีข้อความให้อ่าน', 400);
  if (text.length > MAX_CHARS) throw new TtsError('too_long', `ข้อความยาวเกิน ${MAX_CHARS} ตัวอักษร`, 413);
  const st = await status(userId);
  if (!st.allowed) throw new TtsError('not_allowed', 'ยังไม่ได้เปิดสิทธิ์เสียงพรีเมียม (ขอแอดมินเปิดให้)', 403);
  if (!st.budgetOk) throw new TtsError('budget', 'งบเสียงพรีเมียมของแพลตฟอร์มเดือนนี้เต็มแล้ว (ใช้เสียงเบราว์เซอร์แทน)', 402);
  // ตรวจเครดิตล่วงหน้าด้วยความยาวที่ประมาณ (ส่วนที่เกินโควตาฟรีต้องมีเครดิตพอ)
  const estSec = Math.max(2, text.length / EST_CHARS_PER_SEC);
  const estPaid = Math.max(0, estSec - st.freeSecondsLeft);
  const estCredits = round2((estPaid / 60) * st.creditsPerMinute);
  if (estCredits > st.balance) throw new TtsError('no_credit', `โควตาเสียงฟรีเดือนนี้หมดแล้ว และเครดิตไม่พอ (ต้องใช้ราว ${estCredits} เครดิต)`, 402);

  const { wav, seconds } = await synthImpl(text, st.voice);

  const [costPerMin] = await Promise.all([setting('tts_cost_thb_per_minute', 0.5)]);
  const month = monthNow();
  const freeUse = Math.min(seconds, st.freeSecondsLeft);
  const paidSec = Math.max(0, seconds - freeUse);
  let charged = paidSec > 0 ? Math.max(0.01, round2((paidSec / 60) * st.creditsPerMinute)) : 0;
  await withTransaction(async (c) => {
    if (charged > 0) {
      try { await credits.applyDeltaIn(c, userId, -charged, 'spend', 'tts', null, `เสียงเลขาพรีเมียม ${Math.round(paidSec)} วินาที`); }
      catch (err) { if (err.code === 'INSUFFICIENT_CREDIT') charged = 0; else throw err; }   // เครดิตหมดระหว่างทาง (แทบไม่เกิด) — ส่งเสียงให้ ไม่หักเกินที่มี
    }
    await c.query(
      `UPDATE users SET tts_seconds_used = (CASE WHEN tts_seconds_month = $2 THEN tts_seconds_used ELSE 0 END) + $3, tts_seconds_month = $2 WHERE id = $1`,
      [userId, month, round2(seconds)]
    );
    await c.query(
      'INSERT INTO tts_usage (user_id, month, chars, seconds, free_seconds, credits_charged, cost_thb) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, month, text.length, round2(seconds), round2(freeUse), charged, Math.round((seconds / 60) * costPerMin * 10000) / 10000]
    );
  });
  return { wav, seconds: round2(seconds), freeSecondsLeft: Math.max(0, round2(st.freeSecondsLeft - freeUse)), creditsCharged: charged };
}

module.exports = { status, synthesizeForUser, setSynthForTests, monthSpentThb, monthNow, wavInfo, pcmToWav, TtsError, VOICES, MAX_CHARS };
