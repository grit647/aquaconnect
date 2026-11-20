// ตั้ง "นาฬิกาปลุกของมือถือ" จากนัดหมาย — ใช้ได้เฉพาะ Android (ส่งคำสั่ง SET_ALARM ให้แอปนาฬิกา) ใช้ร่วมกับชุดทดสอบ
// ข้อจำกัดของนาฬิกาปลุกมือถือ: รู้แค่ "ชั่วโมง:นาที" ไม่รู้วันที่ → ตั้งได้เฉพาะเวลาเตือนที่อยู่ภายใน 24 ชั่วโมงข้างหน้า
// (ถ้าไกลกว่านั้น เครื่องจะปลุกในรอบเวลานั้นที่มาถึงก่อน คือเร็วกว่าที่ต้องการ)
// iPhone: เว็บตั้งนาฬิกาปลุกไม่ได้เลย (ไม่มีช่องทางให้ทำ)
(function (root) {
  const DAY_MS = 24 * 3600 * 1000;

  // remindAt: เวลาเตือน (ISO), remindTime: 'HH:MM' เวลาไทย, ua: userAgent, now: เวลาปัจจุบัน (ms)
  function buildAlarm({ remindAt, remindTime, title, ua, now }) {
    const agent = String(ua || '');
    if (/iPhone|iPad|iPod/i.test(agent)) return { ok: false, reason: 'ios' };
    if (!/Android/i.test(agent)) return { ok: false, reason: 'notAndroid' };
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(remindTime || ''));
    const at = new Date(remindAt).getTime();
    if (!m || Number.isNaN(at)) return { ok: false, reason: 'bad' };
    const diff = at - (now === undefined ? Date.now() : now);
    if (diff < -5 * 60000) return { ok: false, reason: 'past' };
    if (diff > DAY_MS) return { ok: false, reason: 'tooFar' };
    const label = String(title || 'นัดหมาย').replace(/[\r\n]+/g, ' ').slice(0, 60);
    const url = 'intent:#Intent;action=android.intent.action.SET_ALARM'
      + ';i.android.intent.extra.alarm.HOUR=' + Number(m[1])
      + ';i.android.intent.extra.alarm.MINUTES=' + Number(m[2])
      + ';S.android.intent.extra.alarm.MESSAGE=' + encodeURIComponent(label)
      + ';B.android.intent.extra.alarm.SKIP_UI=false;end';      // แสดงหน้าแอปนาฬิกาให้เห็นว่าตั้งแล้ว (ไม่ตั้งเงียบๆ)
    return { ok: true, url };
  }

  const MESSAGES = {
    ios: 'iPhone ตั้งนาฬิกาปลุกจากเว็บไม่ได้ค่ะ — บอก Siri ว่า "ตั้งปลุก…" หรือใช้การแจ้งเตือนทางไลน์/เสียงปลุกในแอปแทน',
    notAndroid: 'ปุ่มนี้ใช้ได้บนมือถือ Android เท่านั้นค่ะ (เปิดแอปในมือถือแล้วกดอีกครั้ง)',
    past: 'เวลาเตือนของนัดนี้ผ่านไปแล้วค่ะ',
    tooFar: 'นาฬิกาปลุกของมือถือไม่รู้วันที่ — ตั้งได้เฉพาะเวลาเตือนที่อยู่ภายใน 24 ชั่วโมงข้างหน้า กลับมากดปุ่มนี้ตอนใกล้ถึงวันนะคะ (ระหว่างนั้นเลขาเตือนทางไลน์และในแอปให้ตามปกติ)',
    bad: 'ข้อมูลเวลาของนัดนี้ไม่ถูกต้องค่ะ',
  };

  const api = { buildAlarm, MESSAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.aqAlarm = api;
})(typeof window !== 'undefined' ? window : this);
