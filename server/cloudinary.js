// อัปโหลดรูปภาพไป Cloudinary (เก็บถาวร ไม่หายตอน Render deploy ใหม่ — ต่างจากการ
// เขียนไฟล์ลง disk ของเซิร์ฟเวอร์เอง ซึ่งเป็น ephemeral disk บน Render free tier)
// ตั้งค่า CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET ใน .env
const cloudinary = require('cloudinary').v2;

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error('ไม่ได้ตั้งค่า CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET ใน .env');
  }
  cloudinary.config({ cloud_name, api_key, api_secret });
  configured = true;
}

// รับรูปเป็น base64 data URL (เช่น "data:image/jpeg;base64,...") อัปโหลดแล้วคืน URL ถาวร
async function uploadImageBase64(dataUrl, folder) {
  ensureConfigured();
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: folder || 'aquaconnect',
    resource_type: 'image',
  });
  return result.secure_url;
}

module.exports = { uploadImageBase64 };
