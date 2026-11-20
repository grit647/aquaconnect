// สมองของ AI เลขา — เรียก Gemini ผ่าน Vertex AI (Service Account เดียวกับที่ครีมใช้)
// + วงจร "โมเดลสั่งเครื่องมือ → เซิร์ฟเวอร์ทำจริง → ส่งผลกลับให้โมเดลคิดต่อ" (function calling)
//
// ตั้งค่าใน .env: VERTEX_SERVICE_ACCOUNT_EMAIL, VERTEX_PRIVATE_KEY (ไม่บังคับ: VERTEX_LOCATION, VERTEX_MODEL)
const { google } = require('googleapis');

const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
const REQUEST_TIMEOUT_MS = 40000;

function isConfigured() {
  return !!(process.env.VERTEX_SERVICE_ACCOUNT_EMAIL && process.env.VERTEX_PRIVATE_KEY);
}

function getVertexProjectId() {
  const email = process.env.VERTEX_SERVICE_ACCOUNT_EMAIL || '';
  const match = email.match(/@([^.]+)\.iam\.gserviceaccount\.com$/);
  if (!match) throw new Error('อ่าน Google Cloud project id จาก VERTEX_SERVICE_ACCOUNT_EMAIL ไม่ได้');
  return match[1];
}

let _authClient = null;
async function getAccessToken() {
  if (!_authClient) {
    _authClient = new google.auth.JWT(
      process.env.VERTEX_SERVICE_ACCOUNT_EMAIL, null,
      (process.env.VERTEX_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/cloud-platform']
    );
  }
  const { token } = await _authClient.getAccessToken();
  if (!token) throw new Error('ขอ access token จาก Vertex Service Account ไม่สำเร็จ');
  return token;
}

// เรียกโมเดล 1 รอบ — คืน { parts, usage } (parts อาจเป็นข้อความ หรือคำสั่งเรียกเครื่องมือ)
async function callVertex({ systemPrompt, contents, toolDeclarations }) {
  const projectId = getVertexProjectId();
  const token = await getAccessToken();
  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (toolDeclarations && toolDeclarations.length) body.tools = [{ functionDeclarations: toolDeclarations }];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Vertex AI error (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return {
      parts: data.candidates?.[0]?.content?.parts || [],
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? null,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ตัวเรียกโมเดลที่ใช้จริง — เปลี่ยนได้ตอนทดสอบ (ไม่ต้องเรียก Vertex จริงและไม่เสียเงิน)
let callModel = callVertex;
function setCallModelForTests(fn) { callModel = fn || callVertex; }

// ถอดเสียงพูดเป็นข้อความด้วย Gemini (รับไฟล์เสียงเป็น inlineData ในคำขอ generateContent เดียวกับที่คุยปกติ)
// วิธีเดียวกับที่ครีมใช้ (ทดสอบแล้วว่าถอดภาษาไทยได้แม่น) — ฝั่งเว็บอัดเสียงเองด้วย MediaRecorder แล้วส่งมาที่นี่
async function realTranscribe(base64Audio, mimeType) {
  const projectId = getVertexProjectId();
  const token = await getAccessToken();
  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe the speech in this audio verbatim, in the language actually spoken (usually Thai, sometimes with English words mixed in). Do NOT translate. Output only the transcript with no preface or explanation. Output an empty string only if the audio contains no human speech at all (pure silence or noise).' },
            { inlineData: { mimeType: mimeType || 'audio/webm', data: base64Audio } },
          ],
        }],
        generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Vertex AI (audio) error (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  } finally {
    clearTimeout(timer);
  }
}
let transcribeImpl = realTranscribe;
function transcribeAudio(base64Audio, mimeType) { return transcribeImpl(base64Audio, mimeType); }
function setTranscribeForTests(fn) { transcribeImpl = fn || realTranscribe; }

// อ่านยอดเงินจากรูปสลิปโอนเงิน (Gemini อ่านรูป) — คืนตัวเลขบาท หรือ null ถ้าอ่านไม่ได้/ไม่ใช่สลิป
// ใช้ช่วยแอดมินเท่านั้น ไม่ใช่ตัวตัดสิน: แอดมินต้องกดยืนยันยอดเองทุกครั้งก่อนเครดิตเข้า
async function realReadSlip(base64Image, mimeType) {
  const projectId = getVertexProjectId();
  const token = await getAccessToken();
  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: 'This image may be a Thai bank transfer slip. Reply with JSON only: {"isSlip": boolean, "amount": number or null}. amount = the transferred amount in baht as a plain number (no commas). If it is not a transfer slip or the amount is unreadable, use isSlip=false and amount=null.' },
            { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } },
          ],
        }],
        generationConfig: { maxOutputTokens: 200, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Vertex AI (slip) error (${res.status})`);
    const data = await res.json();
    const raw = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const j = JSON.parse(raw);
    const n = Number(j.amount);
    return j.isSlip && Number.isFinite(n) && n > 0 && n < 10000000 ? n : null;
  } finally {
    clearTimeout(timer);
  }
}
let readSlipImpl = realReadSlip;
function readSlipAmount(base64Image, mimeType) { return readSlipImpl(base64Image, mimeType); }
function setReadSlipForTests(fn) { readSlipImpl = fn || realReadSlip; }

/**
 * วงจรเอเจนต์: ถามโมเดล → ถ้าโมเดลสั่งเรียกเครื่องมือ ก็รันจริงแล้วส่งผลกลับ → วนจนได้คำตอบเป็นข้อความ
 * history: [{ role: 'user'|'assistant', content }]
 * tools:   { ชื่อ: { declaration, run(args) } }
 * คืน { text, executed: [{ name, args, result }], usage }
 */
async function runAgent({ systemPrompt, history, tools, maxSteps = 4 }) {
  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }, ...(m.extraParts || [])],   // extraParts = รูป/PDF แนบ (inlineData) ของข้อความนั้น
  }));
  const toolDeclarations = Object.values(tools || {}).map((t) => t.declaration);
  const executed = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let step = 0; step < maxSteps; step++) {
    const out = await callModel({ systemPrompt, contents, toolDeclarations });
    usage.inputTokens += out.usage?.inputTokens || 0;
    usage.outputTokens += out.usage?.outputTokens || 0;

    const calls = out.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = out.parts.map((p) => p.text || '').join('').trim();
      return { text: text || '(ขออภัย เลขาตอบไม่ได้ในรอบนี้ ลองพิมพ์ใหม่อีกครั้งนะคะ)', executed, usage };
    }

    contents.push({ role: 'model', parts: out.parts });
    const responses = [];
    for (const c of calls) {
      const { name, args } = c.functionCall;
      const tool = tools && tools[name];
      let result;
      try {
        result = tool ? await tool.run(args || {}) : { error: `ไม่มีเครื่องมือชื่อ ${name}` };
      } catch (err) {
        result = { error: err.message };
      }
      executed.push({ name, args: args || {}, result });
      responses.push({ functionResponse: { name, response: result && typeof result === 'object' && !Array.isArray(result) ? result : { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { text: '(เลขาทำงานหลายขั้นตอนเกินไป ลองบอกใหม่ให้สั้นลงนะคะ)', executed, usage };
}

module.exports = { isConfigured, runAgent, setCallModelForTests, transcribeAudio, setTranscribeForTests, readSlipAmount, setReadSlipForTests };
