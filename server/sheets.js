// Google Sheets client — generic อ่าน/เขียนได้ทุกแท็บของ Sheet "aquaconnect-th"
// (ตั้งค่า GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_SHEET_ID ใน .env)
const { google } = require('googleapis');

const MAX_ROW = 100000; // กันเหนียวเหมือนโปรเจกต์พี่น้อง — อย่าฮาร์ดโค้ดแคบกว่านี้

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('ไม่ได้ตั้งค่า GOOGLE_SHEET_ID ใน .env');
  return id;
}

let cachedClient = null;
async function getSheetsClient() {
  if (cachedClient) return cachedClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('ไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY ใน .env');
  const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
  await auth.authorize();
  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

// อ่านทั้งแท็บ คืนทั้ง headers (แถวแรก) และรายการแถว (object ตาม header)
async function readTab(tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tabName}!A1:Z${MAX_ROW}`,
  });
  const rows = res.data.values || [];
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0];
  const items = rows.slice(1).map((row, i) => {
    const obj = { _row: i + 2 }; // เลขแถวจริงบนชีต (แถว 1 คือ header)
    headers.forEach((h, idx) => { obj[h] = row[idx] ?? ''; });
    return obj;
  });
  return { headers, rows: items };
}

// เขียน header row ทับทั้งแถว (ใช้ตอน setup/migrate ครั้งแรกเท่านั้น)
async function writeTabHeaders(tabName, headers) {
  const sheets = await getSheetsClient();
  const lastCol = String.fromCharCode(64 + headers.length); // รองรับไม่เกิน 26 คอลัมน์ ซึ่งพอสำหรับตารางพวกนี้
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${tabName}!A1:${lastCol}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
}

// เพิ่มแถวใหม่ 1 แถว ตามลำดับคอลัมน์ของ headers ที่อ่านมา
async function appendRow(tabName, headers, rowObj) {
  const sheets = await getSheetsClient();
  const row = headers.map((h) => (rowObj[h] !== undefined ? String(rowObj[h]) : ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// เช็คว่ามีแท็บ(ชีตย่อย)ชื่อนี้อยู่ใน spreadsheet หรือยัง
async function tabExists(tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId() });
  return (res.data.sheets || []).some((s) => s.properties && s.properties.title === tabName);
}

// สร้างแท็บ(ชีตย่อย)ใหม่เปล่าๆ — ใช้ตอน setup ฟีเจอร์ใหม่ที่ต้องการตารางของตัวเอง
async function createTab(tabName) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
}

module.exports = { readTab, writeTabHeaders, appendRow, tabExists, createTab, getSheetsClient };
