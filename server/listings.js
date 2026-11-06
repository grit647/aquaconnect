// ลงขายลูกกุ้ง — ตลาดซื้อขายลูกพันธุ์กุ้ง เก็บประกาศไว้ในแท็บ "Listings"
// ต้อง login ก่อนถึงจะลงประกาศได้ (ดึงชื่อ/เบอร์ผู้ขายจาก session โดยตรง ไม่ให้กรอกเอง)
const express = require('express');
const { readTab, writeTabHeaders, appendRow, tabExists, createTab } = require('./sheets');
const { requireAuth } = require('./auth');
const { uploadImageBase64 } = require('./cloudinary');

const router = express.Router();

const LISTINGS_TAB = 'Listings';
const LISTING_HEADERS = [
  'id', 'sellerId', 'sellerName', 'sellerPhone',
  'species', 'plSize', 'price', 'shippingType', 'shippingAmount',
  'promotion', 'imageUrl', 'status', 'createdAt',
];

const SHIPPING_TYPES = ['free', 'distance', 'fixed'];

// สร้างแท็บ Listings อัตโนมัติถ้ายังไม่มี (รองรับ deploy ครั้งแรกโดยไม่ต้องรัน script แยก)
async function ensureListingsTab() {
  const exists = await tabExists(LISTINGS_TAB);
  if (!exists) {
    await createTab(LISTINGS_TAB);
    await writeTabHeaders(LISTINGS_TAB, LISTING_HEADERS);
    return LISTING_HEADERS;
  }
  const { headers } = await readTab(LISTINGS_TAB);
  if (headers.length === 0) {
    await writeTabHeaders(LISTINGS_TAB, LISTING_HEADERS);
    return LISTING_HEADERS;
  }
  return headers;
}

function nextListingId(rows) {
  const nums = rows
    .map((r) => parseInt(String(r.id || '').replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `L${String(max + 1).padStart(5, '0')}`;
}

function publicListing(row) {
  return {
    id: row.id,
    sellerName: row.sellerName,
    sellerPhone: row.sellerPhone,
    species: row.species,
    plSize: row.plSize,
    price: row.price,
    shippingType: row.shippingType,
    shippingAmount: row.shippingAmount,
    promotion: row.promotion,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt,
  };
}

router.get('/', async (req, res) => {
  try {
    await ensureListingsTab();
    const { rows } = await readTab(LISTINGS_TAB);
    const active = rows
      .filter((r) => r.status === 'active')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(publicListing);
    res.json({ listings: active });
  } catch (err) {
    console.error('GET /api/listings error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { species, plSize, price, shippingType, shippingAmount, promotion, imageBase64 } = req.body || {};

    if (!species || typeof species !== 'string' || !species.trim()) {
      return res.status(400).json({ error: 'กรอกพันธุ์กุ้ง' });
    }
    if (!plSize || typeof plSize !== 'string' || !plSize.trim()) {
      return res.status(400).json({ error: 'กรอกขนาดลูกกุ้งที่ขาย (PL)' });
    }
    const priceNum = Number(price);
    if (!price || Number.isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'กรอกราคาให้ถูกต้อง' });
    }
    if (!SHIPPING_TYPES.includes(shippingType)) {
      return res.status(400).json({ error: 'เลือกค่าขนส่งให้ถูกต้อง' });
    }
    let shippingAmountNum = 0;
    if (shippingType === 'fixed') {
      shippingAmountNum = Number(shippingAmount);
      if (!shippingAmount || Number.isNaN(shippingAmountNum) || shippingAmountNum <= 0) {
        return res.status(400).json({ error: 'กรอกค่าขนส่งให้ถูกต้อง' });
      }
    }

    let imageUrl = '';
    if (imageBase64) {
      try {
        imageUrl = await uploadImageBase64(imageBase64, 'aquaconnect/listings');
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({ error: 'อัปโหลดรูปภาพไม่สำเร็จ ลองใหม่อีกครั้ง' });
      }
    }

    const headers = await ensureListingsTab();
    const { rows } = await readTab(LISTINGS_TAB);
    const id = nextListingId(rows);

    const listingRow = {
      id,
      sellerId: req.user.id,
      sellerName: req.user.name,
      sellerPhone: req.user.phone,
      species: species.trim(),
      plSize: plSize.trim(),
      price: priceNum,
      shippingType,
      shippingAmount: shippingAmountNum,
      promotion: (promotion || '').trim(),
      imageUrl,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    await appendRow(LISTINGS_TAB, headers, listingRow);
    res.json({ ok: true, listing: publicListing(listingRow) });
  } catch (err) {
    console.error('POST /api/listings error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
