// คำแนะนำข้อความถัดไปจากเลขาส่วนตัว — แสดงเป็นตัวหนังสือสีเทาในช่องพิมพ์ กดปุ่มส่งได้เลย
// 2 ทางที่ได้คำแนะนำ:
//  (ก) หลังเลขาตอบ: เลขาแนบบรรทัดท้าย <<ข้อความถัดไป: ...>> มากับคำตอบรอบเดียวกัน (ไม่เรียก AI เพิ่ม) ระบบแกะออกจากคำตอบและส่งเป็นฟิลด์แยก
//  (ข) ตอนเปิดแอป/เมื่อมีของค้าง: ระบบเลือกเองจากกติกาตายตัว (ไม่เรียก AI = ฟรี) เช่น คำขอรออนุมัติ ข้อความกลุ่มที่ยังไม่อ่าน นัดที่ถึงเวลา
// เลขาไม่ได้ตัดสินใจแทนผู้ใช้: คำแนะนำเป็นแค่ข้อความที่ผู้ใช้ "กดส่งเอง" — ไม่มีอะไรทำงานเองจนกว่าผู้ใช้จะส่ง
const { query } = require('./db');

const MAX_SUGGESTION_CHARS = 90;
const PROFILE_SUGGESTION = 'อัปเดตโปรไฟล์ให้เลขารู้จักฉัน';
const NEXT_RE = /<<\s*ข้อความถัดไป\s*[:：]\s*([\s\S]*?)(?:>>|$)/g;

const oneLine = (s) => String(s || '').split(/\s+/).join(' ').trim();

// แกะบรรทัดคำแนะนำออกจากคำตอบของเลขา (กันโมเดลเขียนไม่ปิด >> หรือเขียนซ้ำหลายบรรทัด) → { text: คำตอบที่สะอาด, suggestion: ข้อความหรือ '' }
function extractSuggestion(raw) {
  const full = String(raw || '');
  let found = '';
  // ลบบรรทัดคำแนะนำที่ถูกรูปแบบ (ได้ข้อความแนะนำ) แล้วกวาด <<...>> อื่นที่โมเดลเขียนผิดรูปแบบทิ้งด้วย (เช่น ลืมคำนำ "ข้อความถัดไป:") — ห้ามหลุดไปให้ผู้ใช้เห็นเด็ดขาด
  const text = full.replace(NEXT_RE, (m, body) => { if (!found) found = body; return ''; }).replace(/<<[\s\S]*?(?:>>|$)/g, '').replace(/\s+$/, '');
  let s = oneLine(found).split('**').join('').replace(/^["“'‘]+|["”'’]+$/g, '').trim();
  if (s.length < 2) s = '';
  if (s.length > MAX_SUGGESTION_CHARS) s = s.slice(0, MAX_SUGGESTION_CHARS - 1).trimEnd() + '…';
  return { text, suggestion: s };
}

// ตัวเลขสถานะของผู้ใช้ (ใช้ทั้งทำ prompt ให้เลขา และเลือกคำแนะนำแบบกติกาตายตัว) — query เดียว ราคาเบา
async function userStats(userId) {
  const r = await query(
    `SELECT
       (SELECT floor(extract(epoch FROM (now() - created_at)) / 86400)::int FROM users WHERE id = $1) AS age_days,
       (SELECT count(*)::int FROM messages WHERE user_id = $1 AND role = 'user') AS user_msgs,
       (SELECT occupation_main IS NOT NULL FROM users WHERE id = $1) AS has_profile,
       (SELECT count(*)::int FROM memories WHERE owner_id = $1) AS memories,
       (SELECT count(*)::int FROM events WHERE user_id = $1) AS events,
       (SELECT count(*)::int FROM events WHERE user_id = $1 AND remind_at <= now() AND acknowledged_at IS NULL) AS due_events,
       (SELECT count(*)::int FROM chat_group_members WHERE user_id = $1) AS groups,
       (SELECT count(*)::int FROM meetings WHERE host_id = $1) AS meetings,
       (SELECT count(*)::int FROM memory_categories WHERE owner_id = $1 AND visibility <> 'private') AS shared_cats,
       (SELECT count(*)::int FROM access_requests WHERE owner_id = $1 AND status = 'pending') AS pending_access,
       (SELECT count(*)::int FROM memory_proposals WHERE owner_id = $1 AND status = 'pending') AS pending_proposals,
       (SELECT coalesce(sum(x.n), 0)::int FROM (
          SELECT count(*) AS n FROM chat_group_messages gm JOIN chat_group_members mem ON mem.group_id = gm.group_id AND mem.user_id = $1
           WHERE gm.id > coalesce(mem.last_read_id, 0) AND gm.created_at >= mem.joined_at AND gm.user_id <> $1 AND NOT gm.is_system
           GROUP BY gm.group_id) x) AS unread_group`,
    [userId]
  );
  return r.rows[0];
}

// หมวดความจำของผู้ใช้ + จำนวนรายการ + วันที่อัปเดตล่าสุด (ไม่รวมคู่มือ) — ให้เลขาเห็นว่าหมวดไหนว่าง/เก่า
async function categoryOverview(userId) {
  const r = await query(
    `SELECT c.name, count(m.id)::int AS n, floor(extract(epoch FROM (now() - max(m.created_at))) / 86400)::int AS days_since
       FROM memory_categories c LEFT JOIN memories m ON m.category_id = c.id
      WHERE c.owner_id = $1 AND c.name <> 'การใช้งานแพลตฟอร์ม' GROUP BY c.id ORDER BY c.name`,
    [userId]
  );
  return r.rows;
}

// ประวัติคำแนะนำที่ผู้ใช้เคยกดรับ / ไม่รับ (ล่าสุดไม่เกิน 6 อย่างละกลุ่ม) ให้เลขาเรียนรู้ว่าแบบไหนตรงใจ
async function feedbackHistory(userId) {
  const r = await query(
    `SELECT accepted, text FROM (
       SELECT accepted, text, row_number() OVER (PARTITION BY accepted ORDER BY created_at DESC) AS rn
         FROM suggestion_log WHERE user_id = $1 AND accepted IS NOT NULL AND kind = 'ai') t WHERE rn <= 6`, [userId]);
  return { taken: r.rows.filter((x) => x.accepted).map((x) => x.text), skipped: r.rows.filter((x) => !x.accepted).map((x) => x.text) };
}

// ข้อความ (prompt) ที่ต่อท้าย system prompt ของเลขา ทุกครั้งที่ผู้ใช้คุยในแอป
async function buildContext(userId) {
  const [s, cats, fb] = await Promise.all([userStats(userId), categoryOverview(userId), feedbackHistory(userId)]);
  const stage = s.user_msgs < 15 || s.age_days < 3 ? 'ผู้ใช้ใหม่ (เพิ่งเริ่มใช้)' : s.memories < 8 ? 'เริ่มคุ้นแอปแล้ว แต่ข้อมูลยังน้อย' : 'ใช้งานมาพอสมควร มีข้อมูลสะสม';
  const unused = [];
  if (!s.has_profile) unused.push('ยังไม่ได้ตั้งสถานะ/อาชีพในโปรไฟล์ (เลขายังไม่รู้ว่าควรคุยในแนวไหนกับเขา)');
  if (!s.memories) unused.push('ยังไม่เคยสอนหรือเล่าเรื่องตัวเองให้เลขาจำ');
  if (!s.events) unused.push('ยังไม่เคยใช้ปฏิทิน/นัดเตือน');
  if (!s.groups) unused.push('ยังไม่เคยสร้างหรือเข้าร่วมกลุ่ม');
  if (!s.meetings) unused.push('ยังไม่เคยสร้างห้องสัมมนา/ประชุมออนไลน์');
  if (!s.shared_cats) unused.push('ยังไม่เคยเปิดหมวดข้อมูลให้คนอื่นใช้');
  const pending = [];
  if (s.pending_access) pending.push(`มีคำขอใช้ข้อมูลของผู้ใช้ที่รออนุมัติ ${s.pending_access} คำขอ`);
  if (s.unread_group) pending.push(`มีข้อความในกลุ่มที่ยังไม่ได้อ่าน ${s.unread_group} ข้อความ`);
  if (s.due_events) pending.push(`มีนัดหมายที่ถึงเวลาเตือนแล้วแต่ยังไม่กดรับทราบ ${s.due_events} นัด`);
  if (s.pending_proposals) pending.push(`มีข้อสรุปที่เลขาเสนอไว้รอผู้ใช้ยืนยัน ${s.pending_proposals} ข้อ`);
  const catLine = cats.map((c) => `${c.name}: ${c.n} รายการ${c.n && c.days_since != null ? ` (อัปเดตล่าสุด ${c.days_since} วันก่อน)` : ''}`).join(' • ');
  return `

[คำแนะนำข้อความถัดไป — ทำทุกครั้งที่ตอบ]
ท้ายคำตอบทุกครั้ง ให้เพิ่มบรรทัดสุดท้ายอีก 1 บรรทัดรูปแบบนี้เท่านั้น: <<ข้อความถัดไป: ...>>
ข้างในคือ "ข้อความที่ผู้ใช้จะพิมพ์ส่งหาคุณต่อ" (เขียนในมุมผู้ใช้พูดกับเลขา เป็นคำสั่งหรือคำถามที่ผู้ใช้พูดกับคุณ) ระบบจะซ่อนบรรทัดนี้จากคำตอบ และโชว์เป็นตัวหนังสือสีเทาในช่องพิมพ์ ให้ผู้ใช้กดส่งได้ทันที ถ้าผู้ใช้ไม่เอาก็พิมพ์เองได้ ไม่มีอะไรเกิดขึ้นเอง
ตัวอย่างที่ถูก (คำพูดของผู้ใช้ มีคำว่า "ข้อความถัดไป:" นำหน้าเสมอ):
<<ข้อความถัดไป: ช่วยจดเรื่องน้ำเขียวไว้ในหมวดฟาร์มให้หน่อย>>
<<ข้อความถัดไป: ตั้งเตือนตรวจบ่อพรุ่งนี้เช้า>>
ตัวอย่างที่ผิด ห้ามทำ (เป็นคำถามของเลขาเอง หรือไม่มีคำนำ): <<อยากให้เลขาช่วยอะไรดีคะ>> และ <<ข้อความถัดไป: จะให้จดไว้ไหมคะ>>
คำถามที่คุณอยากถามผู้ใช้ ให้เขียนในเนื้อคำตอบตามปกติ ไม่ใช่ในบรรทัดนี้
เลือกเรื่องที่จะแนะนำตามลำดับนี้ (เอาข้อแรกที่เข้าเงื่อนไขและเกี่ยวกับบทสนทนาตอนนี้ได้อย่างเป็นธรรมชาติ):
1) ของค้างที่ผู้ใช้ควรรู้ (คำขอรออนุมัติ ข้อความกลุ่มที่ยังไม่อ่าน นัดที่ถึงเวลา ข้อสรุปรอยืนยัน) → แนะนำให้ไปจัดการ เช่น "มีใครขอใช้ข้อมูลฉันบ้าง"
1.5) ถ้าผู้ใช้ยังไม่ได้ตั้งสถานะ/อาชีพในโปรไฟล์ และไม่มีของค้าง → แนะนำข้อความ "อัปเดตโปรไฟล์ให้เลขารู้จักฉัน" ได้ แต่แค่เป็นบางครั้ง (ไม่ใช่ทุกคำตอบ ถ้าผู้ใช้เคยไม่เอาแนวนี้ให้ข้ามไป)
2) ผู้ใช้ใหม่ → แนะนำให้ลองใช้ฟีเจอร์ที่ยังไม่เคยใช้ทีละอย่าง เริ่มจากที่ง่ายและมีประโยชน์ที่สุดกับอาชีพ/ความสนใจของเขา เช่น "สอนเลขาเรื่องฟาร์มของฉัน" "ตั้งเตือนนัดพรุ่งนี้" (ถ้าไม่แน่ใจว่าฟีเจอร์ทำงานอย่างไร ให้เรียก platform_guide ก่อน)
3) มีข้อมูลหลายหมวดแล้ว → วิเคราะห์เนื้อหาที่คุณรู้ ว่าหมวดไหนว่าง น้อย หรือเก่า (ไม่ได้อัปเดตนาน) หรือยังขาดเรื่องสำคัญอะไร แล้วชวนเล่าเพิ่ม/อัปเดตเรื่องนั้น เช่น "ราคากุ้งช่วงนี้เปลี่ยนไป อัปเดตให้เลขาหน่อย"
4) คุณอยากเก่งขึ้นเพื่อดูแลผู้ใช้ดีขึ้น → ชวนให้ผู้ใช้สอน เช่น วิธีตัดสินใจ ความชำนาญ สิ่งที่ผู้ใช้ทำต่างจากคนทั่วไป เช่น "อยากสอนเลขาว่าดูน้ำเสียยังไง"
กติกา:
- สั้นมาก ไม่เกิน 35 ตัวอักษร (ช่องพิมพ์บนมือถือแคบ ยาวกว่านี้จะถูกตัด) ภาษาพูดสั้นๆ ไม่มีอีโมจิ ไม่ใส่ชื่อปุ่ม/เมนู ไม่ขึ้นต้นด้วยคำว่า "เลขา"
- ต้องเกี่ยวกับบทสนทนาหรือสิ่งที่คุณรู้จริงเกี่ยวกับผู้ใช้ ห้ามแต่งข้อมูลที่ไม่มี ห้ามเดาเรื่องส่วนตัว
- ห้ามแนะนำให้เปิดเผยข้อมูลส่วนตัว/เปิดขายข้อมูล/ใช้จ่ายเครดิต เป็นเป้าหมายหลัก ผู้ใช้ตัดสินใจเรื่องนี้เอง
- อย่าแนะนำซ้ำเรื่องเดียวกันถี่ๆ ถ้าผู้ใช้เพิ่งทำเรื่องนั้นเสร็จ ให้ขยับไปเรื่องถัดไป
- ถ้าไม่มีอะไรจะแนะนำจริงๆ ให้ละบรรทัดนี้ไปเลย ดีกว่าแนะนำเรื่อยเปื่อย
ข้อมูลของผู้ใช้คนนี้ตอนนี้ (ใช้ตัดสินใจว่าจะแนะนำอะไร):
- ระดับการใช้งาน: ${stage} (ใช้มา ${s.age_days} วัน คุยไปแล้ว ${s.user_msgs} ข้อความ)
- หมวดความจำ: ${catLine || 'ยังไม่มี'}
- ฟีเจอร์ที่ยังไม่เคยใช้: ${unused.join(' / ') || 'ใช้ครบแล้ว'}
- ของค้าง: ${pending.join(' / ') || 'ไม่มี'}
${fb.taken.length ? `- คำแนะนำที่ผู้ใช้คนนี้เคยกดรับ (แนวที่ตรงใจ): ${fb.taken.map((t) => `"${t}"`).join(' ')}\n` : ''}${fb.skipped.length ? `- คำแนะนำที่ผู้ใช้ไม่เอา/พิมพ์เองแทน (เลี่ยงแนวนี้): ${fb.skipped.map((t) => `"${t}"`).join(' ')}\n` : ''}`;
}

// คำแนะนำแบบกติกาตายตัว (ไม่เรียก AI) — ใช้ตอนเปิดแอป/เมื่อยังไม่มีบทสนทนา ตามลำดับความสำคัญเดียวกับ prompt
async function ruleBased(userId) {
  const s = await userStats(userId);
  const cands = [];   // เรียงตามลำดับความสำคัญ: ของค้างก่อน → สอนใช้แอป → เติม/อัปเดตข้อมูล
  if (s.pending_access) cands.push('มีใครขอใช้ข้อมูลฉันบ้าง');
  if (s.unread_group) cands.push('สรุปข้อความที่ยังไม่อ่านในกลุ่มให้หน่อย');
  if (s.due_events) cands.push('วันนี้มีนัดอะไรบ้าง');
  if (s.pending_proposals) cands.push('ที่เลขาสรุปไว้ จำไว้ได้เลย');
  if (!s.has_profile) cands.push(PROFILE_SUGGESTION);   // ยังไม่ได้ตั้งสถานะ/อาชีพ → ชวนอัปเดตโปรไฟล์ (เลขาจะได้คุยให้เหมาะกับเขา)
  if (!s.memories) cands.push('อยากสอนเลขาเรื่องงานของฉัน');
  if (!s.events) cands.push('ช่วยตั้งเตือนนัดหมายให้หน่อย');
  if (!s.groups && s.user_msgs >= 10) cands.push('ใช้กลุ่มแชททำอะไรได้บ้าง');
  const cats = await categoryOverview(userId);
  const empty = cats.find((c) => c.n === 0 && c.name !== 'ข้อมูลแชท' && c.name !== 'ความสามารถเลขา' && c.name !== 'ทั่วไป');
  if (empty) cands.push(`อยากเล่าเรื่อง ${empty.name} เพิ่ม`);
  const stale = cats.find((c) => c.n > 0 && c.days_since != null && c.days_since >= 30 && c.name !== 'ข้อมูลแชท');
  if (stale) cands.push(`อัปเดตหมวด ${stale.name} หน่อย`);
  if (!cands.length) return null;
  // ข้ามอันที่ผู้ใช้เพิ่งไม่เอาใน 3 วัน (ไม่งั้นขึ้นซ้ำทุกครั้งที่เปิดแอป)
  const skipped = await query("SELECT DISTINCT text FROM suggestion_log WHERE user_id = $1 AND accepted = false AND created_at > now() - interval '3 days' AND text = ANY($2)", [userId, cands]);
  const skip = new Set(skipped.rows.map((x) => x.text));
  const pick = cands.find((t) => !skip.has(t));
  return pick ? { kind: 'rule', text: pick } : null;
}

// บันทึกว่าเสนออะไรไป (รอผู้ใช้ตัดสินใจ) — คืน id ให้หน้าจอส่งกลับมาตอนผู้ใช้กดใช้
async function logShown(userId, kind, text) {
  // ซ้ำกับของเดิมที่ยังรออยู่ ไม่ต้องเพิ่มแถว (เช่น เปิดแอปซ้ำๆ ได้คำแนะนำเดิม)
  const same = await query('SELECT id FROM suggestion_log WHERE user_id = $1 AND accepted IS NULL AND text = $2 ORDER BY created_at DESC LIMIT 1', [userId, text]);
  if (same.rows[0]) return same.rows[0].id;
  const r = await query('INSERT INTO suggestion_log (user_id, kind, text) VALUES ($1, $2, $3) RETURNING id', [userId, kind, text]);
  return r.rows[0].id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ผู้ใช้ส่งข้อความใหม่: ถ้ากดใช้คำแนะนำ (suggestionId) = รับ • คำแนะนำอื่นที่ค้างอยู่ของผู้ใช้คนนี้ = ข้าม (พิมพ์เองแทน)
async function resolveFeedback(userId, usedId) {
  const used = typeof usedId === 'string' && UUID_RE.test(usedId) ? usedId : null;
  if (used) await query('UPDATE suggestion_log SET accepted = true, decided_at = now() WHERE id = $1 AND user_id = $2 AND accepted IS NULL', [used, userId]);
  await query("UPDATE suggestion_log SET accepted = false, decided_at = now() WHERE user_id = $1 AND accepted IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)", [userId, used]);
}

module.exports = { extractSuggestion, userStats, categoryOverview, buildContext, ruleBased, logShown, resolveFeedback, MAX_SUGGESTION_CHARS };
