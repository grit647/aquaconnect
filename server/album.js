// อัลบั้มรูปส่วนตัว — ผู้ใช้เพิ่มรูป เลขาอ่านรูปตอนอัปโหลด (บรรยาย+แท็ก) แล้วค้น/ดึงรูปมาแสดงในแชทได้
// หลักความปลอดภัย: ทุกฟังก์ชันรับ userId จากเซสชัน และกรอง owner_id เสมอ (ดู/ดึงรูปของคนอื่นไม่ได้ ผ่านทั้งหน้าจอและเครื่องมือของเลขา) • ตรวจไบต์หัวไฟล์จริง
// • ข้อความที่เลขาอ่านจากรูป (คำบรรยาย) ถือเป็นข้อมูลดิบ ไม่ใช่คำสั่ง — ถูกตัดความยาว/ล้างเครื่องหมายพิเศษก่อนเก็บ
const { query } = require('./db');
const aiLib = require('./ai');

const MAX_IMAGE_BYTES = 1500 * 1024;     // รูปหลักหลังย่อที่หน้าเว็บ
const MAX_THUMB_BYTES = 120 * 1024;
const MAX_CAPTION = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class AlbumError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
function decodeDataUrl(s, maxBytes, label) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m) throw new AlbumError(label + 'ต้องเป็นไฟล์ JPEG, PNG หรือ WebP');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > maxBytes) throw new AlbumError(label + 'ใหญ่เกินไป');
  const mime = sniffImage(buf);
  if (!mime) throw new AlbumError('ไฟล์ไม่ใช่รูปภาพที่รองรับ');
  return { buf, mime };
}
// ข้อความที่มาจากโมเดล/ผู้ใช้: ย่อ ล้างบรรทัดใหม่/ตัวควบคุม (กัน "คำสั่ง" ซ่อนในคำบรรยายรูป)
const cleanText = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function setting(key, fallback) {
  const r = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  const n = Number(r.rows[0] && r.rows[0].value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function usage(userId) {
  const [u, maxPhotos, maxMb] = await Promise.all([
    query('SELECT count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS b FROM album_photos WHERE owner_id = $1', [userId]),
    setting('album_max_photos', 30), setting('album_max_mb', 30),
  ]);
  return { count: u.rows[0].n, bytes: Number(u.rows[0].b), maxPhotos, maxBytes: maxMb * 1024 * 1024 };
}

const present = (r) => ({ id: r.id, caption: r.caption, description: r.description, tags: r.tags, createdAt: r.created_at });

async function listPhotos(userId, limit) {
  const r = await query('SELECT id, caption, description, tags, created_at FROM album_photos WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, Math.min(Math.max(Number(limit) || 100, 1), 200)]);
  return r.rows.map(present);
}

// ให้เลขาอ่านรูปตอนอัปโหลด (บรรยายสั้นๆ + แท็ก) — ล้มเหลวก็ไม่เป็นไร ผู้ใช้ตั้งชื่อเองได้
async function realDescribe(base64, mime) { return aiLib.describeImage(base64, mime); }
let describeImpl = realDescribe;
function setDescribeForTests(fn) { describeImpl = fn || realDescribe; }

async function addPhoto(userId, { image, thumb, caption }) {
  const img = decodeDataUrl(image, MAX_IMAGE_BYTES, 'รูป');
  const th = decodeDataUrl(thumb, MAX_THUMB_BYTES, 'รูปย่อ');
  const total = img.buf.length + th.buf.length;
  const u = await usage(userId);
  if (u.count >= u.maxPhotos) throw new AlbumError(`อัลบั้มเต็มแล้ว (เก็บได้ ${u.maxPhotos} รูป) ลบรูปเก่าก่อนจึงเพิ่มได้`, 409);
  if (u.bytes + total > u.maxBytes) throw new AlbumError(`พื้นที่อัลบั้มเต็มแล้ว (รวมไม่เกิน ${Math.round(u.maxBytes / 1048576)} MB) ลบรูปเก่าก่อนจึงเพิ่มได้`, 409);
  let d = { title: '', description: '', tags: [] };
  try { d = (await describeImpl(img.buf.toString('base64'), img.mime)) || d; } catch (err) { console.error('album describe error:', err.message); }
  const cap = cleanText(caption, MAX_CAPTION) || cleanText(d.title, MAX_CAPTION);
  const tags = (Array.isArray(d.tags) ? d.tags : []).map((t) => cleanText(t, 30)).filter(Boolean).slice(0, 8);
  const r = await query(
    'INSERT INTO album_photos (owner_id, caption, description, tags, mime, image, thumb, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, caption, description, tags, created_at',
    [userId, cap, cleanText(d.description, 400), tags, img.mime, img.buf, th.buf, total]
  );
  return present(r.rows[0]);
}

async function getImage(userId, id, wantThumb) {
  if (!UUID_RE.test(String(id))) return null;
  const r = await query(`SELECT mime, ${wantThumb ? 'thumb' : 'image'} AS data FROM album_photos WHERE id = $1 AND owner_id = $2`, [id, userId]);
  return r.rows[0] ? { mime: r.rows[0].mime, data: r.rows[0].data } : null;
}

async function updateCaption(userId, id, caption) {
  if (!UUID_RE.test(String(id))) throw new AlbumError('ไม่พบรูปนี้', 404);
  const r = await query('UPDATE album_photos SET caption = $3 WHERE id = $1 AND owner_id = $2 RETURNING id, caption, description, tags, created_at', [id, userId, cleanText(caption, MAX_CAPTION)]);
  if (!r.rows[0]) throw new AlbumError('ไม่พบรูปนี้', 404);
  return present(r.rows[0]);
}

async function deletePhoto(userId, id) {
  if (!UUID_RE.test(String(id))) throw new AlbumError('ไม่พบรูปนี้', 404);
  const r = await query('DELETE FROM album_photos WHERE id = $1 AND owner_id = $2 RETURNING id', [id, userId]);
  if (!r.rows[0]) throw new AlbumError('ไม่พบรูปนี้', 404);
  return { ok: true };
}

// ค้นสำหรับเลขา: แยกคำค้น แล้วจัดอันดับตามจำนวนคำที่ตรง (ชื่อ/คำบรรยาย/แท็ก) — ไม่ใส่คำค้น = รูปล่าสุด
async function searchForSecretary(userId, rawQuery, limit) {
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 12);
  const words = [...new Set(String(rawQuery || '').toLowerCase().split(/\s+/).map((w) => w.replace(/[%_\\]/g, '')).filter((w) => w.length >= 2))].slice(0, 6);
  const total = (await query('SELECT count(*)::int AS n FROM album_photos WHERE owner_id = $1', [userId])).rows[0].n;
  let rows;
  if (!words.length) {
    rows = (await query('SELECT id, caption, description, tags, created_at FROM album_photos WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, lim])).rows;
  } else {
    const params = [userId, lim]; const scoreParts = [];
    words.forEach((w) => { params.push('%' + w + '%'); scoreParts.push(`(CASE WHEN lower(caption || ' ' || description || ' ' || array_to_string(tags, ' ')) LIKE $${params.length} THEN 1 ELSE 0 END)`); });
    rows = (await query(
      `SELECT id, caption, description, tags, created_at, ${scoreParts.join(' + ')} AS score FROM album_photos WHERE owner_id = $1 ORDER BY score DESC, created_at DESC LIMIT $2`, params
    )).rows.filter((r) => Number(r.score) > 0);
  }
  // ภาษาไทยไม่เว้นวรรค คำค้นเต็มๆ อาจไม่ตรงตัวอักษรกับชื่อ/คำบรรยาย (เช่น ค้น "บ่อสีฟ้า" แต่รูปชื่อ "ภาพนามธรรมสีฟ้า") → ถ้าไม่เจอเลย ส่งรูปล่าสุดให้เลขาอ่านชื่อ/คำบรรยายแล้วเลือกเอง (เลขาเข้าใจความหมายได้)
  let noExactMatch = false;
  if (words.length && !rows.length && total > 0) {
    noExactMatch = true;
    rows = (await query('SELECT id, caption, description, tags, created_at FROM album_photos WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, lim])).rows;
  }
  const out = { total, photos: rows.map((r) => ({ ...present(r), date: new Date(r.created_at).toISOString().slice(0, 10) })) };
  if (noExactMatch) { out.noExactMatch = true; out.hint = 'ไม่มีรูปที่ชื่อ/คำบรรยาย/แท็กตรงกับคำค้นตรงๆ — นี่คือรูปล่าสุดในอัลบั้ม ให้อ่านชื่อ/คำบรรยาย/แท็กแล้วเลือกรูปที่ความหมายใกล้เคียงกับที่ผู้ใช้ขอ (ถ้ามีรูปที่ตรงความหมายให้แสดงเลย) ถ้าไม่มีรูปที่ตรงความหมายจริงๆ ให้บอกผู้ใช้ตรงๆ ว่าไม่มีรูปแบบนั้นในอัลบั้ม ห้ามเลือกรูปที่ไม่เกี่ยว'; }
  return out;
}

// เลขาสั่งแสดงรูปในแชท: เฉพาะรูปของเจ้าของ (ไม่เจอ/ของคนอื่นถูกทิ้งเงียบๆ) สูงสุด 4 รูป
async function pickOwned(userId, ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => UUID_RE.test(x)))].slice(0, 4);
  if (!clean.length) return [];
  const r = await query('SELECT id, caption FROM album_photos WHERE owner_id = $1 AND id = ANY($2::uuid[])', [userId, clean]);
  const byId = new Map(r.rows.map((x) => [x.id, x]));
  return clean.map((id) => byId.get(id)).filter(Boolean);
}

module.exports = { AlbumError, usage, listPhotos, addPhoto, getImage, updateCaption, deletePhoto, searchForSecretary, pickOwned, setDescribeForTests, MAX_IMAGE_BYTES, MAX_THUMB_BYTES, UUID_RE };
