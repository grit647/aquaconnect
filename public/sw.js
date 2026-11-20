// service worker เปล่าๆ — มีไว้ให้เบราว์เซอร์ยอมให้ "ติดตั้งแอปลงหน้าจอหลัก" เท่านั้น
// ตั้งใจ "ไม่เก็บแคช" ไฟล์ใดๆ เพื่อให้ทุกครั้งที่เปิดแอปได้เวอร์ชันล่าสุดจากเซิร์ฟเวอร์เสมอ (เราแก้เว็บบ่อย ไม่ต้องรอล้างแคช)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* ปล่อยผ่านไปที่เครือข่ายตามปกติ */ });
