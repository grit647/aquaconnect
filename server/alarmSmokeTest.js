// ทดสอบตัวสร้างคำสั่งตั้งนาฬิกาปลุกมือถือ (Android): node server/alarmSmokeTest.js  (ไม่ต้องใช้ฐานข้อมูล/อินเทอร์เน็ต)
const path = require('path');
const { buildAlarm, MESSAGES } = require(path.join(__dirname, '..', 'public', 'alarm.js'));

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36';
const NOW = Date.parse('2026-11-20T03:00:00Z');                 // 10:00 เวลาไทย
const at = (mins) => new Date(NOW + mins * 60000).toISOString();

const ok = buildAlarm({ remindAt: at(90), remindTime: '11:30', title: 'ประชุมกับบริษัท A', ua: ANDROID, now: NOW });
check('Android + เตือนอีก 90 นาที → สร้างคำสั่งตั้งปลุก', ok.ok && ok.url.startsWith('intent:#Intent;action=android.intent.action.SET_ALARM'));
check('คำสั่งมีชั่วโมง 11 นาที 30 ตามเวลาเตือน', ok.url.includes('alarm.HOUR=11') && ok.url.includes('alarm.MINUTES=30'), ok.url);
check('ชื่อนัดถูก encode ใส่เป็นข้อความของนาฬิกาปลุก', ok.url.includes('S.android.intent.extra.alarm.MESSAGE=' + encodeURIComponent('ประชุมกับบริษัท A')));
check('ไม่ตั้งเงียบๆ (SKIP_UI=false เพื่อให้เห็นว่าตั้งแล้ว)', ok.url.includes('B.android.intent.extra.alarm.SKIP_UI=false') && ok.url.endsWith(';end'));
const zero = buildAlarm({ remindAt: at(60), remindTime: '07:05', title: 'x', ua: ANDROID, now: NOW });
check('เลขเริ่มด้วย 0 ถูกต้อง (07:05 → 7 ชั่วโมง 5 นาที)', zero.url.includes('HOUR=7;') && zero.url.includes('MINUTES=5;'));
check('iPhone → ไม่รองรับ พร้อมคำอธิบาย', buildAlarm({ remindAt: at(60), remindTime: '11:00', title: 'x', ua: IPHONE, now: NOW }).reason === 'ios' && MESSAGES.ios.includes('iPhone'));
check('คอมพิวเตอร์ → แจ้งให้ใช้บน Android', buildAlarm({ remindAt: at(60), remindTime: '11:00', title: 'x', ua: DESKTOP, now: NOW }).reason === 'notAndroid');
check('เวลาเตือนไกลเกิน 24 ชม. → ไม่ตั้ง (กันปลุกผิดวัน)', buildAlarm({ remindAt: at(25 * 60), remindTime: '11:00', title: 'x', ua: ANDROID, now: NOW }).reason === 'tooFar');
check('พอดี 24 ชม. → ตั้งได้', buildAlarm({ remindAt: at(24 * 60), remindTime: '10:00', title: 'x', ua: ANDROID, now: NOW }).ok === true);
check('เวลาเตือนผ่านไปแล้วเกิน 5 นาที → ไม่ตั้ง', buildAlarm({ remindAt: at(-10), remindTime: '09:50', title: 'x', ua: ANDROID, now: NOW }).reason === 'past');
check('เพิ่งผ่านไปไม่เกิน 5 นาที → ยังตั้งได้', buildAlarm({ remindAt: at(-3), remindTime: '09:57', title: 'x', ua: ANDROID, now: NOW }).ok === true);
check('เวลา/วันที่มั่ว → bad', buildAlarm({ remindAt: 'xx', remindTime: '11:00', title: 'x', ua: ANDROID, now: NOW }).reason === 'bad' && buildAlarm({ remindAt: at(60), remindTime: '25:99', title: 'x', ua: ANDROID, now: NOW }).reason === 'bad');
const inj = buildAlarm({ remindAt: at(60), remindTime: '11:00', title: 'a;end;intent:evil\nb', ua: ANDROID, now: NOW });
check('ชื่อนัดที่แอบใส่ ; หรือขึ้นบรรทัดใหม่ ไม่ทำให้คำสั่งเพี้ยน', inj.ok && !inj.url.slice(0, -4).includes(';end;') && !/[\r\n]/.test(inj.url) && inj.url.includes(encodeURIComponent('a;end;intent:evil b')));
check('ชื่อยาวถูกตัดที่ 60 ตัวอักษร', decodeURIComponent(buildAlarm({ remindAt: at(60), remindTime: '11:00', title: 'ก'.repeat(200), ua: ANDROID, now: NOW }).url.match(/MESSAGE=([^;]*)/)[1]).length === 60);

console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
process.exit(failures ? 1 : 0);
