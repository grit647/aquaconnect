// JaaS (Jitsi as a Service ของ 8x8) — ทำให้ผู้จัดเป็น "ผู้ดูแลห้อง (moderator)" ได้โดยไม่ต้องล็อกอินบัญชี Google
// (meet.jit.si ฟรีบังคับให้ผู้เปิดห้องล็อกอินก่อน ไม่งั้นห้องไม่เริ่ม) — ผู้เข้าร่วมไม่ต้องมีโทเค็น (เปิดสวิตช์ "Allow meeting participants to join unauthenticated" ในคอนโซล JaaS)
// ตั้งค่าใน Environment (ไม่เก็บในโค้ด): JAAS_APP_ID (vpaas-magic-cookie-...), JAAS_KEY_ID (ส่วนหลังเครื่องหมาย / ของ kid หรือ kid เต็มก็ได้), JAAS_PRIVATE_KEY (เนื้อไฟล์กุญแจส่วนตัวทั้งหมด)
// ถ้าตั้งไม่ครบ → ระบบถอยไปใช้ meet.jit.si ธรรมดา (ผู้จัดต้องล็อกอินใน Jitsi เอง)
const jwt = require('jsonwebtoken');

const APP_ID = () => String(process.env.JAAS_APP_ID || '').trim();
// รองรับทั้งใส่ kid เต็ม ("vpaas-magic-cookie-xxx/abc123") หรือใส่เฉพาะ "abc123"
function keyId() {
  const raw = String(process.env.JAAS_KEY_ID || '').trim();
  if (!raw) return '';
  return raw.includes('/') ? raw : `${APP_ID()}/${raw}`;
}
// กุญแจที่วางใน Environment อาจเพี้ยนได้หลายแบบ (ขึ้นบรรทัดใหม่เป็นตัวอักษร \n, บรรทัดถูกยุบเป็นช่องว่าง, มีเครื่องหมายคำพูดครอบ, ลืมวางบรรทัด BEGIN/END)
// → ดึงเฉพาะเนื้อ base64 แล้วประกอบเป็นไฟล์ PEM ใหม่ให้ถูกรูปแบบ (ชนิดตามบรรทัด BEGIN ถ้ามี ไม่งั้นใช้ PKCS8 "PRIVATE KEY" ซึ่งเป็นแบบที่ JaaS ให้ดาวน์โหลด)
const NL = String.fromCharCode(10);
const BACKSLASH_N = String.fromCharCode(92) + 'n';
function keyParts() {
  // ตัวอักษร backslash-n (ที่ Environment บางที่เก็บแทนการขึ้นบรรทัดใหม่) ต้องแปลงก่อน ไม่งั้นตัว "n" จะติดเข้าไปในเนื้อกุญแจ
  const raw = String(process.env.JAAS_PRIVATE_KEY || '').trim().split(BACKSLASH_N).join(NL).replace(/^["']+|["']+$/g, '');
  const m = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----/.exec(raw);
  const body = raw.replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  return { type: m ? m[1] : 'PRIVATE KEY', body };
}
function privateKey() {
  const { type, body } = keyParts();
  if (body.length < 400) return '';   // กุญแจ RSA 2048+ ยาวกว่านี้มาก = วางไม่ครบ
  return '-----BEGIN ' + type + '-----' + NL + body.match(/.{1,64}/g).join(NL) + NL + '-----END ' + type + '-----' + NL;
}

const configured = () => !!(APP_ID() && keyId() && privateKey());

// โทเค็นสำหรับผู้จัด 1 ห้อง (อายุสั้น 3 ชั่วโมง ผูกกับห้องนั้นห้องเดียว)
function hostToken({ room, userId, name }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      aud: 'jitsi', iss: 'chat', sub: APP_ID(), room,
      nbf: now - 10, exp: now + 3 * 3600,
      context: {
        user: { id: String(userId), name: String(name || 'ผู้จัด').slice(0, 60), moderator: 'true' },
        features: { recording: 'false', livestreaming: 'false', transcription: 'false', 'outbound-call': 'false', 'sip-outbound-call': 'false' },
        room: { regex: false },
      },
    },
    privateKey(),
    { algorithm: 'RS256', header: { kid: keyId(), typ: 'JWT', alg: 'RS256' } }
  );
}

// สถานะการตั้งค่า (ไม่เปิดเผยค่าจริง บอกแค่ว่ามี/ไม่มี/รูปแบบถูกไหม) — ไว้ตรวจเมื่อห้องไม่ใช้ JaaS
function status() {
  const key = privateKey();
  return {
    appId: !!APP_ID(),
    keyId: !!String(process.env.JAAS_KEY_ID || '').trim(),
    privateKey: !String(process.env.JAAS_PRIVATE_KEY || '').trim() ? 'missing' : key ? 'ok' : 'bad-format',
    keyChars: keyParts().body.length,   // จำนวนตัวอักษรเนื้อกุญแจที่อ่านได้ (RSA 2048 ปกติ ~1600 ตัว) — ไว้ดูว่าวางครบไหม ไม่เปิดเผยเนื้อกุญแจ
    ready: configured(),
  };
}

module.exports = { configured, appId: APP_ID, hostToken, status };
