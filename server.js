require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data.json');
const SALES_FILE = path.join(ROOT, 'sales.json');
const REPAIR_FILE = path.join(ROOT, 'repair-history.json');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'change-this-secret';
const SESSION_COOKIE = 'moto_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const useSupabase = String(process.env.USE_SUPABASE || 'false').toLowerCase() === 'true'
  && !!process.env.SUPABASE_URL
  && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = useSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requireAuth);
app.use(express.static(PUBLIC_DIR));

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function signValue(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function createSessionValue() {
  const payload = { u: ADMIN_USERNAME, exp: Date.now() + SESSION_TTL_MS };
  const base = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${base}.${signValue(base)}`;
}

function readSession(req) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw || !raw.includes('.')) return null;
  const [base, sig] = raw.split('.');
  if (!base || !sig || signValue(base) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'));
    if (!payload || payload.u !== ADMIN_USERNAME || Number(payload.exp || 0) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(createSessionValue())}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function isPublicPath(pathname) {
  return pathname === '/login.html'
    || pathname === '/api/login'
    || pathname === '/api/logout'
    || pathname === '/api/auth/me'
    || pathname === '/api/health'
    || pathname === '/'
    || pathname === '/logo.jpg'
    || pathname === '/D.jpg';
}

function requireAuth(req, res, next) {
  if (isPublicPath(req.path)) {
    if (req.path === '/' && readSession(req)) return res.redirect('/pos.html');
    if (req.path === '/') return res.redirect('/login.html');
    return next();
  }

  if (readSession(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบก่อน' });
  return res.redirect('/login.html');
}

function ensureJsonFiles() {
  const defaults = [
    [DB_FILE, []],
    [SALES_FILE, []],
    [REPAIR_FILE, []],
  ];
  for (const [file, fallback] of defaults) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function loadJsonFile(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const text = fs.readFileSync(file, 'utf8').trim();
    return text ? JSON.parse(text) : fallback;
  } catch (error) {
    console.error('JSON read error:', file, error.message);
    return fallback;
  }
}

function saveJsonFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function money(n) {
  return Number(n || 0);
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateKey(v) {
  return String(v || '').slice(0, 10);
}

function getMonthKey(v) {
  return formatDateKey(v).slice(0, 7);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeText(v) {
  return String(v || '').trim();
}

function getPriceLabel(type) {
  if (type === 'wholesale') return 'ราคาส่ง';
  if (type === 'mechanic') return 'ราคาช่าง';
  if (type === 'mixed') return 'หลายราคา';
  return 'ราคาปลีก';
}

function mapItemOut(row) {
  if (!row) return row;
  return {
    id: Number(row.id),
    name: sanitizeText(row.name),
    barcode: sanitizeText(row.barcode),
    category: sanitizeText(row.category),
    model: sanitizeText(row.model),
    year: sanitizeText(row.year),
    quantity: money(row.quantity),
    retailPrice: money(row.retail_price ?? row.retailPrice),
    wholesalePrice: money(row.wholesale_price ?? row.wholesalePrice),
    mechanicPrice: money(row.mechanic_price ?? row.mechanicPrice),
    costPrice: money(row.cost_price ?? row.costPrice),
    minStock: money(row.min_stock ?? row.minStock),
    note: sanitizeText(row.note),
    createdAt: row.created_at || row.createdAt || '',
  };
}

function mapSaleOut(row) {
  if (!row) return row;
  return {
    id: Number(row.id),
    saleId: row.sale_id || row.saleId || '',
    itemId: Number(row.item_id ?? row.itemId ?? 0),
    barcode: sanitizeText(row.barcode),
    name: sanitizeText(row.name),
    category: sanitizeText(row.category),
    model: sanitizeText(row.model),
    year: sanitizeText(row.year),
    qty: money(row.qty),
    priceType: row.price_type || row.priceType || 'retail',
    priceLabel: row.price_label || row.priceLabel || 'ราคาปลีก',
    price: money(row.price),
    total: money(row.line_total ?? row.total),
    costPrice: money(row.cost_price ?? row.costPrice),
    profit: money(row.profit),
    laborCost: money(row.labor_cost ?? row.laborCost),
    grandTotal: money(row.grand_total ?? row.grandTotal),
    customerName: sanitizeText(row.customer_name || row.customerName),
    paid: money(row.paid),
    change: money(row.change_amount ?? row.change),
    createdAt: row.created_at || row.createdAt || row.date || '',
  };
}

function parseParts(parts) {
  if (Array.isArray(parts)) return parts;
  try {
    return JSON.parse(parts || '[]');
  } catch {
    return [];
  }
}

function mapRepairOut(row) {
  if (!row) return row;
  return {
    id: Number(row.id),
    customerName: sanitizeText(row.customer_name || row.customerName),
    phone: sanitizeText(row.phone),
    bikeModel: sanitizeText(row.bike_model || row.bikeModel),
    plate: sanitizeText(row.plate),
    repairDate: sanitizeText(row.repair_date || row.repairDate),
    symptom: sanitizeText(row.symptom),
    parts: parseParts(row.parts),
    partsUsedText: sanitizeText(row.parts_used_text || row.partsUsedText),
    repairPriceType: row.repair_price_type || row.repairPriceType || 'mechanic',
    repairPriceLabel: row.repair_price_label || row.repairPriceLabel || 'ราคาช่าง',
    partsCost: money(row.parts_cost ?? row.partsCost),
    laborCost: money(row.labor_cost ?? row.laborCost),
    totalCost: money(row.total_cost ?? row.totalCost),
    note: sanitizeText(row.note),
    createdAt: row.created_at || row.createdAt || '',
  };
}

function getItemPrice(item, priceType) {
  if (priceType === 'wholesale') return money(item.wholesalePrice || item.wholesale_price);
  if (priceType === 'mechanic') return money(item.mechanicPrice || item.mechanic_price || item.retailPrice || item.retail_price);
  return money(item.retailPrice || item.retail_price);
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  return lines.join('\n');
}

async function getItems() {
  const localReader = () => loadJsonFile(DB_FILE, []).map(mapItemOut).sort((a, b) => b.id - a.id);
  if (!useSupabase) return localReader();
  try {
    const { data, error } = await supabase.from('items').select('*').order('id', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapItemOut);
  } catch (error) {
    console.error('SUPABASE getItems fallback:', error.message || error);
    return localReader();
  }
}

async function saveItems(items) {
  saveJsonFile(DB_FILE, items);
}

async function createItem(payload) {
  const item = {
    id: Date.now(),
    name: sanitizeText(payload.name),
    barcode: sanitizeText(payload.barcode),
    category: sanitizeText(payload.category),
    model: sanitizeText(payload.model),
    year: sanitizeText(payload.year),
    quantity: money(payload.quantity),
    retailPrice: money(payload.retailPrice),
    wholesalePrice: money(payload.wholesalePrice),
    mechanicPrice: money(payload.mechanicPrice),
    costPrice: money(payload.costPrice),
    minStock: money(payload.minStock),
    note: sanitizeText(payload.note),
    createdAt: nowIso(),
  };
  if (!item.name) throw new Error('กรุณาใส่ชื่อสินค้า');

  const saveLocal = () => {
    const items = loadJsonFile(DB_FILE, []).map(mapItemOut);
    items.push(item);
    saveJsonFile(DB_FILE, items);
    return item;
  };

  if (!useSupabase) return saveLocal();
  try {
    const row = {
      id: item.id,
      name: item.name,
      barcode: item.barcode,
      category: item.category,
      model: item.model,
      year: item.year,
      quantity: item.quantity,
      retailPrice: item.retailPrice,
      wholesalePrice: item.wholesalePrice,
      mechanicPrice: item.mechanicPrice,
      costPrice: item.costPrice,
      minStock: item.minStock,
      note: item.note,
      createdAt: item.createdAt,
    };
    const { data, error } = await supabase.from('items').insert(row).select().single();
    if (error) throw error;
    saveLocal();
    return mapItemOut(data);
  } catch (error) {
    console.error('SUPABASE createItem fallback:', error.message || error);
    return saveLocal();
  }
}

async function updateItem(id, payload) {
  const numId = Number(id);
  if (!Number.isFinite(numId)) throw new Error('รหัสสินค้าไม่ถูกต้อง');
  const items = await getItems();
  const found = items.find((i) => i.id === numId);
  if (!found) throw new Error('ไม่พบสินค้า');

  const updated = {
    ...found,
    name: sanitizeText(payload.name ?? found.name),
    barcode: sanitizeText(payload.barcode ?? found.barcode),
    category: sanitizeText(payload.category ?? found.category),
    model: sanitizeText(payload.model ?? found.model),
    year: sanitizeText(payload.year ?? found.year),
    quantity: payload.quantity == null ? found.quantity : money(payload.quantity),
    retailPrice: payload.retailPrice == null ? found.retailPrice : money(payload.retailPrice),
    wholesalePrice: payload.wholesalePrice == null ? found.wholesalePrice : money(payload.wholesalePrice),
    mechanicPrice: payload.mechanicPrice == null ? found.mechanicPrice : money(payload.mechanicPrice),
    costPrice: payload.costPrice == null ? found.costPrice : money(payload.costPrice),
    minStock: payload.minStock == null ? found.minStock : money(payload.minStock),
    note: sanitizeText(payload.note ?? found.note),
  };

  const saveLocal = () => {
    const local = loadJsonFile(DB_FILE, []).map(mapItemOut);
    const idx = local.findIndex((i) => i.id === numId);
    if (idx === -1) throw new Error('ไม่พบสินค้า');
    local[idx] = updated;
    saveJsonFile(DB_FILE, local);
    return updated;
  };

  if (!useSupabase) return saveLocal();
  try {
    const { data, error } = await supabase.from('items').update(updated).eq('id', numId).select().single();
    if (error) throw error;
    saveLocal();
    return mapItemOut(data);
  } catch (error) {
    console.error('SUPABASE updateItem fallback:', error.message || error);
    return saveLocal();
  }
}

async function updateItemStock(id, change) {
  const numId = Number(id);
  const numChange = Number(change);
  if (!Number.isFinite(numChange) || numChange === 0) throw new Error('จำนวนไม่ถูกต้อง');
  const items = await getItems();
  const found = items.find((i) => i.id === numId);
  if (!found) throw new Error('ไม่พบสินค้า');
  const newQty = Number(found.quantity) + numChange;
  if (newQty < 0) throw new Error('สต๊อกติดลบไม่ได้');
  return updateItem(numId, { quantity: newQty });
}

async function restockItemByBarcode(barcode, qty) {
  const code = sanitizeText(barcode);
  const increaseQty = Number(qty);
  if (!code) throw new Error('กรุณาระบุบาร์โค้ด');
  if (!Number.isFinite(increaseQty) || increaseQty <= 0) throw new Error('จำนวนเพิ่มไม่ถูกต้อง');
  const items = await getItems();
  const found = items.find((i) => String(i.barcode || '').trim() === code);
  if (!found) throw new Error('ไม่พบสินค้านี้ในระบบ');
  return updateItemStock(found.id, increaseQty);
}

async function deleteItemById(id) {
  const numId = Number(id);
  const saveLocal = () => {
    const items = loadJsonFile(DB_FILE, []).map(mapItemOut);
    const filtered = items.filter((i) => i.id !== numId);
    if (filtered.length === items.length) throw new Error('ไม่พบสินค้า');
    saveJsonFile(DB_FILE, filtered);
  };
  if (!useSupabase) return saveLocal();
  try {
    const { error } = await supabase.from('items').delete().eq('id', numId);
    if (error) throw error;
    saveLocal();
  } catch (error) {
    console.error('SUPABASE deleteItemById fallback:', error.message || error);
    saveLocal();
  }
}

async function getSales() {
  const localReader = () => loadJsonFile(SALES_FILE, []).map(mapSaleOut).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (!useSupabase) return localReader();
  try {
    const { data, error } = await supabase.from('sales').select('*').order('createdAt', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapSaleOut);
  } catch (error) {
    console.error('SUPABASE getSales fallback:', error.message || error);
    return localReader();
  }
}

async function replaceSales(rows) {
  saveJsonFile(SALES_FILE, rows);
  if (!useSupabase) return;
  try {
    await supabase.from('sales').delete().neq('id', 0);
  } catch {}
}

async function appendSales(rows) {
  const existing = loadJsonFile(SALES_FILE, []).map(mapSaleOut);
  saveJsonFile(SALES_FILE, [...rows.map(mapSaleOut), ...existing]);
}

function normalizeRepairPart(item, raw, fallbackType) {
  const qty = Number(raw.qty) || 0;
  const priceType = String(raw.priceType || fallbackType || 'mechanic');
  const unitPrice = raw.unitPrice == null ? getItemPrice(item, priceType) : money(raw.unitPrice);
  return {
    id: Number(item.id),
    barcode: item.barcode || '',
    name: item.name || '',
    qty,
    unitPrice,
    total: qty * unitPrice,
    priceType,
    priceLabel: raw.priceLabel || getPriceLabel(priceType),
  };
}

function summarizeRepairParts(parts) {
  return parts.map((p) => `[${p.barcode || '-'}] ${p.name} x${p.qty} (${p.priceLabel || getPriceLabel(p.priceType)})`).join(', ');
}

async function getRepairs(query = '') {
  const q = sanitizeText(query).toLowerCase();
  let rows;
  const localReader = () => loadJsonFile(REPAIR_FILE, []).map(mapRepairOut);
  if (!useSupabase) {
    rows = localReader();
  } else {
    try {
      const { data, error } = await supabase.from('repairs').select('*').order('createdAt', { ascending: false });
      if (error) throw error;
      rows = (data || []).map(mapRepairOut);
    } catch (error) {
      console.error('SUPABASE getRepairs fallback:', error.message || error);
      rows = localReader();
    }
  }
  rows = rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [r.customerName, r.phone, r.bikeModel, r.plate, r.symptom, r.partsUsedText, ...(r.parts || []).map((p) => p.name)].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

async function createRepair(payload) {
  const items = await getItems();
  const partsInput = Array.isArray(payload.parts) ? payload.parts : [];
  if (!partsInput.length) throw new Error('กรุณาเลือกอะไหล่');
  const fallbackType = String(payload.repairPriceType || 'mechanic');
  const usedQtyById = {};
  const partsDetail = [];
  let partsCost = 0;

  for (const part of partsInput) {
    const item = items.find((i) => Number(i.id) === Number(part.id));
    if (!item) throw new Error('พบอะไหล่ที่ไม่มีในสต๊อก');
    const normalized = normalizeRepairPart(item, part, fallbackType);
    if (normalized.qty <= 0) throw new Error('จำนวนอะไหล่ไม่ถูกต้อง');
    usedQtyById[normalized.id] = (usedQtyById[normalized.id] || 0) + normalized.qty;
    if (usedQtyById[normalized.id] > Number(item.quantity)) throw new Error(`อะไหล่ ${item.name} มีไม่พอ`);
    partsDetail.push(normalized);
    partsCost += normalized.total;
  }

  const laborCost = money(payload.laborCost);
  const distinctTypes = [...new Set(partsDetail.map((p) => p.priceType))];
  const repairPriceType = distinctTypes.length === 1 ? distinctTypes[0] : 'mixed';
  const record = {
    id: Date.now(),
    customerName: sanitizeText(payload.customerName),
    phone: sanitizeText(payload.phone),
    bikeModel: sanitizeText(payload.bikeModel),
    plate: sanitizeText(payload.plate),
    repairDate: sanitizeText(payload.repairDate),
    symptom: sanitizeText(payload.symptom),
    parts: partsDetail,
    partsUsedText: summarizeRepairParts(partsDetail),
    repairPriceType,
    repairPriceLabel: getPriceLabel(repairPriceType),
    partsCost,
    laborCost,
    totalCost: partsCost + laborCost,
    note: sanitizeText(payload.note),
    createdAt: nowIso(),
  };
  if (!record.customerName) throw new Error('กรุณาใส่ชื่อลูกค้า');

  const saveLocal = () => {
    const repairs = loadJsonFile(REPAIR_FILE, []).map(mapRepairOut);
    const localItems = loadJsonFile(DB_FILE, []).map(mapItemOut);
    for (const part of partsDetail) {
      const idx = localItems.findIndex((i) => Number(i.id) === Number(part.id));
      if (idx !== -1) localItems[idx].quantity = Number(localItems[idx].quantity) - Number(part.qty);
    }
    repairs.push(record);
    saveJsonFile(DB_FILE, localItems);
    saveJsonFile(REPAIR_FILE, repairs);
    return record;
  };

  if (!useSupabase) return saveLocal();
  try {
    for (const part of partsDetail) {
      const item = items.find((i) => Number(i.id) === Number(part.id));
      const newQty = Number(item.quantity) - Number(part.qty);
      const { error: stockError } = await supabase.from('items').update({ quantity: newQty }).eq('id', part.id);
      if (stockError) throw stockError;
    }
    const { data, error } = await supabase.from('repairs').insert(record).select().single();
    if (error) throw error;
    saveLocal();
    return mapRepairOut(data);
  } catch (error) {
    console.error('SUPABASE createRepair fallback:', error.message || error);
    return saveLocal();
  }
}

async function updateRepair(id, payload) {
  const numId = Number(id);
  if (!Number.isFinite(numId)) throw new Error('รหัสประวัติไม่ถูกต้อง');
  const existing = (await getRepairs()).find((r) => r.id === numId);
  if (!existing) throw new Error('ไม่พบประวัติ');
  const items = await getItems();
  const partsInput = Array.isArray(payload.parts) ? payload.parts : [];
  if (!partsInput.length) throw new Error('กรุณาเลือกอะไหล่');
  const fallbackType = String(payload.repairPriceType || existing.repairPriceType || 'mechanic');
  const partsDetail = [];
  let partsCost = 0;

  const oldQtyById = (existing.parts || []).reduce((acc, p) => {
    acc[p.id] = (acc[p.id] || 0) + Number(p.qty || 0);
    return acc;
  }, {});
  const newQtyById = {};

  for (const part of partsInput) {
    const item = items.find((i) => Number(i.id) === Number(part.id));
    if (!item) throw new Error('พบอะไหล่ที่ไม่มีในสต๊อก');
    const normalized = normalizeRepairPart(item, part, fallbackType);
    if (normalized.qty <= 0) throw new Error('จำนวนอะไหล่ไม่ถูกต้อง');
    newQtyById[normalized.id] = (newQtyById[normalized.id] || 0) + normalized.qty;
    partsDetail.push(normalized);
    partsCost += normalized.total;
  }

  for (const item of items) {
    const oldQty = Number(oldQtyById[item.id] || 0);
    const newQty = Number(newQtyById[item.id] || 0);
    const resultQty = Number(item.quantity) + oldQty - newQty;
    if (resultQty < 0) throw new Error(`อะไหล่ ${item.name} มีไม่พอ`);
  }

  const laborCost = money(payload.laborCost);
  const distinctTypes = [...new Set(partsDetail.map((p) => p.priceType))];
  const repairPriceType = distinctTypes.length === 1 ? distinctTypes[0] : 'mixed';
  const updated = {
    id: numId,
    customerName: sanitizeText(payload.customerName),
    phone: sanitizeText(payload.phone),
    bikeModel: sanitizeText(payload.bikeModel),
    plate: sanitizeText(payload.plate),
    repairDate: sanitizeText(payload.repairDate),
    symptom: sanitizeText(payload.symptom),
    parts: partsDetail,
    partsUsedText: summarizeRepairParts(partsDetail),
    repairPriceType,
    repairPriceLabel: getPriceLabel(repairPriceType),
    partsCost,
    laborCost,
    totalCost: partsCost + laborCost,
    note: sanitizeText(payload.note),
    createdAt: existing.createdAt || nowIso(),
  };
  if (!updated.customerName) throw new Error('กรุณาใส่ชื่อลูกค้า');

  const saveLocal = () => {
    const repairs = loadJsonFile(REPAIR_FILE, []).map(mapRepairOut);
    const localItems = loadJsonFile(DB_FILE, []).map(mapItemOut);
    for (const item of localItems) {
      const oldQty = Number(oldQtyById[item.id] || 0);
      const newQty = Number(newQtyById[item.id] || 0);
      if (oldQty || newQty) item.quantity = Number(item.quantity) + oldQty - newQty;
    }
    const idx = repairs.findIndex((r) => r.id === numId);
    if (idx === -1) throw new Error('ไม่พบประวัติ');
    repairs[idx] = updated;
    saveJsonFile(DB_FILE, localItems);
    saveJsonFile(REPAIR_FILE, repairs);
    return updated;
  };

  if (!useSupabase) return saveLocal();
  try {
    for (const item of items) {
      const oldQty = Number(oldQtyById[item.id] || 0);
      const newQty = Number(newQtyById[item.id] || 0);
      if (!oldQty && !newQty) continue;
      const resultQty = Number(item.quantity) + oldQty - newQty;
      const { error: stockError } = await supabase.from('items').update({ quantity: resultQty }).eq('id', item.id);
      if (stockError) throw stockError;
    }
    const { data, error } = await supabase.from('repairs').update(updated).eq('id', numId).select().single();
    if (error) throw error;
    saveLocal();
    return mapRepairOut(data);
  } catch (error) {
    console.error('SUPABASE updateRepair fallback:', error.message || error);
    return saveLocal();
  }
}

async function deleteRepairById(id) {
  const numId = Number(id);
  const saveLocal = () => {
    const repairs = loadJsonFile(REPAIR_FILE, []).map(mapRepairOut);
    const target = repairs.find((r) => r.id === numId);
    if (!target) throw new Error('ไม่พบประวัติ');
    const items = loadJsonFile(DB_FILE, []).map(mapItemOut);
    for (const part of target.parts || []) {
      const idx = items.findIndex((i) => Number(i.id) === Number(part.id));
      if (idx !== -1) items[idx].quantity = Number(items[idx].quantity) + Number(part.qty || 0);
    }
    saveJsonFile(DB_FILE, items);
    saveJsonFile(REPAIR_FILE, repairs.filter((r) => r.id !== numId));
  };
  if (!useSupabase) return saveLocal();
  try {
    const repairs = await getRepairs();
    const target = repairs.find((r) => r.id === numId);
    if (target) {
      const items = await getItems();
      for (const part of target.parts || []) {
        const item = items.find((i) => Number(i.id) === Number(part.id));
        if (item) await supabase.from('items').update({ quantity: Number(item.quantity) + Number(part.qty || 0) }).eq('id', item.id);
      }
    }
    const { error } = await supabase.from('repairs').delete().eq('id', numId);
    if (error) throw error;
    saveLocal();
  } catch (error) {
    console.error('SUPABASE deleteRepairById fallback:', error.message || error);
    saveLocal();
  }
}

async function checkoutSale(payload) {
  const orderItems = Array.isArray(payload.items) ? payload.items : [];
  const laborCost = money(payload.laborCost);
  const paid = money(payload.paid);
  const customerName = sanitizeText(payload.customerName);
  if (!orderItems.length) throw new Error('ไม่มีสินค้าในตะกร้า');
  if (paid <= 0) throw new Error('กรุณาใส่เงินที่ลูกค้าจ่าย');

  const items = await getItems();
  const usedQtyById = {};
  const receiptItems = [];
  let subtotal = 0;

  for (const order of orderItems) {
    const item = items.find((i) => i.id === Number(order.id));
    const qty = Number(order.qty) || 0;
    if (!item) throw new Error('ไม่พบสินค้า');
    if (qty <= 0) throw new Error('จำนวนไม่ถูกต้อง');
    usedQtyById[item.id] = (usedQtyById[item.id] || 0) + qty;
    if (usedQtyById[item.id] > Number(item.quantity)) throw new Error(`สินค้า ${item.name} มีไม่พอ`);
    const priceType = String(order.priceType || 'retail');
    const price = money(order.price ?? getItemPrice(item, priceType));
    const lineTotal = price * qty;
    const costPrice = money(item.costPrice);
    const profit = (price - costPrice) * qty;
    subtotal += lineTotal;
    receiptItems.push({
      id: item.id,
      barcode: item.barcode || '',
      code: item.barcode || '',
      name: item.name,
      category: item.category || '',
      model: item.model || '',
      year: item.year || '',
      qty,
      price,
      total: lineTotal,
      priceType,
      priceLabel: order.priceLabel || getPriceLabel(priceType),
      costPrice,
      profit,
    });
  }

  const total = subtotal + laborCost;
  const change = paid - total;
  if (change < 0) throw new Error(`เงินไม่พอ ขาดอีก ${Math.abs(change)} บาท`);

  const saleId = `RC${Date.now()}`;
  const createdAt = nowIso();
  const saleRows = receiptItems.map((line, idx) => ({
    id: Date.now() + idx,
    saleId,
    itemId: line.id,
    barcode: line.barcode,
    name: line.name,
    category: line.category,
    model: line.model,
    year: line.year,
    qty: line.qty,
    priceType: line.priceType,
    priceLabel: line.priceLabel,
    price: line.price,
    total: line.total,
    costPrice: line.costPrice,
    profit: line.profit,
    laborCost,
    grandTotal: total,
    customerName,
    paid,
    change,
    createdAt,
  }));

  const saveLocal = () => {
    const localItems = loadJsonFile(DB_FILE, []).map(mapItemOut);
    for (const line of receiptItems) {
      const idx = localItems.findIndex((i) => i.id === line.id);
      if (idx !== -1) localItems[idx].quantity = Number(localItems[idx].quantity) - Number(line.qty);
    }
    saveJsonFile(DB_FILE, localItems);
    appendSales(saleRows);
  };

  if (!useSupabase) {
    saveLocal();
  } else {
    try {
      for (const line of receiptItems) {
        const item = items.find((i) => i.id === line.id);
        await supabase.from('items').update({ quantity: Number(item.quantity) - Number(line.qty) }).eq('id', line.id);
      }
      const { error } = await supabase.from('sales').insert(saleRows);
      if (error) throw error;
      saveLocal();
    } catch (error) {
      console.error('SUPABASE checkoutSale fallback:', error.message || error);
      saveLocal();
    }
  }

  const distinctPriceTypes = [...new Set(receiptItems.map((line) => String(line.priceType || 'retail')))];
  const receiptPriceType = distinctPriceTypes.length === 1 ? distinctPriceTypes[0] : 'mixed';
  return {
    saleId,
    date: new Date(createdAt).toLocaleString('th-TH'),
    customerName,
    items: receiptItems,
    subtotal,
    laborCost,
    total,
    paid,
    change,
    priceType: receiptPriceType,
    priceLabel: getPriceLabel(receiptPriceType),
  };
}

function buildReport(sales, items, startDate, endDate) {
  const inRange = sales.filter((s) => {
    const d = formatDateKey(s.createdAt);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  });

  const groupedByBill = new Map();
  for (const row of inRange) {
    if (!groupedByBill.has(row.saleId)) {
      groupedByBill.set(row.saleId, {
        saleId: row.saleId,
        createdAt: row.createdAt,
        customerName: row.customerName || '-',
        itemsTotal: 0,
        laborCost: money(row.laborCost),
        grandTotal: money(row.grandTotal),
      });
    }
    const bill = groupedByBill.get(row.saleId);
    bill.itemsTotal += money(row.total);
    bill.profit = money(bill.profit) + money(row.profit);
    bill.laborCost = Math.max(money(bill.laborCost), money(row.laborCost));
    bill.grandTotal = Math.max(money(bill.grandTotal), money(row.grandTotal));
  }

  const todayKey = getTodayKey();
  const monthKey = todayKey.slice(0, 7);
  const todaySales = sales.filter((s) => formatDateKey(s.createdAt) === todayKey);
  const monthSales = sales.filter((s) => getMonthKey(s.createdAt) === monthKey);

  const itemProfitMap = new Map();
  for (const row of inRange) {
    const key = `${row.itemId}`;
    if (!itemProfitMap.has(key)) {
      itemProfitMap.set(key, {
        itemId: row.itemId,
        name: row.name,
        barcode: row.barcode,
        qty: 0,
        sales: 0,
        cost: 0,
        profit: 0,
      });
    }
    const it = itemProfitMap.get(key);
    it.qty += money(row.qty);
    it.sales += money(row.total);
    it.cost += money(row.costPrice) * money(row.qty);
    it.profit += money(row.profit);
  }

  const lowStock = items
    .filter((i) => Number(i.minStock || 0) > 0 && Number(i.quantity || 0) <= Number(i.minStock || 0))
    .sort((a, b) => Number(a.quantity) - Number(b.quantity));

  return {
    summary: {
      todaySales: todaySales.reduce((sum, s) => sum + money(s.total) + 0, 0) + sumUniqueBillLabor(todaySales),
      monthSales: monthSales.reduce((sum, s) => sum + money(s.total) + 0, 0) + sumUniqueBillLabor(monthSales),
      rangeSales: inRange.reduce((sum, s) => sum + money(s.total), 0) + sumUniqueBillLabor(inRange),
      billCount: groupedByBill.size,
      itemCount: inRange.reduce((sum, s) => sum + money(s.qty), 0),
      laborTotal: sumUniqueBillLabor(inRange),
      profitTotal: inRange.reduce((sum, s) => sum + money(s.profit), 0),
    },
    bills: [...groupedByBill.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    itemProfits: [...itemProfitMap.values()].sort((a, b) => b.profit - a.profit),
    lowStock,
  };
}

function sumUniqueBillLabor(rows) {
  const byBill = new Map();
  for (const row of rows) {
    byBill.set(row.saleId, Math.max(money(byBill.get(row.saleId)), money(row.laborCost)));
  }
  return [...byBill.values()].reduce((sum, n) => sum + money(n), 0);
}

app.get('/api/auth/me', (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ success: false, authenticated: false });
  res.json({ success: true, authenticated: true, username: ADMIN_USERNAME });
});

app.post('/api/login', (req, res) => {
  const username = sanitizeText(req.body.username);
  const password = String(req.body.password || '');
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  setSessionCookie(res);
  res.json({ success: true, username: ADMIN_USERNAME });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/health', async (req, res) => {
  try {
    if (!useSupabase) return res.json({ ok: true, provider: 'json' });
    const { error } = await supabase.from('items').select('id').limit(1);
    if (error) throw error;
    res.json({ ok: true, provider: 'supabase', fallback: 'json' });
  } catch (error) {
    res.status(500).json({ ok: false, provider: 'supabase', message: error.message || 'Supabase error' });
  }
});

app.get('/api/items', async (req, res) => {
  try { res.json(await getItems()); } catch (error) { res.status(500).json({ success: false, message: error.message || 'โหลดสินค้าไม่สำเร็จ' }); }
});
app.post('/api/items', async (req, res) => {
  try { res.json({ success: true, item: await createItem(req.body || {}) }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'บันทึกสินค้าไม่สำเร็จ' }); }
});
app.put('/api/items/:id', async (req, res) => {
  try { res.json({ success: true, item: await updateItem(req.params.id, req.body || {}) }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'แก้ไขสินค้าไม่สำเร็จ' }); }
});
app.patch('/api/items/:id/stock', async (req, res) => {
  try { res.json({ success: true, item: await updateItemStock(req.params.id, req.body.change) }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'อัปเดตสต๊อกไม่สำเร็จ' }); }
});
app.patch('/api/items/restock-by-barcode', async (req, res) => {
  try { res.json({ success: true, item: await restockItemByBarcode(req.body.barcode, req.body.qty) }); } catch (error) { res.status(String(error.message || '').includes('ไม่พบ') ? 404 : 500).json({ success: false, message: error.message || 'เติมสต๊อกด้วยบาร์โค้ดไม่สำเร็จ' }); }
});
app.delete('/api/items/:id', async (req, res) => {
  try { await deleteItemById(req.params.id); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'ลบสินค้าไม่สำเร็จ' }); }
});

app.post('/api/checkout', async (req, res) => {
  try { const receipt = await checkoutSale(req.body || {}); res.json({ success: true, total: receipt.total, receipt }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'คิดเงินไม่สำเร็จ' }); }
});

app.get('/api/report', async (req, res) => {
  try {
    const sales = await getSales();
    const items = await getItems();
    const today = getTodayKey();
    const startDate = sanitizeText(req.query.startDate) || today;
    const endDate = sanitizeText(req.query.endDate) || today;
    res.json({ success: true, ...buildReport(sales, items, startDate, endDate) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'โหลดรายงานไม่สำเร็จ' });
  }
});

app.delete('/api/report/clear', async (req, res) => {
  try { await replaceSales([]); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'เคลียร์รายงานไม่สำเร็จ' }); }
});

app.get('/api/export/:type', async (req, res) => {
  try {
    const type = String(req.params.type || '');
    let rows = [];
    if (type === 'items') rows = (await getItems()).map((r) => ({ ...r }));
    else if (type === 'sales') rows = (await getSales()).map((r) => ({ ...r }));
    else if (type === 'repairs') rows = (await getRepairs()).map((r) => ({ ...r, parts: JSON.stringify(r.parts || []) }));
    else return res.status(404).json({ success: false, message: 'ไม่พบประเภท export' });
    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-${Date.now()}.csv`);
    res.send('\ufeff' + csv);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'export ไม่สำเร็จ' });
  }
});

app.get('/api/repairs', async (req, res) => {
  try { res.json(await getRepairs(req.query.q || '')); } catch (error) { res.status(500).json({ success: false, message: error.message || 'โหลดประวัติการซ่อมไม่สำเร็จ' }); }
});
app.post('/api/repairs', async (req, res) => {
  try { res.json({ success: true, record: await createRepair(req.body || {}) }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'บันทึกประวัติไม่สำเร็จ' }); }
});
app.put('/api/repairs/:id', async (req, res) => {
  try { res.json({ success: true, record: await updateRepair(req.params.id, req.body || {}) }); } catch (error) { res.status(String(error.message || '').includes('ไม่พบ') ? 404 : 500).json({ success: false, message: error.message || 'อัปเดตประวัติไม่สำเร็จ' }); }
});
app.delete('/api/repairs/:id', async (req, res) => {
  try { await deleteRepairById(req.params.id); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false, message: error.message || 'ลบประวัติไม่สำเร็จ' }); }
});

ensureJsonFiles();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Data provider: ${useSupabase ? 'Supabase' : 'JSON files'}`);
});
