// Google Sheets client — เก็บข้อมูลสมาชิกในแท็บ "Users" ของ Sheet "aquaconnect-th"
// (ตั้งค่า GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_SHEET_ID ใน .env)
const { google } = require('googleapis');

const USERS_TAB = 'Users';
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

// อ่านทั้งแท็บ Users คืนทั้ง headers (แถวแรก) และรายชื่อผู้ใช้ (object ตาม header)
async function readUsers() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${USERS_TAB}!A1:Z${MAX_ROW}`,
  });
  const rows = res.data.values || [];
  if (rows.length === 0) return { headers: [], users: [] };
  const headers = rows[0];
  const users = rows.slice(1).map((row, i) => {
    const obj = { _row: i + 2 }; // เลขแถวจริงบนชีต (แถว 1 คือ header)
    headers.forEach((h, idx) => { obj[h] = row[idx] ?? ''; });
    return obj;
  });
  return { headers, users };
}

// เขียน header row ทับทั้งแถว (ใช้ตอน setup/migrate ครั้งแรกเท่านั้น)
async function writeHeaders(headers) {
  const sheets = await getSheetsClient();
  const lastCol = String.fromCharCode(64 + headers.length); // รองรับไม่เกิน 26 คอลัมน์ ซึ่งพอสำหรับตารางนี้
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${USERS_TAB}!A1:${lastCol}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
}

// เพิ่มผู้ใช้ 1 แถว ตามลำดับคอลัมน์ของ headers ที่อ่านมา
async function appendUser(headers, userObj) {
  const sheets = await getSheetsClient();
  const row = headers.map((h) => (userObj[h] !== undefined ? String(userObj[h]) : ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${USERS_TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

module.exports = { readUsers, writeHeaders, appendUser, getSheetsClient, USERS_TAB };
