// "เชื่อมต่อข้อมูล": รายชื่อคนที่เปิดข้อมูลให้เชื่อมต่อ → ดูรายละเอียด/ค่าบริการ → ขอเข้าใช้ (แจ้งเจ้าของพร้อมปุ่มอนุญาต) → ใช้ข้อมูล
// ทุกเส้นทางเป็นของผู้ล็อกอินเท่านั้น และตัวตนมาจากเซสชันฝั่งเซิร์ฟเวอร์เสมอ
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const sharing = require('../sharing');

const router = express.Router();
router.use(requireAuth);

const fail = (res, err) => res.status(400).json({ error: err.message });

// รายชื่อคนที่เปิดหมวดให้คนอื่นเชื่อมต่อได้ (ฟรี/เสียเงิน) — ไม่แสดงเบอร์โทรหรือข้อมูลส่วนตัวอื่น
router.get('/people', async (req, res) => {
  try {
    res.json({ people: await sharing.listPeople(req.user.id) });
  } catch (err) {
    console.error('connect people error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// หมวดที่คนนี้เปิดให้ + ค่าบริการ + สถานะคำขอของฉัน
router.get('/people/:ownerId', async (req, res) => {
  try {
    const r = await sharing.ownerCategories(req.user.id, req.params.ownerId);
    if (!r) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
    res.json(r);
  } catch (err) {
    console.error('connect owner error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// คำขอเข้าถึงของฉัน: incoming (รอเจ้าของ = ฉัน อนุญาต) และ outgoing (ที่ฉันขอคนอื่น)
router.get('/mine', async (req, res) => {
  try {
    const [acc, enabled] = await Promise.all([sharing.listAccess(req.user.id), sharing.getConnectEnabled(req.user.id)]);
    res.json({ ...acc, connectEnabled: enabled });
  } catch (err) {
    console.error('connect mine error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// สวิตช์หลักของฉัน: เปิด/ปิดรับการเชื่อมต่อข้อมูล (ปิด = ไม่มีใครขอหรือใช้ข้อมูลของฉันได้ สิทธิ์เดิมไม่ถูกลบ)
router.post('/enabled', async (req, res) => {
  try {
    const enabled = !!(req.body && req.body.enabled);
    res.json({ ok: true, connectEnabled: await sharing.setConnectEnabled(req.user.id, enabled) });
  } catch (err) { fail(res, err); }
});

router.post('/request', async (req, res) => {
  try {
    const { ownerId, category, message } = req.body || {};
    res.json({ ok: true, ...(await sharing.requestAccess(req.user.id, ownerId, category, message)) });
  } catch (err) { fail(res, err); }
});

router.post('/decide', async (req, res) => {
  try {
    const { requestId, decision } = req.body || {};
    res.json(await sharing.decideRequest(req.user.id, requestId, decision));
  } catch (err) { fail(res, err); }
});

module.exports = router;
