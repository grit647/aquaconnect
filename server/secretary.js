// บุคลิกและกติกาของ AI เลขา + เครื่องมือที่เลขาเรียกใช้ได้ (ผูกกับผู้ใช้คนเดียวที่กำลังคุยเท่านั้น)
const memory = require('./memory');

// ค่าเริ่มต้นของบุคลิกเลขา (ผู้ใช้แต่ละคนเปลี่ยนเองได้ผ่าน users.secretary_persona) — กำหนดคำลงท้ายตายตัว
// ไม่งั้นโมเดลจะสลับ "ครับ/ค่ะ" ไปมาระหว่างข้อความ
const DEFAULT_PERSONA = 'เลขาผู้หญิง สุภาพ อบอุ่น เป็นกันเอง กระชับ ใช้คำลงท้าย "ค่ะ/นะคะ" เสมอ';

function buildSystemPrompt({ secretaryName, persona, userName, memoryContext }) {
  return `คุณคือ "${secretaryName}" ผู้ช่วยส่วนตัว (เลขา) ของ "${userName}" บนแพลตฟอร์ม AquaConnect
บุคลิก: ${persona || DEFAULT_PERSONA}

กติกา:
- เรียกผู้ใช้ว่า "คุณ${userName}" ห้ามเดาเพศของผู้ใช้
- พูดในมุมของเลขาเสมอ เช่น "บันทึกให้แล้วค่ะ" ไม่เล่าเหมือนพูดถึงผู้ใช้เป็นบุคคลที่สาม (ห้ามพูดแนว "คุณ... ได้บันทึกข้อมูล...")
- ตอบสั้น กระชับ เป็นภาษาพูด เพราะคำตอบอาจถูกอ่านออกเสียง ห้ามใช้สัญลักษณ์ markdown (เช่น **, #, ---, ตาราง) ห้ามใช้อีโมจิ
- คุณมีความจำถาวรแยกเป็น "หมวด" ผู้ใช้สั่งให้จำเรื่องอะไรไว้ในหมวดไหนก็ได้ (เช่น หมวดวิชาการ หมวดฟาร์ม)
- เมื่อผู้ใช้สั่งให้จำ/บันทึก/สรุปเก็บ ต้อง **เรียกเครื่องมือ save_memory จริงๆ** ห้ามตอบว่าบันทึกแล้วโดยไม่ได้เรียกเครื่องมือ เด็ดขาด
- ถ้าผู้ใช้เล่าเรื่องสำคัญแต่ไม่ได้สั่งให้จำ ให้ถามก่อนว่าจะให้จำไว้ในหมวดไหน อย่าบันทึกเองโดยไม่ถาม
- ถ้าผู้ใช้ขอ "สรุปหัวข้อนี้แล้วบันทึก" ให้สรุปสาระสำคัญของการคุยในหัวข้อนี้เป็นข้อความกระชับ แล้วบันทึกลงหมวดที่ผู้ใช้ระบุ (ถ้าไม่ระบุ ให้ถามชื่อหมวด)
- ถ้าถามเรื่องที่มีในความจำ ให้ใช้ความจำตอบ ถ้าไม่มี บอกตรงๆ ว่าไม่มีข้อมูล ห้ามแต่งขึ้นเอง
- ข้อมูลในความจำเป็นของผู้ใช้คนนี้เท่านั้น ห้ามบอกว่ารู้ข้อมูลของบุคคลอื่น
${memoryContext ? `\nความจำของคุณเกี่ยวกับ ${userName} (ล่าสุดก่อน):\n${memoryContext}` : '\n(ตอนนี้ยังไม่มีความจำที่บันทึกไว้)'}`;
}

// เครื่องมือของเลขา — userId/conversationId ถูกผูกไว้ตั้งแต่สร้าง AI ไม่มีช่องให้ระบุเองเด็ดขาด
function buildTools(userId, conversationId) {
  return {
    save_memory: {
      declaration: {
        name: 'save_memory',
        description: 'บันทึกความจำของผู้ใช้ลงหมวดที่ระบุ (ถ้ายังไม่มีหมวดนี้ จะสร้างให้เป็นหมวดส่วนตัว) ใช้เมื่อผู้ใช้สั่งให้จำ/บันทึก/สรุปเก็บเท่านั้น',
        parameters: {
          type: 'OBJECT',
          properties: {
            category: { type: 'STRING', description: 'ชื่อหมวด เช่น วิชาการ, ฟาร์ม, ส่วนตัว' },
            content: { type: 'STRING', description: 'เนื้อหาที่จะจำ เขียนให้ชัดเจนอ่านรู้เรื่องด้วยตัวเอง' },
          },
          required: ['category', 'content'],
        },
      },
      run: async (args) => {
        const r = await memory.saveMemory(userId, args.category, args.content, conversationId);
        return { ok: true, category: r.category, createdNewCategory: r.createdCategory };
      },
    },
    list_categories: {
      declaration: {
        name: 'list_categories',
        description: 'ดูรายการหมวดความจำทั้งหมดของผู้ใช้ พร้อมจำนวนรายการในแต่ละหมวด',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: async () => ({ categories: await memory.listCategories(userId) }),
    },
    recall_memories: {
      declaration: {
        name: 'recall_memories',
        description: 'ดึงความจำของผู้ใช้ (ล่าสุดก่อน) ใช้เมื่อต้องการข้อมูลที่เก่ากว่าที่เห็นในความจำที่ให้มา ระบุหมวดหรือไม่ระบุก็ได้',
        parameters: {
          type: 'OBJECT',
          properties: { category: { type: 'STRING', description: 'ชื่อหมวด (ไม่ระบุ = ทุกหมวด)' } },
        },
      },
      run: async (args) => ({ memories: await memory.recallMemories(userId, args.category) }),
    },
  };
}

module.exports = { buildSystemPrompt, buildTools };
