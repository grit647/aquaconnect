// เลือกตัวละคร 3 มิติของเลขา (แสดงเฉพาะหน้าจอของเรา จำค่าไว้ในเครื่อง)
// รายการตัวละครอยู่ที่ /models/catalog.json — เพิ่มตัวใหม่ = วางไฟล์ .glb ใน public/models แล้วเพิ่มบรรทัดในไฟล์นั้น
(function () {
  'use strict';
  var KEY = 'aq_bot_model';
  var bot = document.getElementById('bot');
  var btn = document.getElementById('botPickBtn');
  if (!bot || !btn) return;
  var catalog = [];
  var applyToken = 0;

  function saved() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function save(id) { try { localStorage.setItem(KEY, id); } catch (e) { /* ไม่เป็นไร */ } }
  function find(id) { for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i]; return null; }

  // ย้อมสี = คูณสีเดิมของแต่ละวัสดุ (ส่วนสีดำยังดำ ส่วนสีขาวเปลี่ยนตามที่เลือก) — เก็บสีเดิมไว้ที่ตัววัสดุเพื่อกลับคืนได้
  function tintModel(mv, tint) {
    var mats = (mv.model && mv.model.materials) || [];
    mats.forEach(function (m) {
      var p = m.pbrMetallicRoughness;
      if (!m.__orig) m.__orig = p.baseColorFactor.slice();
      var o = m.__orig, t = tint || [1, 1, 1, 1];
      p.setBaseColorFactor([o[0] * t[0], o[1] * t[1], o[2] * t[2], o[3]]);
    });
  }
  function applyTint(item, prevModel) {
    // ตัวแสดงผลบอก "load" แล้วแต่ API วัสดุอาจยังไม่พร้อมทันที → ลองซ้ำสั้นๆ จนกว่าจะเจอวัสดุ
    // ไม่พึ่งเหตุการณ์ load (บางครั้งมาก่อนที่เราจะฟัง) → วนเช็กทุก 200ms นานสุด ~30 วินาที จนโมเดลพร้อม
    var token = ++applyToken, tries = 0;
    var run = function () {
      if (token !== applyToken) return; // มีการเลือกตัวใหม่แล้ว
      try { if (bot.loaded && bot.model && bot.model !== prevModel && bot.model.materials && bot.model.materials.length) { tintModel(bot, item.tint); return; } } catch (e) { /* ลองใหม่ */ }
      if (++tries < 150) setTimeout(run, 200);
    };
    run();
  }
  function apply(item) {
    if (!item) return;
    var same = bot.getAttribute('src') === item.src;
    var prev = same ? null : bot.model; // เปลี่ยนไฟล์ → ต้องรอโมเดลใหม่ (ไม่ใช่ตัวเก่า) ก่อนใส่สี
    if (!same) bot.setAttribute('src', item.src);
    applyTint(item, prev);
  }

  function close() { var p = document.getElementById('botPickPop'); if (p) p.remove(); }
  function open() {
    close();
    var cur = saved() || 'classic';
    var pop = document.createElement('div'); pop.id = 'botPickPop';
    var box = document.createElement('div'); box.className = 'bp-box';
    var h = document.createElement('div'); h.className = 'bp-h'; h.textContent = 'เลือกตัวละครของเลขา'; box.appendChild(h);
    var n = document.createElement('div'); n.className = 'bp-n'; n.textContent = 'แสดงบนหน้าจอเครื่องนี้ของคุณเท่านั้น'; box.appendChild(n);
    var grid = document.createElement('div'); grid.className = 'bp-grid';
    catalog.forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'bp-item' + (it.id === cur ? ' on' : '');
      var mv = document.createElement('model-viewer');
      mv.setAttribute('src', it.src); mv.setAttribute('camera-orbit', '0deg 78deg 112%'); mv.setAttribute('interaction-prompt', 'none');
      mv.setAttribute('disable-zoom', ''); mv.setAttribute('exposure', '1.1'); mv.setAttribute('shadow-intensity', '0');
      mv.style.pointerEvents = 'none';
      if (it.tint) mv.addEventListener('load', function () {
        var k = 0, go = function () { try { if (mv.model && mv.model.materials.length) { tintModel(mv, it.tint); return; } } catch (e) { /* */ } if (++k < 40) setTimeout(go, 150); };
        go();
      });
      var nm = document.createElement('span'); nm.textContent = it.name;
      b.appendChild(mv); b.appendChild(nm);
      if (it.credit) { var cr = document.createElement('small'); cr.className = 'bp-credit'; cr.textContent = it.credit; b.appendChild(cr); }
      b.addEventListener('click', function () { save(it.id); apply(it); close(); });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    var x = document.createElement('button'); x.type = 'button'; x.className = 'bp-close'; x.textContent = 'ปิด'; x.addEventListener('click', close);
    box.appendChild(x);
    pop.appendChild(box);
    pop.addEventListener('click', function (e) { if (e.target === pop) close(); });
    document.body.appendChild(pop);
  }

  btn.addEventListener('click', open);
  fetch('/models/catalog.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (list) {
    catalog = Array.isArray(list) ? list.filter(function (i) { return i && i.id && i.src; }) : [];
    if (catalog.length < 2) { btn.hidden = true; }
    var it = find(saved());
    if (it) apply(it);
  }).catch(function () { btn.hidden = true; });
})();
