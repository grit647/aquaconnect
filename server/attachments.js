// ไฟล์/ลิงก์ที่ผู้ใช้แนบให้เลขาอ่าน: ตรวจชนิดไฟล์จริง, อ่านลิงก์แทนผู้ใช้ (ป้องกัน SSRF), แปลงเป็นส่วนที่โมเดลอ่านได้
// หลักความปลอดภัย: ข้อมูลในไฟล์/ลิงก์เป็น "ข้อมูลดิบจากภายนอก" ไม่ใช่คำสั่ง — chat.js จะจำกัดเครื่องมือของเลขาในข้อความที่มีส่วนแนบด้วย
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

const MAX_FILES = 4;
const MAX_FILE_BASE64 = 5 * 1024 * 1024;        // ต่อไฟล์ (base64) ≈ 3.7MB จริง
const MAX_TOTAL_BASE64 = 8 * 1024 * 1024;
const MAX_TEXT_FILE_CHARS = 30000;
const MAX_LINKS = 3;
const MAX_LINK_CHARS = 15000;
const MAX_LINK_BYTES = 1500000;
const LINK_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

class AttachmentError extends Error {}

// ---------- ไฟล์แนบ ----------
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const TEXT_MIMES = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

// คืน { parts, names } — parts = ส่วนของข้อความที่ส่งให้โมเดล (inlineData สำหรับรูป/PDF, text สำหรับไฟล์ข้อความ)
function prepareFiles(files) {
  if (!Array.isArray(files) || !files.length) return { parts: [], names: [] };
  if (files.length > MAX_FILES) throw new AttachmentError(`แนบได้ไม่เกิน ${MAX_FILES} ไฟล์ต่อข้อความ`);
  let total = 0;
  const parts = []; const names = [];
  for (const f of files) {
    const name = String((f && f.name) || 'ไฟล์').replace(/[\r\n\t]/g, ' ').slice(0, 80);
    const mime = String((f && f.mime) || '').toLowerCase();
    const data = f && f.data;
    if (typeof data !== 'string' || !data) throw new AttachmentError(`ไฟล์ "${name}" ว่างเปล่า`);
    if (data.length > MAX_FILE_BASE64) throw new AttachmentError(`ไฟล์ "${name}" ใหญ่เกินไป (ไม่เกินประมาณ 3.5 MB)`);
    total += data.length;
    if (total > MAX_TOTAL_BASE64) throw new AttachmentError('ไฟล์แนบรวมกันใหญ่เกินไป');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw new AttachmentError(`ไฟล์ "${name}" ไม่ถูกต้อง`);

    if (IMAGE_MIMES.has(mime) || mime === 'application/pdf') {
      const real = sniff(buf);
      if (real !== mime) throw new AttachmentError(`ไฟล์ "${name}" ไม่ใช่ชนิดที่แจ้งไว้ (${mime})`);
      parts.push({ inlineData: { mimeType: mime, data } });
      names.push((mime === 'application/pdf' ? 'PDF ' : 'รูป ') + name);
    } else if (TEXT_MIMES.has(mime)) {
      if (sniff(buf)) throw new AttachmentError(`ไฟล์ "${name}" ไม่ใช่ไฟล์ข้อความ`);
      if (buf.includes(0)) throw new AttachmentError(`ไฟล์ "${name}" ไม่ใช่ไฟล์ข้อความ`);
      let text = buf.toString('utf8');
      let cut = false;
      if (text.length > MAX_TEXT_FILE_CHARS) { text = text.slice(0, MAX_TEXT_FILE_CHARS); cut = true; }
      parts.push({ text: `[เนื้อหาไฟล์แนบ "${name}"${cut ? ' (ตัดเหลือส่วนต้น)' : ''}]\n${text}\n[จบไฟล์แนบ]` });
      names.push('ไฟล์ ' + name);
    } else {
      throw new AttachmentError(`ไฟล์ "${name}" ชนิดที่ยังไม่รองรับ (รองรับ รูปภาพ, PDF, ข้อความ/CSV/JSON)`);
    }
  }
  return { parts, names };
}

// ---------- ลิงก์ ----------
function extractUrls(text) {
  const found = String(text || '').match(/https?:\/\/[^\s<>"'`฀-๿]+/gi) || [];   // หยุดที่ตัวอักษรไทย (ลิงก์มักติดข้อความไทย)
  const out = [];
  for (const raw of found) {
    const u = raw.replace(/[)\].,;:!?]+$/, '');
    if (u.length < 600 && !out.includes(u)) out.push(u);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function isPublicAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;     // CGNAT
    if (a >= 224) return false;                              // multicast / reserved
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return false;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return false;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);        // IPv4-mapped
    if (m) return isPublicAddress(m[1]);
    return true;
  }
  return false;
}
let addressCheck = isPublicAddress;                      // เปลี่ยนได้ตอนทดสอบเท่านั้น
let portCheckOff = false;                               // ตอนทดสอบเว็บจำลองใช้พอร์ตสุ่ม
function setAddressCheckForTests(fn) { addressCheck = fn || isPublicAddress; portCheckOff = !!fn; }

// ตรวจที่อยู่ปลายทาง "ตอนเชื่อมต่อจริง" (กัน DNS rebinding): lookup เองแล้วปฏิเสธถ้าเป็นเครือข่ายภายใน
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => !addressCheck(a.address));
    if (bad || !addrs.length) return cb(new AttachmentError('ลิงก์นี้ชี้ไปยังที่อยู่ภายใน — ไม่อนุญาต'));
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      lookup: guardedLookup,
      timeout: LINK_TIMEOUT_MS,
      headers: { 'User-Agent': 'AquaConnectSecretary/1.0', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve({ redirect: res.headers.location }); }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new AttachmentError(`เว็บตอบกลับสถานะ ${res.statusCode}`)); }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (!/^(text\/html|text\/plain|application\/json|application\/xhtml)/.test(type)) { res.resume(); return reject(new AttachmentError('ลิงก์นี้ไม่ใช่หน้าเว็บ/ข้อความ (อ่านไม่ได้) — ถ้าเป็นไฟล์ ให้โหลดแล้วแนบไฟล์แทน')); }
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_LINK_BYTES) { res.destroy(); return reject(new AttachmentError('หน้าเว็บนี้ใหญ่เกินไป')); }
        chunks.push(c);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), type }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new AttachmentError('เว็บตอบช้าเกินไป')); });
    req.on('error', reject);
    req.end();
  });
}

function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let t = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|nav|footer|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } })
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  const ttl = title.replace(/\s+/g, ' ').trim();
  return (ttl ? `หัวเรื่อง: ${ttl}\n` : '') + t;
}

function decodeBody(buf, type) {
  const cs = (type.match(/charset=([\w-]+)/) || buf.slice(0, 2000).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  try { return new TextDecoder(cs ? cs.toLowerCase() : 'utf-8').decode(buf); } catch { return buf.toString('utf8'); }
}

// อ่านลิงก์เดียว — คืนข้อความล้วน หรือโยน AttachmentError (ข้อความภาษาไทยให้ผู้ใช้เห็นได้)
async function fetchLinkText(urlStr) {
  let url;
  try { url = new URL(urlStr); } catch { throw new AttachmentError('ลิงก์ไม่ถูกต้อง'); }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new AttachmentError('รองรับเฉพาะลิงก์ http/https');
    if (url.username || url.password) throw new AttachmentError('ลิงก์ที่มีรหัสผ่านฝังอยู่ ไม่อนุญาต');
    if (!portCheckOff && url.port && !['80', '443'].includes(url.port)) throw new AttachmentError('พอร์ตของลิงก์ไม่อนุญาต');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !addressCheck(host)) throw new AttachmentError('ลิงก์นี้ชี้ไปยังที่อยู่ภายใน — ไม่อนุญาต');
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new AttachmentError('ลิงก์นี้ชี้ไปยังที่อยู่ภายใน — ไม่อนุญาต');
    const r = await requestOnce(url);
    if (r.redirect) { url = new URL(r.redirect, url); continue; }   // ตรวจซ้ำทุกการเปลี่ยนเส้นทาง
    const raw = decodeBody(r.body, r.type);
    const text = /html/.test(r.type) ? htmlToText(raw) : raw.trim();
    if (!text) throw new AttachmentError('อ่านเนื้อหาจากลิงก์นี้ไม่ได้ (หน้าอาจต้องล็อกอินหรือโหลดด้วย JavaScript)');
    return text.length > MAX_LINK_CHARS ? text.slice(0, MAX_LINK_CHARS) + '\n…(ตัดเหลือส่วนต้น)' : text;
  }
  throw new AttachmentError('ลิงก์เปลี่ยนเส้นทางหลายครั้งเกินไป');
}

// รวมทุกอย่างของข้อความหนึ่ง: ไฟล์ที่แนบ + ลิงก์ที่พบในข้อความ
async function prepare({ files, text }) {
  const { parts, names } = prepareFiles(files);
  const urls = extractUrls(text);
  const linkNotes = [];
  for (const u of urls) {
    try {
      const body = await fetchLinkText(u);
      parts.push({ text: `[เนื้อหาจากลิงก์ ${u}]\n${body}\n[จบเนื้อหาลิงก์]` });
      linkNotes.push('ลิงก์ ' + u.slice(0, 60));
    } catch (err) {
      const why = err instanceof AttachmentError ? err.message : 'เชื่อมต่อลิงก์ไม่สำเร็จ';
      parts.push({ text: `[อ่านลิงก์ ${u} ไม่สำเร็จ: ${why} — แจ้งผู้ใช้ตรงๆ ว่าอ่านลิงก์นี้ไม่ได้ ห้ามเดาเนื้อหาจากชื่อลิงก์]` });
      linkNotes.push('ลิงก์ (อ่านไม่ได้) ' + u.slice(0, 60));
    }
  }
  return { parts, names: [...names, ...linkNotes], hasExternal: parts.length > 0 };
}

module.exports = { prepare, prepareFiles, extractUrls, fetchLinkText, htmlToText, isPublicAddress, setAddressCheckForTests, AttachmentError, MAX_FILES };
