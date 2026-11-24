// ทดสอบ "ผู้ใช้สอนเลขาเอง": 2 หมวดหลัก, หมวดความสามารถเลขา (ส่วนตัวเสมอ), เลขาไตร่ตรองแล้วเสนอ → เจ้าของยืนยัน/ปฏิเสธ
//   node server/teachSmokeTest.js   (โมเดลจำลอง ไม่เสียเงิน • ผู้ใช้ทดสอบ 09999 ลบทิ้งเมื่อจบ)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.VERTEX_SERVICE_ACCOUNT_EMAIL = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || 'fake@fake.iam.gserviceaccount.com';
process.env.VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY || 'fake';

const app = require('./index');
const ai = require('./ai');
const sharing = require('./sharing');
const memory = require('./memory');
const reflect = require('./reflect');
const { query, getPool } = require('./db');

let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  → ' + extra : ''}`); };
const PHONES = ['0999900031', '0999900032'];

let reflectReply = null;     // สิ่งที่โมเดลจำลองจะตอบตอน "ไตร่ตรอง"
let lastChatPrompt = '';
let organizeReply = '{"items":[]}';
ai.setCallModelForTests(async ({ systemPrompt, contents }) => {
  if (systemPrompt.startsWith('คุณคือเลขาส่วนตัวที่กำลังทบทวน')) return { parts: [{ text: reflectReply }], usage: {} };
  if (systemPrompt.startsWith('คุณคือเลขาส่วนตัว กำลังสรุปบทสนทนา')) return { parts: [{ text: organizeReply }], usage: {} };
  lastChatPrompt = systemPrompt;
  const last = contents[contents.length - 1];
  if (last.parts.some((p) => p.functionResponse)) return { parts: [{ text: 'เรียบร้อยค่ะ' }], usage: {} };
  const text = (last.parts[0] && last.parts[0].text) || '';
  if (text.includes('เปลี่ยนชื่อเลขา')) return { parts: [{ functionCall: { name: 'set_secretary_name', args: { name: 'น้องครีม' } } }], usage: {} };
  if (text.includes('เรียกฉันว่า')) return { parts: [{ functionCall: { name: 'set_user_call_name', args: { name: 'พี่ต้น' } } }], usage: {} };
  if (text.includes('ชื่อยาวเกิน')) return { parts: [{ functionCall: { name: 'set_secretary_name', args: { name: 'ชื่อที่ยาวมากเกินไปจนอ่านออกเสียงไม่ไหว' } } }], usage: {} };
  if (text.includes('ชื่อมีเครื่องหมาย')) return { parts: [{ functionCall: { name: 'set_user_call_name', args: { name: 'พี่ "ต้น" <b>' } } }], usage: {} };
  if (text.includes('ตั้งโหมดบันทึกเอง')) return { parts: [{ functionCall: { name: 'set_organize_mode', args: { mode: 'auto' } } }], usage: {} };
  if (text.includes('สอนเลขา')) return { parts: [{ functionCall: { name: 'save_memory', args: { category: 'ความสามารถเลขา', content: '[บทเรียน] ชอบให้ตอบสั้นๆ' } } }], usage: {} };
  if (text === 'ยืนยัน') {
    const m = /id: ([0-9a-f-]{36})/.exec(systemPrompt);
    return m ? { parts: [{ functionCall: { name: 'confirm_memory_proposal', args: { id: m[1] } } }], usage: {} } : { parts: [{ text: 'ไม่มีข้อเสนอ' }], usage: {} };
  }
  return { parts: [{ text: 'สวัสดีค่ะ' }], usage: {} };
});

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
async function call(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* ไม่มี body */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

(async () => {
  const counts = async () => (await query('SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM messages) AS messages, (SELECT count(*)::int FROM memories) AS memories, (SELECT count(*)::int FROM memory_categories) AS cats, (SELECT count(*)::int FROM memory_proposals) AS props')).rows[0];
  await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const base = await counts();

  const A = await call('POST', '/api/auth/register', { name: 'ทดสอบ สอน', phone: PHONES[0], pin: '111222' });
  const B = await call('POST', '/api/auth/register', { name: 'ทดสอบ อื่น', phone: PHONES[1], pin: '333444' });
  check('สมัครผู้ใช้ทดสอบ 2 คน', A.status === 200 && B.status === 200);

  const cats = (await query("SELECT c.name, c.visibility FROM memory_categories c JOIN users u ON u.id = c.owner_id WHERE u.phone = $1 ORDER BY c.name", [PHONES[0]])).rows;
  check('สมัครแล้วมี 4 หมวดหลัก: ทั่วไป + ความสามารถเลขา + ข้อมูลแชท + การใช้งานแพลตฟอร์ม (ส่วนตัว)', cats.length === 4 && cats.some((c) => c.name === 'การใช้งานแพลตฟอร์ม') && cats.some((c) => c.name === 'ข้อมูลแชท') && cats.some((c) => c.name === 'ทั่วไป') && cats.some((c) => c.name === 'ความสามารถเลขา') && cats.every((c) => c.visibility === 'private'), JSON.stringify(cats));

  const uidA = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[0]])).rows[0].id;
  const uidB = (await query('SELECT id FROM users WHERE phone = $1', [PHONES[1]])).rows[0].id;

  // หมวดความสามารถเลขาเปิดแชร์/ขายไม่ได้
  let blocked = false; try { await sharing.setCategoryVisibility(uidA, 'ความสามารถเลขา', 'free'); } catch { blocked = true; }
  check('หมวดความสามารถเลขาเปิดแชร์ไม่ได้ (ส่วนตัวเสมอ)', blocked);
  let paidBlocked = false; try { await sharing.setCategoryVisibility(uidA, 'ความสามารถเลขา', 'paid', 'question', 5); } catch { paidBlocked = true; }
  check('และตั้งราคาขายไม่ได้', paidBlocked);
  let ok = true; try { await sharing.setCategoryVisibility(uidA, 'ทั่วไป', 'free'); await sharing.setCategoryVisibility(uidA, 'ทั่วไป', 'private'); } catch { ok = false; }
  check('หมวด "ทั่วไป" ยังตั้งแชร์ได้ตามปกติ', ok);

  // สอนเลขา → ถูกใส่ใน prompt ครั้งต่อไป พร้อมคำสั่ง "ทำตามเสมอ"
  const conv = (await call('POST', '/api/chat/conversations', {}, A.cookie)).json.conversation;
  const t1 = await call('POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'สอนเลขา ให้ตอบสั้น' }, A.cookie);
  check('สอนเลขา → บันทึกลงหมวดความสามารถเลขา', t1.status === 200 && t1.json.savedMemories[0] && t1.json.savedMemories[0].category === 'ความสามารถเลขา', JSON.stringify(t1.json.savedMemories));
  await call('POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'สวัสดี' }, A.cookie);
  check('รอบต่อไปเลขาเห็นสิ่งที่ถูกสอน + ต้องทำตามเสมอ', lastChatPrompt.includes('ทำตามเสมอ') && lastChatPrompt.includes('ชอบให้ตอบสั้นๆ'));

  // ไตร่ตรอง → ข้อเสนอ (กรองหมวดแปลก/ซ้ำ/สั้น)
  reflectReply = '```json\n' + JSON.stringify({ items: [
    { category: 'persona', summary: 'คุณต้นดูสีน้ำแล้วรู้ว่าบ่อกุ้งมีปัญหา' },
    { category: 'dream', summary: 'อยากให้ทุกคนมีเลขาส่วนตัวของตัวเอง' },
    { category: 'weird', summary: 'หมวดที่ไม่มีอยู่จริง' },
    { category: 'lesson', summary: 'คุณต้นดูสีน้ำแล้วรู้ว่าบ่อกุ้งมีปัญหา' },
    { category: 'lesson', summary: 'สั้น' },
  ] }) + '\n```';
  const r1 = await call('POST', '/api/chat/reflect', {}, A.cookie);
  check('ให้เลขาทบทวน → ได้ข้อเสนอที่ถูกต้อง 2 ข้อ (ตัดหมวดแปลก/ซ้ำ/สั้นออก)', r1.status === 200 && r1.json.proposals.length === 2 && r1.json.created === 2, JSON.stringify(r1.json.proposals && r1.json.proposals.map((p) => p.content)));
  check('ข้อเสนออยู่ในหมวดความสามารถเลขา มีป้ายชนิด [ตัวตน]/[ความฝัน]', r1.json.proposals.every((p) => p.category === 'ความสามารถเลขา') && r1.json.proposals.some((p) => p.content.startsWith('[ตัวตน]')) && r1.json.proposals.some((p) => p.content.startsWith('[ความฝัน]')));
  const memCountBefore = (await query('SELECT count(*)::int n FROM memories WHERE owner_id = $1', [uidA])).rows[0].n;
  check('ยังไม่บันทึกเป็นความจำจนกว่าเจ้าของยืนยัน', memCountBefore === 1);
  check('กดทบทวนถี่เกิน → 429 (คุมค่า AI)', (await call('POST', '/api/chat/reflect', {}, A.cookie)).status === 429);
  check('คนอื่นไม่เห็นข้อเสนอของ A', (await call('GET', '/api/chat/proposals', null, B.cookie)).json.proposals.length === 0);

  // เลขาถามในแชท → ผู้ใช้ตอบ "ยืนยัน" → เรียก confirm_memory_proposal
  const tMid = await call('POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'ยืนยัน' }, A.cookie);
  check('กลางบทสนทนา เลขาไม่ถูกสั่งให้ถามเรื่องรอยืนยัน (ไม่ถามถี่)', !lastChatPrompt.includes('รอเจ้าของยืนยัน') && tMid.json.reply === 'ไม่มีข้อเสนอ', tMid.json.reply);
  const conv3 = (await call('POST', '/api/chat/conversations', {}, A.cookie)).json.conversation;
  const t2 = await call('POST', `/api/chat/conversations/${conv3.id}/messages`, { content: 'ยืนยัน' }, A.cookie);
  check('ตอนเริ่มคุยใหม่ prompt มีรายการรอยืนยัน และผู้ใช้ตอบรับ → เลขายืนยันให้', lastChatPrompt.includes('รอเจ้าของยืนยัน') && t2.json.proposals.length === 1, JSON.stringify(t2.json.proposals && t2.json.proposals.length));
  const memAfter = (await query("SELECT m.content FROM memories m JOIN memory_categories c ON c.id = m.category_id WHERE m.owner_id = $1 AND c.name = 'ความสามารถเลขา'", [uidA])).rows;
  check('ข้อที่ยืนยันกลายเป็นความจำถาวรในหมวดความสามารถเลขา', memAfter.length === 2 && memAfter.some((m) => m.content.startsWith('[ตัวตน]')), String(memAfter.length));

  // ปฏิเสธผ่าน REST + คนอื่นตัดสินแทนไม่ได้
  const left = t2.json.proposals[0];
  check('B ตัดสินข้อเสนอของ A ไม่ได้', (await call('POST', `/api/chat/proposals/${left.id}/decide`, { accept: true }, B.cookie)).status === 400);
  const rej = await call('POST', `/api/chat/proposals/${left.id}/decide`, { accept: false }, A.cookie);
  const memFinal = (await query("SELECT count(*)::int n FROM memories WHERE owner_id = $1", [uidA])).rows[0].n;
  check('ปฏิเสธ → ไม่บันทึก และตัดสินซ้ำไม่ได้', rej.status === 200 && memFinal === 2 && (await call('POST', `/api/chat/proposals/${left.id}/decide`, { accept: true }, A.cookie)).status === 400, String(memFinal));

  // ข้อเสนอที่ปฏิเสธแล้วไม่ถูกเสนอซ้ำทันที? (ยังเสนอใหม่ได้ถ้าเจ้าของพูดอีก) — แต่ที่ยืนยันแล้วต้องไม่ซ้ำ
  reflectReply = JSON.stringify({ items: [{ category: 'persona', summary: 'คุณต้นดูสีน้ำแล้วรู้ว่าบ่อกุ้งมีปัญหา' }] });
  const dupCreated = await reflect.reflectConversation(uidA, conv.id);
  check('สิ่งที่จำไว้แล้วไม่ถูกเสนอซ้ำ', dupCreated.length === 0);

  // โมเดลตอบมั่ว (ไม่ใช่ JSON) → ไม่พัง ไม่เกิดข้อเสนอ
  reflectReply = 'ขอโทษค่ะ ไม่เข้าใจ';
  check('โมเดลตอบไม่เป็น JSON → ไม่เกิดข้อเสนอและไม่พัง', (await reflect.reflectConversation(uidA, conv.id)).length === 0);
  check('ตอบ JSON เสียรูป → ไม่พัง', reflect.parseItems('{"items": [oops') .length === 0 && reflect.parseItems('').length === 0);

  // เว้นระยะการไตร่ตรองอัตโนมัติ: ครบ 5 ข้อความของผู้ใช้ค่อยทำ และไม่ทำซ้ำทันที
  const conv2 = (await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation;
  reflectReply = JSON.stringify({ items: [] });
  for (let i = 0; i < 4; i++) await query("INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, 'user', $3, 'text')", [conv2.id, uidB, 'ข้อความ ' + i]);
  check('คุยยังไม่ครบ 5 ข้อความ → ยังไม่ไตร่ตรอง', (await reflect.maybeReflect(uidB, conv2.id)) === null);
  await query("INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, 'user', 'ข้อความ 5', 'text')", [conv2.id, uidB]);
  check('ครบ 5 → ไตร่ตรอง', Array.isArray(await reflect.maybeReflect(uidB, conv2.id)));
  check('แล้วไม่ไตร่ตรองซ้ำทันที', (await reflect.maybeReflect(uidB, conv2.id)) === null);
  const logs = (await query("SELECT m.content, c.name FROM memories m JOIN memory_categories c ON c.id = m.category_id WHERE m.owner_id = $1", [uidB])).rows;
  check('คุยยังไม่ได้แยกหมวด → พักบันทึกการสนทนาไว้ในหมวด "ทั่วไป" ให้เอง (ไม่เรียก AI)', logs.length === 1 && logs[0].name === 'ทั่วไป' && logs[0].content.startsWith('[บันทึกสนทนา') && logs[0].content.includes('ข้อความ 5'), JSON.stringify(logs));
  const listed = (await call('GET', '/api/chat/categories', null, B.cookie)).json.categories;
  check('รายการหมวดเรียง "การใช้งานแพลตฟอร์ม" (คู่มือ) บนสุด ตามด้วย "ทั่วไป" "ความสามารถเลขา" เสมอ', listed[0].name === 'การใช้งานแพลตฟอร์ม' && listed[1].name === 'ทั่วไป' && listed[2].name === 'ความสามารถเลขา', JSON.stringify(listed.map((c) => c.name)));
  await memory.saveMemory(uidB, 'กุ้ง', 'หมวดชื่อ ก. ควรอยู่ใต้หมวดหลัก', conv2.id);
  const listed2 = (await call('GET', '/api/connect/my-categories', null, B.cookie)).json.categories;
  check('หน้าตั้งค่าข้อมูลก็เรียงหมวดหลักไว้บนสุด แม้ชื่ออื่นเรียงก่อนตามตัวอักษร', listed2[0].name === 'การใช้งานแพลตฟอร์ม' && listed2[1].name === 'ทั่วไป' && listed2[2].name === 'ความสามารถเลขา' && listed2[3].name === 'ข้อมูลแชท' && listed2.length === 5, JSON.stringify(listed2.map((c) => c.name)));

  // ---------- หมวดหลักที่ 4: คู่มือการใช้งานแพลตฟอร์ม (อ่านอย่างเดียว) ----------
  const guideLib = require('./platformGuide');
  const gcat = listed2.find((c) => c.name === 'การใช้งานแพลตฟอร์ม');
  check('หมวด "การใช้งานแพลตฟอร์ม" โชว์จำนวนเป็นจำนวนหัวข้อคู่มือ + ติดป้ายอ่านอย่างเดียว', gcat && gcat.items === guideLib.SECTIONS.length && gcat.readonly === true && gcat.visibility === 'private', JSON.stringify(gcat));
  const gitems = await call('GET', '/api/connect/my-categories/' + gcat.id + '/items', null, B.cookie);
  check('ดูเนื้อหาหมวดคู่มือ → ได้ทุกหัวข้อพร้อมคำอธิบายปุ่ม/เมนู', gitems.status === 200 && gitems.json.readonly === true && gitems.json.items.length === guideLib.SECTIONS.length && gitems.json.items.some((i) => i.text.includes('เสียงประมวลผล')));
  const gdel = await call('DELETE', '/api/connect/my-categories/' + gcat.id, null, B.cookie);
  check('ล้าง/ลบหมวดคู่มือไม่ได้', gdel.status >= 400, JSON.stringify(gdel.json));
  let gsave = null; try { await memory.saveMemory(uidB, 'การใช้งานแพลตฟอร์ม', 'ลองเขียนทับคู่มือ', null); } catch (e) { gsave = e.message; }
  check('บันทึกความจำลงหมวดคู่มือไม่ได้ (เลขา/ผู้ใช้ก็เขียนไม่ได้)', !!gsave, gsave);
  let gshare = null; try { await sharing.setCategoryVisibility(uidB, 'การใช้งานแพลตฟอร์ม', 'free'); } catch (e) { gshare = e.message; }
  check('เปิดแชร์/ขายหมวดคู่มือไม่ได้', !!gshare, gshare);
  check('recall หมวดคู่มือ → คืนหัวข้อทั้งหมด', (await memory.recallMemories(uidB, 'การใช้งานแพลตฟอร์ม')).length === guideLib.SECTIONS.length);
  const gTitles = (q) => guideLib.search(q, 3).map((x) => x.title).join('|');
  check('ค้นคู่มือ: "ปรับความดังเสียงติ๊ก" เจอหัวข้อเสียงประมวลผล', gTitles('ปรับความดังเสียงติ๊ก').includes('เสียงประมวลผล'), gTitles('ปรับความดังเสียงติ๊ก'));
  check('ค้นคู่มือ: "เติมเครดิตยังไง" เจอหัวข้อเครดิต', gTitles('เติมเครดิตยังไง').includes('เครดิต'), gTitles('เติมเครดิตยังไง'));
  check('ค้นคู่มือ: "ขอเข้ากลุ่ม" เจอหัวข้อกลุ่ม', gTitles('ขอเข้ากลุ่ม').includes('กลุ่มแชท'), gTitles('ขอเข้ากลุ่ม'));
  check('ค้นคู่มือ: คำที่ไม่มีเลย → ว่าง (เลขาจะได้บอกว่ายังไม่มีข้อมูล)', gTitles('zzzqqq') === '');
  check('ค้นคู่มือ: "เพิ่มรูปในอัลบั้มยังไง" เจอหัวข้ออัลบั้มรูป', gTitles('เพิ่มรูปในอัลบั้มยังไง').includes('อัลบั้มรูป'), gTitles('เพิ่มรูปในอัลบั้มยังไง'));
  check('ค้นคู่มือ: "เสียงพรีเมียมคิดเงินยังไง" เจอหัวข้อเสียงเลขาพรีเมียม', gTitles('เสียงพรีเมียมคิดเงินยังไง').includes('เสียงเลขาพรีเมียม'), gTitles('เสียงพรีเมียมคิดเงินยังไง'));
  check('ค้นคู่มือ: "ข้อความสีเทาในช่องพิมพ์คืออะไร" เจอหัวข้อคำแนะนำจากเลขา', gTitles('ข้อความสีเทาในช่องพิมพ์คืออะไร').includes('คำแนะนำจากเลขา'), gTitles('ข้อความสีเทาในช่องพิมพ์คืออะไร'));
  const tools = require('./secretary').buildTools(uidB, null, {});
  const gr = await tools.platform_guide.run({ topic: 'ตั้งปฏิทิน' });
  check('เครื่องมือ platform_guide ใช้ได้ คืนหัวข้อที่เกี่ยวข้อง (เนื้อหาเต็มไม่เกิน 2 หัวข้อ ไม่แนบรายการหัวข้อทั้งหมด)', gr.found === true && gr.sections[0].title.includes('ปฏิทิน') && gr.sections.length <= 2 && gr.otherTopics === undefined);
  const grWide = await tools.platform_guide.run({ topic: 'เสียง' });
  check('ค้นคำกว้างๆ (เสียง) → ผลที่ส่งให้โมเดลเล็กลง: เนื้อหาเต็ม ≤ 2 หัวข้อ + แค่ชื่อหัวข้อที่ใกล้เคียง', grWide.sections.length <= 2 && Array.isArray(grWide.moreTopics) && JSON.stringify(grWide).length < 6500, String(JSON.stringify(grWide).length));
  const gn = await tools.platform_guide.run({ topic: 'zzzqqq' });
  check('platform_guide ไม่พบ → found=false พร้อมรายการหัวข้อ ไม่แต่งเอง', gn.found === false && gn.topics.length === guideLib.SECTIONS.length);
  check('system prompt สั่งให้เรียก platform_guide เวลาถามวิธีใช้ และไม่ให้เดาชื่อปุ่ม', require('./secretary').buildSystemPrompt({ secretaryName: 'ทดสอบ', userName: 'ทดสอบ' }).includes('เรียก platform_guide ก่อนตอบ'));

  // ---------- เลือกหัวข้อ → คุยต่อ/อัปเดตในหมวดนั้น ----------
  await memory.saveMemory(uidB, 'กุ้ง', 'ข้อมูลเดิม: ปล่อยลูกกุ้งหนาแน่น 60 ตัวต่อตารางเมตร');
  const convF = (await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation;
  await call('POST', `/api/chat/conversations/${convF.id}/messages`, { content: 'อัปเดตรอบใหม่', focusCategory: 'กุ้ง' }, B.cookie);
  check('เลือกหมวดแล้วคุย → เลขาเห็นข้อมูลเดิมของหมวดนั้นและรู้ว่าเป็นการอัปเดต', lastChatPrompt.includes('คุยต่อ/อัปเดตข้อมูลในหมวด "กุ้ง"') && lastChatPrompt.includes('ปล่อยลูกกุ้งหนาแน่น 60'));
  await call('POST', `/api/chat/conversations/${convF.id}/messages`, { content: 'คุยทั่วไป' }, B.cookie);
  check('ไม่ได้เลือกหมวด → ไม่มีโหมดอัปเดตหมวด', !lastChatPrompt.includes('**ตอนนี้ผู้ใช้เลือกคุยต่อ'));
  await call('POST', `/api/chat/conversations/${convF.id}/messages`, { content: 'หมวดคนอื่น', focusCategory: 'วิชาการ' }, B.cookie);
  check('เลือกหมวดที่ไม่มีของตัวเอง → ไม่เห็นข้อมูลของคนอื่น', lastChatPrompt.includes('ยังไม่มีข้อมูล เป็นหมวดใหม่') && !lastChatPrompt.includes('pH'));

  // ---------- หมวด "การใช้งานแพลตฟอร์ม": ไม่แนบคู่มือทั้งฉบับ แนบเฉพาะหัวข้อที่ค้นเจอจากคำถาม ----------
  const guideFocusName = require('./memory').GUIDE_CATEGORY;
  await call('POST', `/api/chat/conversations/${convF.id}/messages`, { content: 'ตั้งปฏิทินเตือนนัดทำยังไง', focusCategory: guideFocusName }, B.cookie);
  const gp = lastChatPrompt;
  const fullLen = guideLib.fullText().length;
  check('คุยในหมวดคู่มือ → แนบเฉพาะหัวข้อที่ตรงกับคำถาม (ปฏิทิน) ไม่แนบคู่มือทั้งฉบับ (prompt สั้นกว่าแนบทั้งฉบับมาก)', gp.includes('ปฏิทิน') && gp.includes('ระบบค้นมาให้แล้ว') && !gp.includes('เสียงเลขาพรีเมียม (เสียงธรรมชาติ)') && gp.length < 20000 && guideLib.search('ตั้งปฏิทินเตือนนัดทำยังไง', 2).every((s) => gp.includes(s.title)), String(gp.length) + ' vs เต็มฉบับ +' + fullLen);
  const convG = (await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation;   // บทสนทนาใหม่ ไม่มีประวัติให้ใช้ช่วยค้น
  await call('POST', `/api/chat/conversations/${convG.id}/messages`, { content: 'zzzqqq', focusCategory: guideFocusName }, B.cookie);
  check('คำถามที่ค้นไม่เจอในหมวดคู่มือ → แนบแค่รายชื่อหัวข้อ + ให้โมเดลค้นด้วยเครื่องมือ (ไม่เดา ไม่แนบทั้งฉบับ)', lastChatPrompt.includes('ไม่พบหัวข้อที่ตรงกับคำถามล่าสุด') && lastChatPrompt.includes('platform_guide'));

  // ---------- ตัวคุมความถี่ "ถามว่าจะบันทึกไหม" ----------
  const convQ = (await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation;
  await call('POST', `/api/chat/conversations/${convQ.id}/messages`, { content: 'สวัสดี วันนี้เป็นไงบ้าง' }, B.cookie);
  check('คุยข้อความแรก → ระบบสั่งเลขา "ห้ามถาม" เรื่องบันทึก (คุยมาน้อย)', lastChatPrompt.includes('[ถามเรื่องบันทึกข้อมูล: ตอนนี้ห้ามถาม]') && lastChatPrompt.includes('ห้ามแนะนำข้อความถัดไปที่เกี่ยวกับการบันทึก'));
  for (let i = 2; i <= 6; i++) await call('POST', `/api/chat/conversations/${convQ.id}/messages`, { content: 'ข้อความที่ ' + i + ' เรื่องบ่อกุ้ง' }, B.cookie);
  check('คุยมา 6 ข้อความ (มีรายละเอียดพอ) → ถามเรื่องบันทึกได้ 1 ครั้ง (ให้สรุปสิ่งที่จะเก็บ) และไม่ห้ามข้อความสีเทา', lastChatPrompt.includes('[ถามเรื่องบันทึกข้อมูล: ถามได้ 1 ครั้งเมื่อถึงจังหวะ]') && !lastChatPrompt.includes('ห้ามแนะนำข้อความถัดไปที่เกี่ยวกับการบันทึก'));
  await query("INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, 'assistant', 'อยากให้เลขาบันทึกสาระที่คุยกันไว้ในหมวดฟาร์มไหมคะ', 'text')", [convQ.id, uidB]);
  await call('POST', `/api/chat/conversations/${convQ.id}/messages`, { content: 'ไม่ต้องจดนะ ขอถามต่อเรื่องอาหารกุ้ง' }, B.cookie);
  check('หลังเลขาเพิ่งถามบันทึกไป → ห้ามถามซ้ำ (ต้องคุยอีกหลายข้อความ) แม้ผู้ใช้ปฏิเสธ', lastChatPrompt.includes('[ถามเรื่องบันทึกข้อมูล: ตอนนี้ห้ามถาม]'));
  await call('POST', `/api/chat/conversations/${convF.id}/messages`, { content: 'อัปเดตรอบใหม่', focusCategory: 'กุ้ง' }, B.cookie);
  check('โหมดเลือกหมวด: เลิกสั่ง "จบแต่ละประเด็นให้ถาม" → ให้ทำตามตัวคุมของระบบแทน', !lastChatPrompt.includes('เมื่อจบแต่ละประเด็นให้สรุปสั้นๆ แล้วถามครั้งเดียว') && lastChatPrompt.includes('ทำตามส่วน [ถามเรื่องบันทึกข้อมูล]'));

  // ---------- กลับเข้าแอป: สรุปบทสนทนาค้างแยกหมวด ----------
  const org = require('./organize');
  const mkConv = async (uid, n, ageMin) => {
    const c = (await query("INSERT INTO conversations (user_id, title, last_message_at) VALUES ($1, 'คุยเรื่องฟาร์ม', now() - ($2 || ' minutes')::interval) RETURNING id", [uid, String(ageMin)])).rows[0].id;
    for (let i = 0; i < n; i++) await query("INSERT INTO messages (conversation_id, user_id, role, content, source) VALUES ($1, $2, 'user', $3, 'text')", [c, uid, 'เรื่องฟาร์มข้อ ' + i]);
    return c;
  };
  await query("UPDATE conversations SET organized_at = now() WHERE user_id = $1", [uidB]);   // ปิดบทสนทนาที่สร้างไว้ก่อนหน้านี้ ไม่ให้ปนกับการทดสอบ
  const cShort = await mkConv(uidB, 3, 120);
  check('คุยน้อยกว่า 6 ข้อความ → ไม่ถาม', (await org.pendingOrganize(uidB)).conversation === null);
  const cFresh = await mkConv(uidB, 8, 2);
  check('เพิ่งคุยจบ (ยังไม่นาน) → ยังไม่ถาม', (await org.pendingOrganize(uidB)).conversation === null);
  const cOld = await mkConv(uidB, 8, 120);
  const pend = await call('GET', '/api/chat/organize/pending', null, B.cookie);
  check('คุยมากพอและกลับเข้ามาใหม่ → ถามหนึ่งครั้ง (ask)', pend.json.mode === 'ask' && pend.json.conversation && pend.json.conversation.id === cOld && pend.json.conversation.userMsgs === 8, JSON.stringify(pend.json));

  organizeReply = JSON.stringify({ items: [
    { category: 'กุ้ง', summary: 'วางแผนปล่อยกุ้งรอบหน้าเดือนธันวาคม' },
    { category: 'ตลาดขายกุ้ง', summary: 'ราคาหน้าฟาร์มช่วงนี้ดีกว่าเดือนก่อน' },
    { category: 'ความสามารถเลขา', summary: 'ห้ามลงหมวดนี้จากการสรุปทั่วไป' },
    { category: 'กุ้ง', summary: 'ข้อมูลเดิม: ปล่อยลูกกุ้งหนาแน่น 60 ตัวต่อตารางเมตร' },
  ] });
  const o1 = await call('POST', `/api/chat/conversations/${cOld}/organize`, {}, B.cookie);
  check('สรุปแยกหมวด → ได้ข้อเสนอ 2 ข้อ (ตัดหมวดความสามารถเลขาและข้อที่ซ้ำของเดิม)', o1.status === 200 && o1.json.proposals.length === 2 && o1.json.proposals.some((p) => p.category === 'ตลาดขายกุ้ง') && !o1.json.proposals.some((p) => p.category === 'ความสามารถเลขา'), JSON.stringify(o1.json.proposals && o1.json.proposals.map((p) => p.category)));
  check('ถามแล้วไม่ถามซ้ำ (บทสนทนานี้ถือว่าจัดเก็บแล้ว)', (await org.pendingOrganize(uidB)).conversation === null || (await org.pendingOrganize(uidB)).conversation.id !== cOld);
  const newCatP = o1.json.proposals.find((p) => p.category === 'ตลาดขายกุ้ง');
  await call('POST', `/api/chat/proposals/${newCatP.id}/decide`, { accept: true }, B.cookie);
  const savedNew = (await query("SELECT m.content FROM memories m JOIN memory_categories c ON c.id = m.category_id WHERE m.owner_id = $1 AND c.name = 'ตลาดขายกุ้ง'", [uidB])).rows;
  check('ยืนยันแล้ว → ได้หมวดใหม่ + บันทึกลงหมวดนั้น', savedNew.length === 1);

  // dismiss + never
  const cDis = await mkConv(uidB, 7, 90);
  await call('POST', `/api/chat/conversations/${cDis}/organize/dismiss`, {}, B.cookie);
  check('กด "ไว้ก่อน" → ไม่ถามเรื่องบทสนทนานี้อีก', (await org.pendingOrganize(uidB)).conversation === null);
  // โหมด auto: สั่งเลขาด้วยเสียง/ข้อความ → บันทึกเลยไม่ต้องถาม
  const convM = (await call('POST', '/api/chat/conversations', {}, B.cookie)).json.conversation;
  await call('POST', `/api/chat/conversations/${convM.id}/messages`, { content: 'ตั้งโหมดบันทึกเอง' }, B.cookie);
  check('บอกเลขา → ตั้งโหมดบันทึกเองได้ (ผู้ใช้กำหนดเอง)', (await org.getMode(uidB)) === 'auto');
  const cAuto = await mkConv(uidB, 7, 100);
  organizeReply = JSON.stringify({ items: [{ category: 'ฟาร์ม', summary: 'ตรวจน้ำทุกเช้าก่อนให้อาหาร' }] });
  const o2 = await call('POST', `/api/chat/conversations/${cAuto}/organize`, { auto: true }, B.cookie);
  check('โหมด auto → บันทึกเข้าหมวดเลยโดยไม่ต้องยืนยัน', o2.json.saved.length === 1 && o2.json.saved[0].category === 'ฟาร์ม' && o2.json.proposals.length === 0, JSON.stringify(o2.json.saved));
  await org.setMode(uidB, 'off');
  await mkConv(uidB, 9, 200);
  check('โหมด off → ไม่ถามเลย', (await call('GET', '/api/chat/organize/pending', null, B.cookie)).json.conversation === null);
  check('โหมดแปลก → ปฏิเสธ', (await call('POST', '/api/chat/organize-mode', { mode: 'banana' }, B.cookie)).status === 400);
  check('A ไม่เห็น/สรุปบทสนทนาของ B ไม่ได้', (await call('POST', `/api/chat/conversations/${cOld}/organize`, {}, A.cookie)).status === 400);

  // ---------- ตั้งชื่อเลขา + ชื่อที่ให้เลขาเรียกผู้ใช้ ----------
  const convN = (await call('POST', '/api/chat/conversations', {}, A.cookie)).json.conversation;
  const n1 = await call('POST', `/api/chat/conversations/${convN.id}/messages`, { content: 'เปลี่ยนชื่อเลขาเป็นน้องครีม' }, A.cookie);
  const rowN1 = (await query('SELECT secretary_name FROM users WHERE id = $1', [uidA])).rows[0];
  check('ผู้ใช้สั่งเปลี่ยนชื่อเลขา → บันทึกจริง + ส่งชื่อใหม่กลับให้หน้าจอ', rowN1.secretary_name === 'น้องครีม' && n1.json.profile && n1.json.profile.secretaryName === 'น้องครีม', JSON.stringify(n1.json.profile));
  const n2 = await call('POST', `/api/chat/conversations/${convN.id}/messages`, { content: 'เรียกฉันว่าพี่ต้นนะ' }, A.cookie);
  check('ผู้ใช้ตั้งชื่อที่ให้เลขาเรียก → บันทึกจริง', (await query('SELECT call_name FROM users WHERE id = $1', [uidA])).rows[0].call_name === 'พี่ต้น' && n2.json.profile && n2.json.profile.callName === 'พี่ต้น');
  await call('POST', `/api/chat/conversations/${convN.id}/messages`, { content: 'สวัสดี' }, A.cookie);
  check('prompt รอบต่อไปใช้ชื่อเลขาใหม่ + เรียกผู้ใช้ตามที่ตั้ง', lastChatPrompt.includes('คุณคือ "น้องครีม"') && lastChatPrompt.includes('เรียกผู้ใช้ว่า "พี่ต้น"') && lastChatPrompt.includes('ใช้ตามนี้เสมอ'));
  const meA = await call('GET', '/api/auth/me', null, A.cookie);
  check('/api/auth/me ส่งชื่อเลขาและชื่อที่ให้เรียกกลับมา (กลับเข้าแอปแล้วยังจำได้)', meA.json.user && meA.json.user.secretaryName === 'น้องครีม' && meA.json.user.callName === 'พี่ต้น', JSON.stringify(meA.json.user && [meA.json.user.secretaryName, meA.json.user.callName]));
  await call('POST', `/api/chat/conversations/${convN.id}/messages`, { content: 'ชื่อยาวเกิน' }, A.cookie);
  check('ชื่อยาวเกิน 20 ตัวอักษร → ไม่เปลี่ยน', (await query('SELECT secretary_name FROM users WHERE id = $1', [uidA])).rows[0].secretary_name === 'น้องครีม');
  await call('POST', `/api/chat/conversations/${convN.id}/messages`, { content: 'ชื่อมีเครื่องหมาย' }, A.cookie);
  check('ชื่อที่มี " < > ใช้ไม่ได้ (กันแทรกคำสั่งใน prompt)', (await query('SELECT call_name FROM users WHERE id = $1', [uidA])).rows[0].call_name === 'พี่ต้น');
  const sB = await call('POST', '/api/chat/conversations', {}, B.cookie);
  await call('POST', `/api/chat/conversations/${sB.json.conversation.id}/messages`, { content: 'สวัสดี' }, B.cookie);
  check('ชื่อของ A ไม่รั่วไปถึง B', !lastChatPrompt.includes('คุณคือ "น้องครีม"') && !lastChatPrompt.includes('เรียกผู้ใช้ว่า "พี่ต้น"'));
  await query('UPDATE users SET name = $2 WHERE id = $1', [uidB, 'ชื่อสมัครที่ยาวมากเกินสิบสองตัวอักษรขึ้นไป']);
  await call('POST', `/api/chat/conversations/${sB.json.conversation.id}/messages`, { content: 'สวัสดีอีกที' }, B.cookie);
  check('ชื่อสมัครยาวและยังไม่ตั้งชื่อเรียก → เลขาถูกสั่งให้ถามชื่อที่อยากให้เรียกครั้งเดียว', lastChatPrompt.includes('ชื่อที่ผู้ใช้ใช้สมัครยาวมาก'));

  // ---------- โปรไฟล์ (กดรูปโปรไฟล์): สรุปขนาดข้อมูล + แก้โปรไฟล์ ----------
  check('ไม่ล็อกอินดูโปรไฟล์ไม่ได้ (401)', (await call('GET', '/api/me/summary')).status === 401);
  const sum = await call('GET', '/api/me/summary', null, A.cookie);
  check('สรุปโปรไฟล์: มีขนาดข้อมูล (ไบต์) แยกตามส่วน และสิทธิ์ Google (ค่าเริ่มต้นเปิดให้ทุกคน)', sum.status === 200 && sum.json.usage.totalBytes > 0 && sum.json.usage.parts.length === 4 && sum.json.usage.parts.find((p) => p.key === 'messages').count >= 4 && sum.json.google.enabled === true && sum.json.google.count === 0, JSON.stringify(sum.json.usage && sum.json.usage.totalBytes));
  check('สรุปมีเพดานสำหรับวาดแถบ (โควตาข้อมูล MB และจำนวนครั้ง Google)', sum.json.usage.quotaBytes >= 1048576 && sum.json.google.limit >= 1, JSON.stringify([sum.json.usage.quotaBytes, sum.json.google.limit]));
  check('ขนาดรวมเท่าผลรวมแต่ละส่วน', sum.json.usage.totalBytes === sum.json.usage.parts.reduce((a, p) => a + p.bytes, 0));
  check('สรุปของ B ไม่ปนข้อมูลของ A (ชื่อ/เบอร์เป็นของ B)', (await call('GET', '/api/me/summary', null, B.cookie)).json.profile.phone === PHONES[1]);
  const pe = await call('PATCH', '/api/me/profile', { name: 'ทดสอบ สอน ใหม่', callName: 'ต้น', secretaryName: 'ครีม' }, A.cookie);
  const rowP = (await query('SELECT name, call_name, secretary_name FROM users WHERE id = $1', [uidA])).rows[0];
  check('แก้โปรไฟล์ได้ (ชื่อ/ชื่อที่ให้เรียก/ชื่อเลขา)', pe.status === 200 && rowP.name === 'ทดสอบ สอน ใหม่' && rowP.call_name === 'ต้น' && rowP.secretary_name === 'ครีม');
  check('เว้นชื่อที่ให้เรียกว่าง → ล้างกลับไปเรียกตามชื่อสมัคร', (await call('PATCH', '/api/me/profile', { name: 'ทดสอบ สอน ใหม่', callName: '', secretaryName: 'ครีม' }, A.cookie)).status === 200 && (await query('SELECT call_name FROM users WHERE id = $1', [uidA])).rows[0].call_name === null);
  check('ชื่อว่าง/ยาวเกิน/มีอักขระต้องห้าม/ชื่อเลขายาวเกิน → 400', (await call('PATCH', '/api/me/profile', { name: '  ', secretaryName: 'ครีม' }, A.cookie)).status === 400
    && (await call('PATCH', '/api/me/profile', { name: 'x'.repeat(101), secretaryName: 'ครีม' }, A.cookie)).status === 400
    && (await call('PATCH', '/api/me/profile', { name: 'ชื่อ <b>', secretaryName: 'ครีม' }, A.cookie)).status === 400
    && (await call('PATCH', '/api/me/profile', { name: 'ชื่อ', secretaryName: 'ชื่อเลขาที่ยาวเกินยี่สิบตัวอักษรแน่ๆ' }, A.cookie)).status === 400);
  // ---------- รูป AI ส่วนตัว ----------
  const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const rawGet = (ck) => fetch(BASE + '/api/me/ai-avatar', { headers: ck ? { Cookie: ck } : {} });
  check('ยังไม่มีรูป AI → GET 404 และสรุปโปรไฟล์ aiAvatarUrl = null / ไม่ล็อกอินดูไม่ได้ (401)', (await rawGet(A.cookie)).status === 404 && sum.json.profile.aiAvatarUrl === null && (await rawGet()).status === 401);
  const putOk = await call('PUT', '/api/me/ai-avatar', { image: PNG1 }, A.cookie);
  check('อัปโหลดรูป AI (PNG) ได้ → ได้ลิงก์รูป', putOk.status === 200 && /^\/api\/me\/ai-avatar\?v=\d+$/.test(putOk.json.aiAvatarUrl || ''), JSON.stringify(putOk.json));
  const got = await rawGet(A.cookie); const gotBuf = Buffer.from(await got.arrayBuffer());
  check('GET ได้รูปเดิมกลับมา (image/png, nosniff, ไม่เปิดให้เบราว์เซอร์เดาชนิด)', got.status === 200 && got.headers.get('content-type') === 'image/png' && got.headers.get('x-content-type-options') === 'nosniff' && gotBuf.equals(Buffer.from(PNG1.split(',')[1], 'base64')));
  check('B ดูรูป AI ของ A ไม่ได้ (ไม่มี id ให้ระบุ; ของ B ยังไม่มี → 404)', (await rawGet(B.cookie)).status === 404);
  const meAv = await call('GET', '/api/auth/me', null, A.cookie);
  check('/api/auth/me ส่งลิงก์รูป AI กลับมา (กลับเข้าแอปแล้วยังเห็น) และสรุปโปรไฟล์ก็มี', /ai-avatar\?v=/.test((meAv.json.user || {}).aiAvatarUrl || '') && /ai-avatar\?v=/.test((await call('GET', '/api/me/summary', null, A.cookie)).json.profile.aiAvatarUrl || ''));
  check('ไฟล์ที่ไม่ใช่รูปจริง/SVG/ชนิดแปลก → ปฏิเสธ (ตรวจไบต์หัวไฟล์ ไม่เชื่อ MIME)',
    (await call('PUT', '/api/me/ai-avatar', { image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, A.cookie)).status === 400
    && (await call('PUT', '/api/me/ai-avatar', { image: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>.....................').toString('base64') }, A.cookie)).status === 400
    && (await call('PUT', '/api/me/ai-avatar', { image: 'not a data url' }, A.cookie)).status === 400
    && (await call('PUT', '/api/me/ai-avatar', {}, A.cookie)).status === 400);
  const big = Buffer.concat([Buffer.from(PNG1.split(',')[1], 'base64'), Buffer.alloc(130 * 1024, 7)]).toString('base64');
  check('รูปใหญ่เกิน 120 KB → ปฏิเสธ และรูปเดิมยังอยู่', (await call('PUT', '/api/me/ai-avatar', { image: 'data:image/png;base64,' + big }, A.cookie)).status === 400 && (await rawGet(A.cookie)).status === 200);
  check('ลบรูป AI ได้ → GET 404', (await call('DELETE', '/api/me/ai-avatar', null, A.cookie)).status === 200 && (await rawGet(A.cookie)).status === 404);

  // ---------- สถานะปัจจุบัน (หมวดอาชีพ → หัวข้อย่อย → รายละเอียด) ----------
  check('สรุปโปรไฟล์ส่งรายการหมวดสถานะ 9 หมวด (รวมที่ปรึกษา/นักวิชาการ ที่หัวข้อย่อยคือสาขาหลักอื่นๆ และ "อื่นๆ" อยู่ท้ายสุด) ให้หน้าจอ', Object.keys(sum.json.occupationOptions || {}).length === 9 && sum.json.occupationOptions['ที่ปรึกษา / นักวิชาการ / นักพัฒนาข้อมูล'].includes('บุคลากรทางการแพทย์') && sum.json.occupationOptions['ที่ปรึกษา / นักวิชาการ / นักพัฒนาข้อมูล'].includes('เกษตรกร / ประมง / ปศุสัตว์') && !sum.json.occupationOptions['ที่ปรึกษา / นักวิชาการ / นักพัฒนาข้อมูล'].includes('อื่นๆ / ไม่ได้ประกอบอาชีพ') && Object.keys(sum.json.occupationOptions).pop() === 'อื่นๆ / ไม่ได้ประกอบอาชีพ' && sum.json.occupationOptions['ข้าราชการ / รัฐวิสาหกิจ'].includes('ครู/อาจารย์/บุคลากรทางการศึกษา') && sum.json.profile.occupationMain === '');
  const okOcc = await call('PATCH', '/api/me/profile', { name: 'ทดสอบ สอน ใหม่', callName: '', secretaryName: 'ครีม', occupationMain: 'ข้าราชการ / รัฐวิสาหกิจ', occupationSub: 'ครู/อาจารย์/บุคลากรทางการศึกษา', occupationDetail: 'สอนคณิตศาสตร์ ม.ต้น' }, A.cookie);
  const occRow = (await query('SELECT occupation_main, occupation_sub, occupation_detail FROM users WHERE id = $1', [uidA])).rows[0];
  check('บันทึกสถานะ (หมวด/หัวข้อย่อย/รายละเอียด) ได้', okOcc.status === 200 && occRow.occupation_main === 'ข้าราชการ / รัฐวิสาหกิจ' && occRow.occupation_sub === 'ครู/อาจารย์/บุคลากรทางการศึกษา' && occRow.occupation_detail === 'สอนคณิตศาสตร์ ม.ต้น', JSON.stringify(occRow));
  const sumOcc = await call('GET', '/api/me/summary', null, A.cookie);
  check('เปิดโปรไฟล์ใหม่ยังเห็นสถานะที่เลือกไว้', sumOcc.json.profile.occupationMain === 'ข้าราชการ / รัฐวิสาหกิจ' && sumOcc.json.profile.occupationDetail === 'สอนคณิตศาสตร์ ม.ต้น');
  const convO = (await call('POST', '/api/chat/conversations', {}, A.cookie)).json.conversation;
  await call('POST', `/api/chat/conversations/${convO.id}/messages`, { content: 'สวัสดี' }, A.cookie);
  check('เลขารู้สถานะของผู้ใช้ (อยู่ใน prompt) พร้อมกฎห้ามแต่งข้อมูลเพิ่ม', lastChatPrompt.includes('ข้าราชการ / รัฐวิสาหกิจ › ครู/อาจารย์/บุคลากรทางการศึกษา — สอนคณิตศาสตร์ ม.ต้น') && lastChatPrompt.includes('ห้ามแต่งข้อมูลเพิ่ม'));
  const sB2 = await call('POST', '/api/chat/conversations', {}, B.cookie);
  await call('POST', `/api/chat/conversations/${sB2.json.conversation.id}/messages`, { content: 'สวัสดี' }, B.cookie);
  check('สถานะของ A ไม่รั่วไปถึง B', !lastChatPrompt.includes('สอนคณิตศาสตร์ ม.ต้น'));
  check('เลือกที่ปรึกษา/นักวิชาการ + สาขา (หัวข้อหลักอื่น) บันทึกได้ / สาขาที่ไม่ใช่หัวข้อหลัก → 400', (await call('PATCH', '/api/me/profile', { name: 'ทดสอบ สอน ใหม่', secretaryName: 'ครีม', occupationMain: 'ที่ปรึกษา / นักวิชาการ / นักพัฒนาข้อมูล', occupationSub: 'เกษตรกร / ประมง / ปศุสัตว์', occupationDetail: 'ที่ปรึกษาการเลี้ยงกุ้ง' }, A.cookie)).status === 200 && (await call('PATCH', '/api/me/profile', { name: 'ทดสอบ สอน ใหม่', secretaryName: 'ครีม', occupationMain: 'ที่ปรึกษา / นักวิชาการ / นักพัฒนาข้อมูล', occupationSub: 'ฟรีแลนซ์' }, A.cookie)).status === 400);
  const bad = (o) => call('PATCH', '/api/me/profile', { name: 'ทดสอบ สอน ใหม่', secretaryName: 'ครีม', ...o }, A.cookie);
  check('หมวดไม่มีอยู่จริง / หัวข้อย่อยไม่ตรงหมวด / อื่นๆ ไม่กรอกรายละเอียด / รายละเอียดยาวเกิน → 400',
    (await bad({ occupationMain: 'มนุษย์ต่างดาว' })).status === 400
    && (await bad({ occupationMain: 'บุคลากรทางการแพทย์', occupationSub: 'ฟรีแลนซ์' })).status === 400
    && (await bad({ occupationMain: 'อื่นๆ / ไม่ได้ประกอบอาชีพ', occupationSub: 'อื่นๆ (โปรดระบุ)', occupationDetail: '' })).status === 400
    && (await bad({ occupationMain: 'ค้าขาย / ธุรกิจส่วนตัว', occupationSub: 'ขายของชำ', occupationDetail: 'ก'.repeat(201) })).status === 400);
  check('อื่นๆ + รายละเอียด → ผ่าน', (await bad({ occupationMain: 'อื่นๆ / ไม่ได้ประกอบอาชีพ', occupationSub: 'อื่นๆ (โปรดระบุ)', occupationDetail: 'นักดนตรีอิสระ' })).status === 200);
  check('ไม่ส่งฟิลด์สถานะ → ไม่แตะของเดิม', (await call('PATCH', '/api/me/profile', { name: 'ทดสอบ สอน ใหม่', secretaryName: 'ครีม' }, A.cookie)).status === 200 && (await query('SELECT occupation_main FROM users WHERE id = $1', [uidA])).rows[0].occupation_main === 'อื่นๆ / ไม่ได้ประกอบอาชีพ');
  check('เลือก "ยังไม่ระบุ" → ล้างสถานะทั้งหมด', (await bad({ occupationMain: '' })).status === 200 && (await query('SELECT occupation_main, occupation_sub, occupation_detail FROM users WHERE id = $1', [uidA])).rows[0].occupation_sub === null);

  check('แก้โปรไฟล์ของ A ไม่กระทบ B', (await query('SELECT secretary_name FROM users WHERE id = $1', [uidB])).rows[0].secretary_name !== 'ครีม');

  // ---------- ลบหมวด + เนื้อหาทั้งหมด ----------
  const delCat = async (uid, name, n) => { for (let i = 0; i < n; i++) await memory.saveMemory(uid, name, 'รายการทดสอบลบ ' + i + ' ของหมวด ' + name); return (await query('SELECT id FROM memory_categories WHERE owner_id = $1 AND name = $2', [uid, name])).rows[0].id; };
  const idDel = await delCat(uidB, 'หมวดทดลองลบ', 3);
  check('A ลบหมวดของ B ไม่ได้', (await call('DELETE', `/api/connect/my-categories/${idDel}`, null, A.cookie)).status === 400);
  const d1 = await call('DELETE', `/api/connect/my-categories/${idDel}`, null, B.cookie);
  const gone = (await query('SELECT (SELECT count(*)::int FROM memory_categories WHERE id = $1) AS c, (SELECT count(*)::int FROM memories WHERE category_id = $1) AS m', [idDel])).rows[0];
  check('ลบหมวดธรรมดา → ตัวหมวดและเนื้อหาหายหมด', d1.status === 200 && d1.json.categoryRemoved === true && d1.json.deletedMemories === 3 && gone.c === 0 && gone.m === 0, JSON.stringify(d1.json));
  check('ลบซ้ำ → 400 (ไม่มีหมวดแล้ว)', (await call('DELETE', `/api/connect/my-categories/${idDel}`, null, B.cookie)).status === 400);

  const idGen = (await query("SELECT id FROM memory_categories WHERE owner_id = $1 AND name = 'ทั่วไป'", [uidB])).rows[0].id;
  await memory.saveMemory(uidB, 'ทั่วไป', 'ของในหมวดทั่วไปที่จะถูกล้าง');
  const d2 = await call('DELETE', `/api/connect/my-categories/${idGen}`, null, B.cookie);
  const stay = (await query('SELECT (SELECT count(*)::int FROM memory_categories WHERE id = $1) AS c, (SELECT count(*)::int FROM memories WHERE category_id = $1) AS m', [idGen])).rows[0];
  check('หมวดหลัก (ทั่วไป) → ล้างเนื้อหาแต่ตัวหมวดยังอยู่', d2.status === 200 && d2.json.categoryRemoved === false && stay.c === 1 && stay.m === 0, JSON.stringify(d2.json));

  // หมวดที่เคยมีคนใช้/จ่ายเครดิต → เก็บชื่อหมวดไว้เป็นประวัติ ล้างเนื้อหา + กลับเป็นส่วนตัว + ถอนสิทธิ์
  const idPaid = await delCat(uidB, 'หมวดมีประวัติใช้งาน', 2);
  await sharing.setCategoryVisibility(uidB, 'หมวดมีประวัติใช้งาน', 'free');
  await query('INSERT INTO access_sessions (requester_id, owner_id, category_id) VALUES ($1, $2, $3)', [uidA, uidB, idPaid]);
  const d3 = await call('DELETE', `/api/connect/my-categories/${idPaid}`, null, B.cookie);
  const kept = (await query('SELECT visibility, (SELECT count(*)::int FROM memories WHERE category_id = $1) AS m FROM memory_categories WHERE id = $1', [idPaid])).rows[0];
  check('หมวดที่มีประวัติใช้งาน → ล้างเนื้อหา เก็บชื่อหมวดไว้ กลับเป็นส่วนตัว', d3.status === 200 && d3.json.categoryRemoved === false && kept && kept.m === 0 && kept.visibility === 'private', JSON.stringify(d3.json));
  await query('DELETE FROM access_sessions WHERE category_id = $1', [idPaid]);

  // เก็บกวาด
  await new Promise((r) => setTimeout(r, 300)); // รอการไตร่ตรองเบื้องหลังที่ค้างอยู่จบก่อน
  const del = await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]);
  const end = await counts();
  const leftover = (await query('SELECT (SELECT count(*)::int FROM users WHERE phone = ANY($1)) AS u', [PHONES])).rows[0].u;
  // (ไม่เทียบจำนวนทั้งระบบเป๊ะๆ แล้ว: ฐานข้อมูลนี้มีเจ้าของใช้งานจริงอยู่พร้อมกัน จำนวนอาจเปลี่ยนระหว่างทดสอบ — เช็กว่าของทดสอบหมดแทน)
  check('ลบข้อมูลทดสอบหมดเกลี้ยง (ผู้ใช้ทดสอบและข้อมูลที่ผูกอยู่หายหมด)', del.rowCount === 2 && leftover === 0 && end.users === base.users, `ก่อน ${JSON.stringify(base)} หลัง ${JSON.stringify(end)}`);

  server.close();
  await getPool().end();
  console.log(failures ? `\n❌ ไม่ผ่าน ${failures} ข้อ` : '\n✅ ผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('ทดสอบพังกลางทาง:', err);
  try { await query('DELETE FROM users WHERE phone = ANY($1)', [PHONES]); } catch { /* ignore */ }
  process.exit(1);
});
