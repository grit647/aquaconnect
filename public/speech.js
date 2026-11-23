// เตรียมข้อความให้ "เลขาเสียง" อ่านออกเสียงได้ถูกต้อง (ใช้ทั้งในหน้าเว็บและในชุดทดสอบ)
//   - ทศนิยม: 0.25 → "0 จุด 25" (ไม่ใช่อ่าน 0 แล้วหยุดเพราะจุดถูกมองเป็นจุดจบประโยค)
//   - เดือนย่อ: พ.ย. → "พฤศจิกายน" (และปี พ.ศ./ค.ศ. เป็นคำเต็ม)
//   - ตัดสัญลักษณ์ markdown / อีโมจิ ที่ไม่ควรอ่านออกเสียง
// แก้ที่นี่ที่เดียว ผลกับทุกจุดที่อ่านออกเสียง
(function (root) {
  const MONTHS = [
    [/ม\.\s?ค\.?/g, 'มกราคม'], [/ก\.\s?พ\.?/g, 'กุมภาพันธ์'], [/มี\.\s?ค\.?/g, 'มีนาคม'], [/เม\.\s?ย\.?/g, 'เมษายน'],
    [/พ\.\s?ค\.?/g, 'พฤษภาคม'], [/มิ\.\s?ย\.?/g, 'มิถุนายน'], [/ก\.\s?ค\.?/g, 'กรกฎาคม'], [/ส\.\s?ค\.?/g, 'สิงหาคม'],
    [/ก\.\s?ย\.?/g, 'กันยายน'], [/ต\.\s?ค\.?/g, 'ตุลาคม'], [/พ\.\s?ย\.?/g, 'พฤศจิกายน'], [/ธ\.\s?ค\.?/g, 'ธันวาคม'],
  ];
  const ERAS = [[/พ\.\s?ศ\.?/g, 'พุทธศักราช'], [/ค\.\s?ศ\.?/g, 'คริสต์ศักราช']];

  function forSpeech(text) {
    let t = String(text == null ? '' : text);
    // ชื่อเดือน/ปีแบบย่อ → คำเต็ม (ต้องทำก่อนจัดการจุดอื่นๆ) — ไม่แตะกรณีที่ตัวอักษรไทยติดหน้า เช่นคำที่บังเอิญลงท้ายด้วยตัวย่อ
    for (const [re, full] of MONTHS) t = t.replace(new RegExp('(?<![\\u0E00-\\u0E7F])' + re.source, 'g'), full);
    for (const [re, full] of ERAS) t = t.replace(new RegExp('(?<![\\u0E00-\\u0E7F])' + re.source, 'g'), full);
    // ทศนิยม และเลขหลักพัน
    t = t.replace(/(?<=\d)\.(?=\d)/g, ' จุด ');
    t = t.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
    return t
      .replace(/⟦photo:[0-9a-f-]+⟧/gi, '')   // ป้ายรูปจากอัลบั้ม (ไม่อ่านออกเสียง)
      .replace(/[*_`#>~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ').trim();
  }

  // เสียงชาย (เสียงพรีเมียมที่ผู้ใช้เลือกเป็นเสียงผู้ชาย): เลขาเขียนด้วยคำลงท้ายผู้หญิง แต่ตอน "อ่านออกเสียง" ให้เปลี่ยนเป็นผู้ชาย เพื่อให้เสียงกับคำพูดตรงกัน
  // (ข้อความบนจอและที่บันทึกไว้ไม่เปลี่ยน) — ระวังคำที่มี "คะ" อยู่ข้างในอย่าง "คะแนน": เปลี่ยนเฉพาะ "คะ" ที่ไม่มีพยัญชนะ/สระหน้าตามหลัง
  function forMaleVoice(text) {
    return String(text == null ? '' : text)
      .replace(/ค่ะ/g, 'ครับ')
      .replace(/คะ(?![\u0E01-\u0E2E\u0E40-\u0E44])/g, 'ครับ')
      .replace(/ดิฉัน/g, 'ผม');
  }

  // แบ่งเป็นท่อนสั้นๆ ให้ตัวอ่านออกเสียงเล่นต่อเนื่อง (จบประโยคที่ . ! ? หรือขึ้นบรรทัดใหม่) — ต้องเรียกกับข้อความที่ผ่าน forSpeech แล้ว
  function chunkText(t) {
    const parts = String(t).split(/(?<=[.!?。！？\n])\s*|\s{2,}/).filter(Boolean);
    const out = [];
    let cur = '';
    for (const p of parts) {
      if ((cur + ' ' + p).length > 160 && cur) { out.push(cur); cur = p; } else { cur = cur ? cur + ' ' + p : p; }
    }
    if (cur) out.push(cur);
    return out;
  }

  const api = { forSpeech, chunkText, forMaleVoice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.aqSpeech = api;
})(typeof window !== 'undefined' ? window : this);
