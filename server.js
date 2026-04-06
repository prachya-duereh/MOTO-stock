require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const USE_SUPABASE = String(process.env.USE_SUPABASE || 'false').toLowerCase() === 'true';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_USERNAME_2 = process.env.ADMIN_USERNAME_2 || '';
const ADMIN_PASSWORD_2 = process.env.ADMIN_PASSWORD_2 || '';
const ADMIN_PASSWORD_HASH_2 = process.env.ADMIN_PASSWORD_HASH_2 || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DB_FILE = path.join(__dirname, 'data.json');
const REPAIR_FILE = path.join(__dirname, 'repair-history.json');
const SALES_FILE = path.join(__dirname, 'sales.json');
const CUSTOMERS_FILE = path.join(__dirname, 'customers.json');
const LOGIN_LOG_FILE = path.join(__dirname, 'login-logs.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_NAME = 'moto.sid';
const sessions = new Map();

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

const supabase = USE_SUPABASE && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

function nowIso() {
  return new Date().toISOString();
}

function hmac(value) {
  return crypto.createHmac('sha256', SESSION_SECRET || 'moto-stock-dev-secret-change-me').update(String(value)).digest('hex');
}

function makeScryptHash(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString('hex');
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ''));
}

function safeTimingEqualHex(leftHex, rightHex) {
  if (!leftHex || !rightHex) return false;
  try {
    const left = Buffer.from(String(leftHex), 'hex');
    const right = Buffer.from(String(rightHex), 'hex');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function verifyPassword(password, plainPassword, passwordHash) {
  const raw = String(password || '');
  const hash = String(passwordHash || '').trim();

  if (hash) {
    if (isBcryptHash(hash)) {
      try {
        return bcrypt.compareSync(raw, hash);
      } catch (_) {
        return false;
      }
    }

    const [scheme, salt, savedHash] = hash.split('$');
    if (scheme === 'scrypt' && salt && savedHash) {
      const testHash = makeScryptHash(raw, salt);
      return safeTimingEqualHex(testHash, savedHash);
    }

    return false;
  }

  return raw === String(plainPassword || '');
}

function getAdminAccounts() {
  const admins = [
    { username: cleanText(ADMIN_USERNAME), plainPassword: ADMIN_PASSWORD, passwordHash: ADMIN_PASSWORD_HASH },
    { username: cleanText(ADMIN_USERNAME_2), plainPassword: ADMIN_PASSWORD_2, passwordHash: ADMIN_PASSWORD_HASH_2 },
  ].filter((row) => row.username);

  const seen = new Set();
  return admins.filter((row) => {
    const key = row.username.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findAuthenticatedAdmin(username, password) {
  const wanted = cleanText(username).toLowerCase();
  return getAdminAccounts().find((admin) => admin.username.toLowerCase() === wanted && verifyPassword(password, admin.plainPassword, admin.passwordHash)) || null;
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) out[key] = value;
  }
  return out;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const sid = raw.slice(0, lastDot);
  const sig = raw.slice(lastDot + 1);
  if (!sid || !sig) return null;
  const expected = hmac(sid);
  const sigOk = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!sigOk) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  return { sid, ...session };
}

function setSessionCookie(res, sid) {
  const value = `${sid}.${hmac(sid)}`;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function createSession(req, res, user) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, {
    user,
    createdAt: nowIso(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
    logId: null,
  });
  setSessionCookie(res, sid);
  return sid;
}

function requireApiAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session?.user) {
    return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบก่อน' });
  }
  req.session = session;
  next();
}

function requirePageAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session?.user) {
    return res.redirect('/login.html');
  }
  req.session = session;
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function appendLoginLog(entry) {
  const rows = readJSON(LOGIN_LOG_FILE, []);
  const list = Array.isArray(rows) ? rows : [];
  const logEntry = {
    id: newId(),
    username: cleanText(entry.username),
    loginAt: nowIso(),
    logoutAt: '',
    ip: cleanText(entry.ip),
    userAgent: cleanText(entry.userAgent),
  };
  list.unshift(logEntry);
  writeJSON(LOGIN_LOG_FILE, list.slice(0, 1000));
  return logEntry.id;
}

function markLogoutLog(logId) {
  if (!logId) return;
  const rows = readJSON(LOGIN_LOG_FILE, []);
  if (!Array.isArray(rows)) return;
  const idx = rows.findIndex((row) => String(row.id) === String(logId));
  if (idx === -1) return;
  rows[idx].logoutAt = nowIso();
  writeJSON(LOGIN_LOG_FILE, rows);
}

function newId() {
  return Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`);
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error('readJSON error:', error);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function ensureLocalDB() {
  if (!fs.existsSync(DB_FILE)) writeJSON(DB_FILE, []);
  if (!fs.existsSync(REPAIR_FILE)) writeJSON(REPAIR_FILE, []);
  if (!fs.existsSync(SALES_FILE)) writeJSON(SALES_FILE, []);
  if (!fs.existsSync(CUSTOMERS_FILE)) writeJSON(CUSTOMERS_FILE, []);
  if (!fs.existsSync(LOGIN_LOG_FILE)) writeJSON(LOGIN_LOG_FILE, []);

  const itemsRaw = readJSON(DB_FILE, []);
  const repairsRaw = readJSON(REPAIR_FILE, []);
  const salesRaw = readJSON(SALES_FILE, []);
  const customersRaw = readJSON(CUSTOMERS_FILE, []);

  if (!Array.isArray(itemsRaw) && !Array.isArray(itemsRaw.items)) {
    writeJSON(DB_FILE, []);
  }
  if (!Array.isArray(repairsRaw)) writeJSON(REPAIR_FILE, []);
  if (!Array.isArray(salesRaw)) writeJSON(SALES_FILE, []);
  if (!Array.isArray(customersRaw)) writeJSON(CUSTOMERS_FILE, []);
}
ensureLocalDB();

function getLocalDB() {
  const itemsRaw = readJSON(DB_FILE, []);
  const repairsRaw = readJSON(REPAIR_FILE, []);
  const salesRaw = readJSON(SALES_FILE, []);
  const customersRaw = readJSON(CUSTOMERS_FILE, []);

  return {
    items: Array.isArray(itemsRaw) ? itemsRaw : (Array.isArray(itemsRaw.items) ? itemsRaw.items : []),
    repairs: Array.isArray(repairsRaw) ? repairsRaw : [],
    sales: Array.isArray(salesRaw) ? salesRaw : [],
    customers: Array.isArray(customersRaw) ? customersRaw : [],
  };
}

function saveLocalDB(db) {
  writeJSON(DB_FILE, Array.isArray(db.items) ? db.items : []);
  writeJSON(REPAIR_FILE, Array.isArray(db.repairs) ? db.repairs : []);
  writeJSON(SALES_FILE, Array.isArray(db.sales) ? db.sales : []);
  writeJSON(CUSTOMERS_FILE, Array.isArray(db.customers) ? db.customers : []);
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function dayKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return nowIso().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function monthKey(value) {
  return dayKey(value).slice(0, 7);
}

function normalizeItemPayload(body = {}, oldItem = {}) {
  return {
    id: oldItem.id ?? (body.id ? Number(body.id) : newId()),
    name: cleanText(body.name ?? oldItem.name),
    barcode: cleanText(body.barcode ?? oldItem.barcode),
    category: cleanText(body.category ?? oldItem.category),
    model: cleanText(body.model ?? oldItem.model),
    year: cleanText(body.year ?? oldItem.year),
    quantity: asNumber(body.quantity ?? oldItem.quantity, 0),
    retailPrice: asNumber(body.retailPrice ?? oldItem.retailPrice, 0),
    wholesalePrice: asNumber(body.wholesalePrice ?? oldItem.wholesalePrice, 0),
    mechanicPrice: asNumber(body.mechanicPrice ?? oldItem.mechanicPrice, 0),
    costPrice: asNumber(body.costPrice ?? oldItem.costPrice, 0),
    minStock: asNumber(body.minStock ?? oldItem.minStock, 0),
    note: cleanText(body.note ?? oldItem.note),
    created_at: oldItem.created_at || oldItem.createdAt || nowIso(),
  };
}

function sanitizeItem(record = {}) {
  return {
    id: Number(record.id),
    name: cleanText(record.name),
    barcode: cleanText(record.barcode),
    category: cleanText(record.category),
    model: cleanText(record.model),
    year: cleanText(record.year),
    quantity: asNumber(record.quantity, 0),
    retailPrice: asNumber(record.retail_price ?? record.retailPrice, 0),
    wholesalePrice: asNumber(record.wholesale_price ?? record.wholesalePrice, 0),
    mechanicPrice: asNumber(record.mechanic_price ?? record.mechanicPrice, 0),
    costPrice: asNumber(record.cost_price ?? record.costPrice, 0),
    minStock: asNumber(record.min_stock ?? record.minStock, 0),
    note: cleanText(record.note),
    created_at: record.created_at || record.createdAt || null,
  };
}

function itemToDb(item) {
  return {
    id: Number(item.id),
    name: item.name,
    barcode: item.barcode,
    category: item.category,
    model: item.model,
    year: item.year,
    quantity: asNumber(item.quantity, 0),
    retail_price: asNumber(item.retailPrice, 0),
    wholesale_price: asNumber(item.wholesalePrice, 0),
    mechanic_price: asNumber(item.mechanicPrice, 0),
    cost_price: asNumber(item.costPrice, 0),
    min_stock: asNumber(item.minStock, 0),
    note: item.note,
    created_at: item.created_at || nowIso(),
  };
}

function repairPriceLabel(type) {
  if (type === 'retail') return 'ราคาปลีก';
  if (type === 'wholesale') return 'ราคาส่ง';
  return 'ราคาซ่อม';
}

function getItemPrice(item, priceType = 'retail') {
  if (priceType === 'wholesale') return asNumber(item.wholesalePrice, 0);
  if (priceType === 'mechanic') return asNumber(item.mechanicPrice || item.retailPrice, 0);
  return asNumber(item.retailPrice, 0);
}

function sanitizeRepair(record = {}) {
  const parts = Array.isArray(record.parts)
    ? record.parts
    : typeof record.parts === 'string'
      ? (() => { try { return JSON.parse(record.parts); } catch { return []; } })()
      : [];

  return {
    id: Number(record.id),
    customerName: cleanText(record.customer_name ?? record.customerName),
    phone: cleanText(record.phone),
    bikeModel: cleanText(record.bike_model ?? record.bikeModel),
    plate: cleanText(record.plate),
    repairDate: cleanText(record.repair_date ?? record.repairDate),
    symptom: cleanText(record.symptom),
    parts,
    partsUsedText: cleanText(record.parts_used_text ?? record.partsUsedText),
    repairPriceType: cleanText(record.repair_price_type ?? record.repairPriceType) || 'mechanic',
    repairPriceLabel: cleanText(record.repair_price_label ?? record.repairPriceLabel) || repairPriceLabel(record.repair_price_type ?? record.repairPriceType),
    partsCost: asNumber(record.parts_cost ?? record.partsCost, 0),
    laborCost: asNumber(record.labor_cost ?? record.laborCost, 0),
    discount: asNumber(record.discount ?? record.discount_amount, 0),
    paymentMethod: cleanText(record.payment_method ?? record.paymentMethod) || 'cash',
    totalCost: asNumber(record.total_cost ?? record.totalCost, 0),
    note: cleanText(record.note),
    created_at: record.created_at || record.createdAt || null,
  };
}

function repairToDb(repair) {
  return {
    id: Number(repair.id),
    customer_name: repair.customerName,
    phone: repair.phone,
    bike_model: repair.bikeModel,
    plate: repair.plate,
    repair_date: repair.repairDate,
    symptom: repair.symptom,
    parts: repair.parts,
    parts_used_text: repair.partsUsedText,
    repair_price_type: repair.repairPriceType,
    repair_price_label: repair.repairPriceLabel,
    parts_cost: repair.partsCost,
    labor_cost: repair.laborCost,
    discount: repair.discount || 0,
    payment_method: repair.paymentMethod || 'cash',
    total_cost: repair.totalCost,
    note: repair.note,
    created_at: repair.created_at || nowIso(),
  };
}

function sanitizeSaleRow(record = {}) {
  return {
    id: Number(record.id),
    saleId: cleanText(record.sale_id ?? record.saleId),
    itemId: Number(record.item_id ?? record.itemId),
    barcode: cleanText(record.barcode),
    name: cleanText(record.name),
    category: cleanText(record.category),
    model: cleanText(record.model),
    year: cleanText(record.year),
    qty: asNumber(record.qty, 0),
    priceType: cleanText(record.price_type ?? record.priceType) || 'retail',
    priceLabel: cleanText(record.price_label ?? record.priceLabel) || repairPriceLabel(record.price_type ?? record.priceType),
    price: asNumber(record.price, 0),
    total: asNumber(record.total, 0),
    costPrice: asNumber(record.cost_price ?? record.costPrice, 0),
    profit: asNumber(record.profit, 0),
    laborCost: asNumber(record.labor_cost ?? record.laborCost, 0),
    discount: asNumber(record.discount ?? record.discount_amount, 0),
    itemsTotal: asNumber(record.items_total ?? record.itemsTotal, 0),
    grandTotal: asNumber(record.grand_total ?? record.grandTotal, 0),
    customerName: cleanText(record.customer_name ?? record.customerName),
    paymentMethod: cleanText(record.payment_method ?? record.paymentMethod) || 'cash',
    paid: asNumber(record.paid, 0),
    change: asNumber(record.change, 0),
    created_at: record.created_at || record.createdAt || null,
  };
}


function sanitizeCustomer(record = {}) {
  return {
    id: Number(record.id),
    name: cleanText(record.name),
    phone: cleanText(record.phone),
    note: cleanText(record.note),
    created_at: record.created_at || record.createdAt || null,
  };
}

function customerToDb(customer) {
  return {
    id: Number(customer.id),
    name: customer.name,
    phone: customer.phone,
    note: customer.note,
    created_at: customer.created_at || nowIso(),
  };
}

function saleToDb(sale) {
  return {
    id: Number(sale.id),
    sale_id: sale.saleId,
    item_id: Number(sale.itemId),
    barcode: sale.barcode,
    name: sale.name,
    category: sale.category,
    model: sale.model,
    year: sale.year,
    qty: sale.qty,
    price_type: sale.priceType,
    price_label: sale.priceLabel,
    price: sale.price,
    total: sale.total,
    cost_price: sale.costPrice,
    profit: sale.profit,
    labor_cost: sale.laborCost,
    discount: sale.discount || 0,
    items_total: sale.itemsTotal,
    grand_total: sale.grandTotal,
    customer_name: sale.customerName,
    payment_method: sale.paymentMethod || 'cash',
    paid: sale.paid,
    change: sale.change,
    created_at: sale.created_at || nowIso(),
  };
}

function makeRepairFromPayload(body, itemMap) {
  const rawRepairType = cleanText(body.repairPriceType) || 'mechanic';
  const priceType = rawRepairType === 'wholesale' ? 'mechanic' : rawRepairType;
  const partsInput = Array.isArray(body.parts) ? body.parts : [];
  const parts = [];
  let partsCost = 0;

  for (const raw of partsInput) {
    const itemId = Number(raw.id);
    const qty = asNumber(raw.qty, 0);
    const item = itemMap.get(itemId);

    if (!item) throw new Error('พบอะไหล่ที่ไม่มีในสต๊อก');
    if (qty <= 0) throw new Error('จำนวนอะไหล่ไม่ถูกต้อง');

    const unitPrice = asNumber(raw.unitPrice, getItemPrice(item, raw.priceType || priceType));
    const total = asNumber(raw.total, unitPrice * qty);
    const priceTypeRow = cleanText(raw.priceType) || priceType;

    parts.push({
      id: Number(item.id),
      barcode: item.barcode || '',
      name: item.name || '',
      qty,
      unitPrice,
      total,
      priceType: priceTypeRow,
      priceLabel: cleanText(raw.priceLabel) || repairPriceLabel(priceTypeRow),
    });

    partsCost += total;
  }

  const laborCost = asNumber(body.laborCost, 0);
  const discount = Math.max(0, Math.min(asNumber(body.discount, 0), partsCost + laborCost));
  return {
    id: body.id ? Number(body.id) : newId(),
    customerName: cleanText(body.customerName),
    phone: cleanText(body.phone),
    bikeModel: cleanText(body.bikeModel),
    plate: cleanText(body.plate),
    repairDate: cleanText(body.repairDate) || dayKey(),
    symptom: cleanText(body.symptom),
    parts,
    partsUsedText: parts.map((p) => `${p.name} x${p.qty}`).join(', '),
    repairPriceType: priceType,
    repairPriceLabel: priceType === 'mechanic' ? 'ราคาซ่อม' : repairPriceLabel(priceType),
    partsCost,
    laborCost,
    discount,
    paymentMethod: cleanText(body.paymentMethod) || 'cash',
    totalCost: Math.max(0, partsCost + laborCost - discount),
    note: cleanText(body.note),
    created_at: cleanText(body.created_at) || nowIso(),
  };
}

function aggregateBills(salesRows = []) {
  const map = new Map();
  for (const row of salesRows.map(sanitizeSaleRow)) {
    if (!map.has(row.saleId)) {
      map.set(row.saleId, {
        saleId: row.saleId,
        createdAt: row.created_at,
        customerName: row.customerName,
        paymentMethod: row.paymentMethod || 'cash',
        laborCost: row.laborCost,
        itemsTotal: row.itemsTotal,
        grandTotal: row.grandTotal,
        discount: row.discount || 0,
        paid: row.paid,
        change: row.change,
        items: [],
      });
    }
    const bill = map.get(row.saleId);
    bill.items.push({
      id: row.itemId,
      barcode: row.barcode,
      name: row.name,
      qty: row.qty,
      price: row.price,
      total: row.total,
      priceType: row.priceType,
      priceLabel: row.priceLabel,
    });
  }
  return Array.from(map.values()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getItems() {
  if (supabase) {
    const { data, error } = await supabase.from('items').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(sanitizeItem);
  }
  return getLocalDB().items.map(sanitizeItem).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function getRepairs() {
  if (supabase) {
    const { data, error } = await supabase.from('repairs').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(sanitizeRepair);
  }
  return getLocalDB().repairs.map(sanitizeRepair).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function getSalesRows() {
  if (supabase) {
    const { data, error } = await supabase.from('sales').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(sanitizeSaleRow);
  }
  return getLocalDB().sales.map(sanitizeSaleRow).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function getCustomers() {
  if (supabase) {
    const { data, error } = await supabase.from('customers').select('*').order('name', { ascending: true });
    if (!error) return (data || []).map(sanitizeCustomer);
    const message = String(error.message || '').toLowerCase();
    if (String(error.code) !== '42P01' && !message.includes('customers')) {
      throw error;
    }
  }
  return getLocalDB().customers.map(sanitizeCustomer).sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
}

async function saveCustomer(customer) {
  if (supabase) {
    const { data, error } = await supabase.from('customers').upsert([customerToDb(customer)], { onConflict: 'id' }).select('*').single();
    if (!error) return sanitizeCustomer(data);
    const message = String(error.message || '').toLowerCase();
    if (String(error.code) !== '42P01' && !message.includes('customers')) {
      throw error;
    }
  }
  const db = getLocalDB();
  db.customers = Array.isArray(db.customers) ? db.customers : [];
  const idx = db.customers.findIndex((row) => Number(row.id) === Number(customer.id));
  if (idx >= 0) db.customers[idx] = customer;
  else db.customers.unshift(customer);
  saveLocalDB(db);
  return sanitizeCustomer(customer);
}

async function deleteCustomerById(customerId) {
  if (supabase) {
    const { error } = await supabase.from('customers').delete().eq('id', customerId);
    if (!error) return;
    const message = String(error.message || '').toLowerCase();
    if (String(error.code) !== '42P01' && !message.includes('customers')) {
      throw error;
    }
  }
  const db = getLocalDB();
  db.customers = (db.customers || []).filter((row) => Number(row.id) !== Number(customerId));
  saveLocalDB(db);
}


async function setItemQuantity(itemId, nextQty) {
  if (supabase) {
    const { data, error } = await supabase
      .from('items')
      .update({ quantity: nextQty })
      .eq('id', itemId)
      .select('*')
      .single();
    if (error) throw error;
    return sanitizeItem(data);
  }
  const db = getLocalDB();
  const idx = db.items.findIndex((item) => Number(item.id) === Number(itemId));
  if (idx === -1) throw new Error('ไม่พบสินค้า');
  db.items[idx].quantity = nextQty;
  saveLocalDB(db);
  return sanitizeItem(db.items[idx]);
}

async function findItemById(itemId) {
  const items = await getItems();
  return items.find((item) => Number(item.id) === Number(itemId)) || null;
}

async function findItemByBarcode(barcode) {
  const code = cleanText(barcode);
  const items = await getItems();
  return items.find((item) => cleanText(item.barcode) === code) || null;
}

// health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: supabase ? 'supabase' : 'json' });
});

// auth
app.get('/api/auth/me', (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user) {
    return res.status(401).json({ success: false, message: 'ยังไม่ได้เข้าสู่ระบบ' });
  }
  return res.json({ success: true, user: session.user });
});

app.post('/api/auth/login', (req, res) => {
  const username = cleanText(req.body?.username);
  const password = cleanText(req.body?.password);

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  const admin = findAuthenticatedAdmin(username, password);
  if (admin) {
    const user = { username: admin.username, role: 'admin' };
    const sid = createSession(req, res, user);
    const session = sessions.get(sid);
    if (session) {
      session.logId = appendLoginLog({
        username: user.username,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        userAgent: req.headers['user-agent'] || '',
      });
      sessions.set(sid, session);
    }
    return res.json({ success: true, redirectTo: '/admin.html', user });
  }

  return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
});

app.post('/api/logout', (req, res) => {
  const session = getSessionFromRequest(req);
  if (session?.sid) {
    markLogoutLog(session.logId);
    sessions.delete(session.sid);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

app.use('/api', (req, res, next) => {
  const publicPaths = new Set(['/api/health', '/api/auth/login', '/api/auth/me', '/api/logout']);
  if (publicPaths.has(req.path)) return next();
  return requireApiAuth(req, res, next);
});

// items
app.get('/api/items', async (req, res) => {
  try {
    const items = await getItems();
    res.json(
      items.map((item) => ({
        ...item,
        retailPrice: asNumber(item.retailPrice ?? item.retail_price, 0),
        wholesalePrice: asNumber(item.wholesalePrice ?? item.wholesale_price, 0),
        mechanicPrice: asNumber(item.mechanicPrice ?? item.mechanic_price, 0),
        costPrice: asNumber(item.costPrice ?? item.cost_price, 0),
        minStock: asNumber(item.minStock ?? item.min_stock, 0),
      }))
    );
  } catch (error) {
    console.error('GET /api/items', error);
    res.status(500).json({ success: false, message: error.message || 'โหลดสินค้าไม่สำเร็จ' });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const payload = normalizeItemPayload(req.body);
    if (!payload.name) return res.status(400).json({ success: false, message: 'กรุณาใส่ชื่อสินค้า' });

    if (payload.barcode) {
      const existing = await findItemByBarcode(payload.barcode);
      if (existing) return res.status(400).json({ success: false, message: 'บาร์โค้ดนี้มีอยู่แล้วในระบบ' });
    }

    if (supabase) {
      const { data, error } = await supabase.from('items').insert([itemToDb(payload)]).select('*').single();
      if (error) throw error;
      return res.json({ success: true, item: sanitizeItem(data) });
    }

    const db = getLocalDB();
    db.items.unshift(payload);
    saveLocalDB(db);
    res.json({ success: true, item: sanitizeItem(payload) });
  } catch (error) {
    console.error('POST /api/items', error);
    res.status(500).json({ success: false, message: error.message || 'บันทึกสินค้าไม่สำเร็จ' });
  }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const current = await findItemById(itemId);
    if (!current) return res.status(404).json({ success: false, message: 'ไม่พบสินค้า' });

    const payload = normalizeItemPayload(req.body, current);
    if (!payload.name) return res.status(400).json({ success: false, message: 'กรุณาใส่ชื่อสินค้า' });

    if (payload.barcode) {
      const existing = await findItemByBarcode(payload.barcode);
      if (existing && Number(existing.id) !== itemId) {
        return res.status(400).json({ success: false, message: 'บาร์โค้ดนี้มีอยู่แล้วในระบบ' });
      }
    }

    if (supabase) {
      const { data, error } = await supabase.from('items').update(itemToDb(payload)).eq('id', itemId).select('*').single();
      if (error) throw error;
      return res.json({ success: true, item: sanitizeItem(data) });
    }

    const db = getLocalDB();
    const idx = db.items.findIndex((item) => Number(item.id) === itemId);
    db.items[idx] = payload;
    saveLocalDB(db);
    res.json({ success: true, item: sanitizeItem(payload) });
  } catch (error) {
    console.error('PUT /api/items/:id', error);
    res.status(500).json({ success: false, message: error.message || 'แก้ไขสินค้าไม่สำเร็จ' });
  }
});

app.patch('/api/items/:id/stock', async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const change = asNumber(req.body?.change, 0);
    if (!itemId) return res.status(400).json({ success: false, message: 'ไม่พบรหัสสินค้า' });
    if (!change) return res.status(400).json({ success: false, message: 'จำนวนไม่ถูกต้อง' });

    const current = await findItemById(itemId);
    if (!current) return res.status(404).json({ success: false, message: 'ไม่พบสินค้า' });

    const nextQty = asNumber(current.quantity, 0) + change;
    if (nextQty < 0) return res.status(400).json({ success: false, message: 'จำนวนคงเหลือไม่พอ' });

    const item = await setItemQuantity(itemId, nextQty);
    res.json({ success: true, item });
  } catch (error) {
    console.error('PATCH /api/items/:id/stock', error);
    res.status(500).json({ success: false, message: error.message || 'ปรับสต๊อกไม่สำเร็จ' });
  }
});

app.post('/api/items/stock-by-barcode', async (req, res) => {
  try {
    const barcode = cleanText(req.body?.barcode);
    const qty = asNumber(req.body?.qty, 0);
    if (!barcode) return res.status(400).json({ success: false, message: 'กรุณายิงหรือกรอกบาร์โค้ด' });
    if (qty <= 0) return res.status(400).json({ success: false, message: 'จำนวนต้องมากกว่า 0' });

    const item = await findItemByBarcode(barcode);
    if (!item) return res.status(404).json({ success: false, message: 'ไม่พบบาร์โค้ดนี้ในระบบ' });

    const updated = await setItemQuantity(item.id, asNumber(item.quantity, 0) + qty);
    res.json({ success: true, item: updated, message: 'เติมสต๊อกเรียบร้อย' });
  } catch (error) {
    console.error('POST /api/items/stock-by-barcode', error);
    res.status(500).json({ success: false, message: error.message || 'เติมสต๊อกไม่สำเร็จ' });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    if (!itemId) return res.status(400).json({ success: false, message: 'ไม่พบรหัสสินค้า' });

    if (supabase) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) throw error;
      return res.json({ success: true, message: 'ลบสินค้าเรียบร้อย' });
    }

    const db = getLocalDB();
    db.items = db.items.filter((item) => Number(item.id) !== itemId);
    saveLocalDB(db);
    res.json({ success: true, message: 'ลบสินค้าเรียบร้อย' });
  } catch (error) {
    console.error('DELETE /api/items/:id', error);
    res.status(500).json({ success: false, message: error.message || 'ลบสินค้าไม่สำเร็จ' });
  }
});


// customers
app.get('/api/customers', async (req, res) => {
  try {
    const q = cleanText(req.query.q).toLowerCase();
    let customers = await getCustomers();
    if (q) {
      customers = customers.filter((customer) => [customer.name, customer.phone, customer.note].join(' ').toLowerCase().includes(q));
    }
    res.json(customers);
  } catch (error) {
    console.error('GET /api/customers', error);
    res.status(500).json({ success: false, message: error.message || 'โหลดรายชื่อลูกค้าไม่สำเร็จ' });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const customer = {
      id: req.body?.id ? Number(req.body.id) : newId(),
      name: cleanText(req.body?.name),
      phone: cleanText(req.body?.phone),
      note: cleanText(req.body?.note),
      created_at: cleanText(req.body?.created_at) || nowIso(),
    };

    if (!customer.name) {
      return res.status(400).json({ success: false, message: 'กรุณาใส่ชื่อลูกค้า' });
    }

    const existing = (await getCustomers()).find((row) =>
      cleanText(row.name).toLowerCase() === customer.name.toLowerCase() &&
      cleanText(row.phone).toLowerCase() === customer.phone.toLowerCase()
    );
    if (existing && Number(existing.id) !== Number(customer.id)) {
      return res.status(400).json({ success: false, message: 'มีชื่อลูกค้านี้อยู่แล้ว' });
    }

    const saved = await saveCustomer(customer);
    res.json({ success: true, customer: saved });
  } catch (error) {
    console.error('POST /api/customers', error);
    res.status(500).json({ success: false, message: error.message || 'บันทึกลูกค้าไม่สำเร็จ' });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'ไม่พบรหัสลูกค้า' });
    }
    await deleteCustomerById(customerId);
    res.json({ success: true, message: 'ลบลูกค้าเรียบร้อย' });
  } catch (error) {
    console.error('DELETE /api/customers/:id', error);
    res.status(500).json({ success: false, message: error.message || 'ลบลูกค้าไม่สำเร็จ' });
  }
});

// repairs
app.get('/api/repairs', async (req, res) => {
  try {
    const q = cleanText(req.query.q).toLowerCase();
    let repairs = await getRepairs();
    if (q) {
      repairs = repairs.filter((repair) => [
        repair.customerName,
        repair.phone,
        repair.bikeModel,
        repair.plate,
        repair.repairDate,
        repair.symptom,
        repair.note,
        repair.partsUsedText,
      ].join(' ').toLowerCase().includes(q));
    }
    res.json(repairs);
  } catch (error) {
    console.error('GET /api/repairs', error);
    res.status(500).json({ success: false, message: error.message || 'โหลดประวัติการซ่อมไม่สำเร็จ' });
  }
});

async function applyRepairStockDelta(previousRepair, nextRepair) {
  const items = await getItems();
  const map = new Map(items.map((item) => [Number(item.id), item]));
  const delta = new Map();

  for (const p of Array.isArray(previousRepair?.parts) ? previousRepair.parts : []) {
    const id = Number(p.id);
    delta.set(id, (delta.get(id) || 0) + asNumber(p.qty, 0));
  }
  for (const p of Array.isArray(nextRepair?.parts) ? nextRepair.parts : []) {
    const id = Number(p.id);
    delta.set(id, (delta.get(id) || 0) - asNumber(p.qty, 0));
  }

  for (const [itemId, diff] of delta.entries()) {
    const item = map.get(itemId);
    if (!item) throw new Error('พบอะไหล่ที่ไม่มีในสต๊อก');
    const nextQty = asNumber(item.quantity, 0) + diff;
    if (nextQty < 0) throw new Error(`อะไหล่ ${item.name} มีไม่พอ`);
  }

  for (const [itemId, diff] of delta.entries()) {
    if (diff !== 0) {
      const item = map.get(itemId);
      await setItemQuantity(itemId, asNumber(item.quantity, 0) + diff);
      item.quantity = asNumber(item.quantity, 0) + diff;
    }
  }
}

app.post('/api/repairs', async (req, res) => {
  try {
    const items = await getItems();
    const itemMap = new Map(items.map((item) => [Number(item.id), item]));
    const repair = makeRepairFromPayload(req.body, itemMap);
    if (!repair.customerName) return res.status(400).json({ success: false, message: 'กรุณาใส่ชื่อลูกค้า' });
    await applyRepairStockDelta(null, repair);

    if (supabase) {
      const { data, error } = await supabase.from('repairs').insert([repairToDb(repair)]).select('*').single();
      if (error) throw error;
      return res.json({ success: true, repair: sanitizeRepair(data) });
    }

    const db = getLocalDB();
    db.repairs.unshift(repair);
    saveLocalDB(db);
    res.json({ success: true, repair });
  } catch (error) {
    console.error('POST /api/repairs', error);
    res.status(500).json({ success: false, message: error.message || 'บันทึกประวัติการซ่อมไม่สำเร็จ' });
  }
});

app.put('/api/repairs/:id', async (req, res) => {
  try {
    const repairId = Number(req.params.id);
    const repairs = await getRepairs();
    const current = repairs.find((repair) => Number(repair.id) === repairId);
    if (!current) return res.status(404).json({ success: false, message: 'ไม่พบประวัติการซ่อม' });

    const items = await getItems();
    const itemMap = new Map(items.map((item) => [Number(item.id), item]));
    const nextRepair = makeRepairFromPayload({ ...req.body, id: repairId, created_at: current.created_at }, itemMap);
    await applyRepairStockDelta(current, nextRepair);

    if (supabase) {
      const { data, error } = await supabase.from('repairs').update(repairToDb(nextRepair)).eq('id', repairId).select('*').single();
      if (error) throw error;
      return res.json({ success: true, repair: sanitizeRepair(data) });
    }

    const db = getLocalDB();
    const idx = db.repairs.findIndex((repair) => Number(repair.id) === repairId);
    db.repairs[idx] = nextRepair;
    saveLocalDB(db);
    res.json({ success: true, repair: nextRepair });
  } catch (error) {
    console.error('PUT /api/repairs/:id', error);
    res.status(500).json({ success: false, message: error.message || 'แก้ไขประวัติการซ่อมไม่สำเร็จ' });
  }
});

app.delete('/api/repairs/:id', async (req, res) => {
  try {
    const repairId = Number(req.params.id);
    const repairs = await getRepairs();
    const current = repairs.find((repair) => Number(repair.id) === repairId);
    if (!current) return res.status(404).json({ success: false, message: 'ไม่พบประวัติการซ่อม' });

    await applyRepairStockDelta(current, null);

    if (supabase) {
      const { error } = await supabase.from('repairs').delete().eq('id', repairId);
      if (error) throw error;
      return res.json({ success: true, message: 'ลบประวัติการซ่อมเรียบร้อย' });
    }

    const db = getLocalDB();
    db.repairs = db.repairs.filter((repair) => Number(repair.id) !== repairId);
    saveLocalDB(db);
    res.json({ success: true, message: 'ลบประวัติการซ่อมเรียบร้อย' });
  } catch (error) {
    console.error('DELETE /api/repairs/:id', error);
    res.status(500).json({ success: false, message: error.message || 'ลบประวัติการซ่อมไม่สำเร็จ' });
  }
});

// checkout / sales / report
app.post('/api/checkout', async (req, res) => {
  try {
    const items = await getItems();
    const itemMap = new Map(items.map((item) => [Number(item.id), item]));
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!list.length) return res.status(400).json({ success: false, message: 'ยังไม่มีสินค้าในตะกร้า' });

    const customerName = cleanText(req.body?.customerName);
    const laborCost = asNumber(req.body?.laborCost, 0);
    const discount = asNumber(req.body?.discount, 0);
    const paymentMethod = cleanText(req.body?.paymentMethod) || 'cash';
    const paid = asNumber(req.body?.paid, 0);
    const saleId = `S${Date.now()}`;
    const createdAt = nowIso();
    const saleRows = [];
    let itemsTotal = 0;

    for (const raw of list) {
      const itemId = Number(raw.id);
      const qty = asNumber(raw.qty, 0);
      const item = itemMap.get(itemId);
      if (!item) throw new Error('พบสินค้าที่ไม่มีในระบบ');
      if (qty <= 0) throw new Error('จำนวนสินค้าไม่ถูกต้อง');
      if (asNumber(item.quantity, 0) < qty) throw new Error(`สินค้า ${item.name} มีไม่พอ`);

      const priceType = cleanText(raw.priceType) || 'retail';
      const price = asNumber(raw.price, getItemPrice(item, priceType));
      const total = price * qty;
      const costPrice = asNumber(item.costPrice, 0);
      const profit = total - costPrice * qty;
      itemsTotal += total;

      saleRows.push({
        id: newId(),
        saleId,
        itemId: Number(item.id),
        barcode: item.barcode || '',
        name: item.name || '',
        category: item.category || '',
        model: item.model || '',
        year: item.year || '',
        qty,
        priceType,
        priceLabel: cleanText(raw.priceLabel) || repairPriceLabel(priceType),
        price,
        total,
        costPrice,
        profit,
        laborCost,
        discount: 0,
        itemsTotal: 0,
        grandTotal: 0,
        customerName,
        paid,
        change: 0,
        created_at: createdAt,
      });
    }

    const appliedDiscount = Math.max(0, Math.min(discount, itemsTotal + laborCost));
    const grandTotal = Math.max(0, itemsTotal + laborCost - appliedDiscount);
    const change = paid - grandTotal;
    if (paid < grandTotal) return res.status(400).json({ success: false, message: 'จำนวนเงินที่รับมาไม่พอ' });

    for (const row of saleRows) {
      row.itemsTotal = itemsTotal;
      row.discount = appliedDiscount;
      row.grandTotal = grandTotal;
      row.change = change;
    }

    for (const row of saleRows) {
      const item = itemMap.get(Number(row.itemId));
      const nextQty = asNumber(item.quantity, 0) - row.qty;
      await setItemQuantity(item.id, nextQty);
      item.quantity = nextQty;
    }

    if (supabase) {
      const { error } = await supabase.from('sales').insert(saleRows.map(saleToDb));
      if (error) throw error;
    } else {
      const db = getLocalDB();
      db.sales.unshift(...saleRows);
      saveLocalDB(db);
    }

    res.json({
      success: true,
      receipt: {
        saleId,
        id: saleId,
        date: createdAt,
        customerName,
        paymentMethod,
        items: saleRows.map((row) => ({
          id: row.itemId,
          barcode: row.barcode,
          name: row.name,
          qty: row.qty,
          price: row.price,
          total: row.total,
          priceType: row.priceType,
          priceLabel: row.priceLabel,
        })),
        laborCost,
        discount: appliedDiscount,
        total: grandTotal,
        paid,
        change,
      },
    });
  } catch (error) {
    console.error('POST /api/checkout', error);
    res.status(500).json({ success: false, message: error.message || 'คิดเงินไม่สำเร็จ' });
  }
});

app.get('/api/sales', async (req, res) => {
  try {
    const rows = await getSalesRows();
    res.json(rows);
  } catch (error) {
    console.error('GET /api/sales', error);
    res.status(500).json({ success: false, message: error.message || 'โหลดข้อมูลการขายไม่สำเร็จ' });
  }
});
app.get('/api/sales/:saleId', async (req, res) => {
  try {
    const saleId = cleanText(req.params.saleId);
    if (!saleId) {
      return res.status(400).json({ success: false, message: 'ไม่พบเลขที่บิล' });
    }

    const rows = await getSalesRows();
    const bill = aggregateBills(rows).find((b) => b.saleId === saleId);

    if (!bill) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิลที่ต้องการ' });
    }

    return res.json({ success: true, bill });
  } catch (error) {
    console.error('GET /api/sales/:saleId', error);
    return res.status(500).json({ success: false, message: error.message || 'โหลดบิลไม่สำเร็จ' });
  }
});

app.delete('/api/sales/:saleId', async (req, res) => {
  try {
    const saleId = cleanText(req.params.saleId);
    if (!saleId) {
      return res.status(400).json({ success: false, message: 'ไม่พบเลขที่บิล' });
    }

    const rows = await getSalesRows();
    const targetRows = rows.filter((row) => cleanText(row.saleId) === saleId);

    if (!targetRows.length) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิลที่ต้องการลบ' });
    }

    const items = await getItems();
    const itemMap = new Map(items.map((item) => [Number(item.id), item]));

    // คืนสต๊อกก่อนลบบิล
    for (const row of targetRows) {
      const item = itemMap.get(Number(row.itemId));
      if (!item) continue;
      const nextQty = asNumber(item.quantity, 0) + asNumber(row.qty, 0);
      await setItemQuantity(item.id, nextQty);
      item.quantity = nextQty;
    }

    if (supabase) {
      const { error } = await supabase.from('sales').delete().eq('sale_id', saleId);
      if (error) throw error;
    } else {
      const db = getLocalDB();
      db.sales = (db.sales || []).filter((row) => cleanText(row.saleId) !== saleId);
      saveLocalDB(db);
    }

    return res.json({
      success: true,
      message: 'ลบบิลเรียบร้อย และคืนสต๊อกแล้ว'
    });
  } catch (error) {
    console.error('DELETE /api/sales/:saleId', error);
    return res.status(500).json({ success: false, message: error.message || 'ลบบิลไม่สำเร็จ' });
  }
});

app.post('/api/sales/:saleId/duplicate', async (req, res) => {
  try {
    const saleId = cleanText(req.params.saleId);
    if (!saleId) {
      return res.status(400).json({ success: false, message: 'ไม่พบเลขที่บิล' });
    }

    const rows = await getSalesRows();
    const bill = aggregateBills(rows).find((b) => b.saleId === saleId);

    if (!bill) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิลที่ต้องการทำซ้ำ' });
    }

    return res.json({
      success: true,
      draft: {
        saleId,
        customerName: bill.customerName || '',
        paymentMethod: cleanText(bill.paymentMethod) || 'cash',
        laborCost: asNumber(bill.laborCost, 0),
        paid: 0,
        items: (bill.items || []).map((item) => ({
          id: Number(item.id),
          qty: asNumber(item.qty, 0),
          price: asNumber(item.price, 0),
          total: asNumber(item.total, 0),
          priceType: cleanText(item.priceType) || 'retail',
          priceLabel: cleanText(item.priceLabel)
        }))
      }
    });
  } catch (error) {
    console.error('POST /api/sales/:saleId/duplicate', error);
    return res.status(500).json({ success: false, message: error.message || 'ทำซ้ำบิลไม่สำเร็จ' });
  }
});

app.put('/api/sales/:saleId', async (req, res) => {
  try {
    const saleId = cleanText(req.params.saleId);
    if (!saleId) {
      return res.status(400).json({ success: false, message: 'ไม่พบเลขที่บิล' });
    }

    const oldRows = (await getSalesRows()).filter((row) => cleanText(row.saleId) === saleId);
    if (!oldRows.length) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิลที่ต้องการแก้ไข' });
    }

    const itemsBefore = await getItems();
    const itemMapBefore = new Map(itemsBefore.map((item) => [Number(item.id), item]));

    // คืนสต๊อกของบิลเดิมก่อน
    for (const row of oldRows) {
      const item = itemMapBefore.get(Number(row.itemId));
      if (!item) continue;
      const nextQty = asNumber(item.quantity, 0) + asNumber(row.qty, 0);
      await setItemQuantity(item.id, nextQty);
      item.quantity = nextQty;
    }

    // ลบแถวเดิม
    if (supabase) {
      const { error: deleteError } = await supabase.from('sales').delete().eq('sale_id', saleId);
      if (deleteError) throw deleteError;
    } else {
      const db = getLocalDB();
      db.sales = (db.sales || []).filter((row) => cleanText(row.saleId) !== saleId);
      saveLocalDB(db);
    }

    const items = await getItems();
    const itemMap = new Map(items.map((item) => [Number(item.id), item]));
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!list.length) {
      return res.status(400).json({ success: false, message: 'ยังไม่มีสินค้าในตะกร้า' });
    }

    const customerName = cleanText(req.body?.customerName);
    const laborCost = asNumber(req.body?.laborCost, 0);
    const discount = asNumber(req.body?.discount, asNumber(oldRows[0]?.discount, 0));
    const paymentMethod = cleanText(req.body?.paymentMethod) || cleanText(oldRows[0]?.paymentMethod) || 'cash';
    const paid = asNumber(req.body?.paid, 0);
    const createdAt = cleanText(req.body?.createdAt) || oldRows[0]?.created_at || nowIso();
    const saleRows = [];
    let itemsTotal = 0;

    for (const raw of list) {
      const itemId = Number(raw.id);
      const qty = asNumber(raw.qty, 0);
      const item = itemMap.get(itemId);

      if (!item) throw new Error('พบสินค้าที่ไม่มีในระบบ');
      if (qty <= 0) throw new Error('จำนวนสินค้าไม่ถูกต้อง');
      if (asNumber(item.quantity, 0) < qty) throw new Error(`สินค้า ${item.name} มีไม่พอ`);

      const priceType = cleanText(raw.priceType) || 'retail';
      const price = asNumber(raw.price, getItemPrice(item, priceType));
      const total = price * qty;
      const costPrice = asNumber(item.costPrice, 0);
      const profit = total - costPrice * qty;
      itemsTotal += total;

      saleRows.push({
        id: newId(),
        saleId,
        itemId: Number(item.id),
        barcode: item.barcode || '',
        name: item.name || '',
        category: item.category || '',
        model: item.model || '',
        year: item.year || '',
        qty,
        priceType,
        priceLabel: cleanText(raw.priceLabel) || repairPriceLabel(priceType),
        price,
        total,
        costPrice,
        profit,
        laborCost,
        discount: 0,
        itemsTotal: 0,
        grandTotal: 0,
        customerName,
        paymentMethod,
        paid,
        change: 0,
        created_at: createdAt
      });
    }

    const appliedDiscount = Math.max(0, Math.min(discount, itemsTotal + laborCost));
    const grandTotal = Math.max(0, itemsTotal + laborCost - appliedDiscount);
    const change = paid - grandTotal;
    if (paid < grandTotal) {
      return res.status(400).json({ success: false, message: 'จำนวนเงินที่รับมาไม่พอ' });
    }

    for (const row of saleRows) {
      row.itemsTotal = itemsTotal;
      row.discount = appliedDiscount;
      row.grandTotal = grandTotal;
      row.change = change;
    }

    for (const row of saleRows) {
      const item = itemMap.get(Number(row.itemId));
      const nextQty = asNumber(item.quantity, 0) - row.qty;
      await setItemQuantity(item.id, nextQty);
      item.quantity = nextQty;
    }

    if (supabase) {
      const { error } = await supabase.from('sales').insert(saleRows.map(saleToDb));
      if (error) throw error;
    } else {
      const db = getLocalDB();
      db.sales = Array.isArray(db.sales) ? db.sales : [];
      db.sales.unshift(...saleRows);
      saveLocalDB(db);
    }

    return res.json({
      success: true,
      receipt: {
        saleId,
        id: saleId,
        date: createdAt,
        customerName,
        paymentMethod,
        items: saleRows.map((row) => ({
          id: row.itemId,
          barcode: row.barcode,
          name: row.name,
          qty: row.qty,
          price: row.price,
          total: row.total,
          priceType: row.priceType,
          priceLabel: row.priceLabel
        })),
        laborCost,
        discount: appliedDiscount,
        total: grandTotal,
        paid,
        change
      }
    });
  } catch (error) {
    console.error('PUT /api/sales/:saleId', error);
    return res.status(500).json({ success: false, message: error.message || 'แก้ไขบิลไม่สำเร็จ' });
  }
});

app.get('/api/report', async (req, res) => {
  try {
    const startDate = cleanText(req.query.startDate);
    const endDate = cleanText(req.query.endDate);
    const salesRows = await getSalesRows();
    const repairs = await getRepairs();
    const items = await getItems();
    const bills = aggregateBills(salesRows);

    const inRange = (iso) => {
      const day = dayKey(iso);
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    };

    const today = dayKey();
    const month = monthKey();
    const rowsInRange = salesRows.filter((row) => inRange(row.created_at));
    const billsInRange = bills.filter((bill) => inRange(bill.createdAt));
    const repairsInRange = repairs.filter((repair) => inRange(repair.created_at || repair.repairDate));

    const todaySales = aggregateBills(salesRows.filter((row) => dayKey(row.created_at) === today)).reduce((sum, bill) => sum + asNumber(bill.grandTotal, 0), 0);
    const monthSales = aggregateBills(salesRows.filter((row) => monthKey(row.created_at) === month)).reduce((sum, bill) => sum + asNumber(bill.grandTotal, 0), 0);
    const rangeSales = billsInRange.reduce((sum, bill) => sum + asNumber(bill.grandTotal, 0), 0);
    const laborTotal = billsInRange.reduce((sum, bill) => sum + asNumber(bill.laborCost, 0), 0);
    const profitTotal = rowsInRange.reduce((sum, row) => sum + asNumber(row.profit, 0), 0);

    const itemProfitMap = new Map();
    for (const row of rowsInRange) {
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
      const cur = itemProfitMap.get(key);
      cur.qty += asNumber(row.qty, 0);
      cur.sales += asNumber(row.total, 0);
      cur.cost += asNumber(row.costPrice, 0) * asNumber(row.qty, 0);
      cur.profit += asNumber(row.profit, 0);
    }

    const lowStock = items
      .filter((item) => asNumber(item.quantity, 0) <= asNumber(item.minStock, 0))
      .sort((a, b) => asNumber(a.quantity, 0) - asNumber(b.quantity, 0));

    res.json({
      success: true,
      summary: {
        todaySales,
        monthSales,
        rangeSales,
        laborTotal,
        billCount: billsInRange.length,
        profitTotal,
        salesIncome: rangeSales,
        repairIncome: repairsInRange.reduce((sum, repair) => sum + asNumber(repair.totalCost, 0), 0),
      },
      itemProfits: Array.from(itemProfitMap.values()).sort((a, b) => b.profit - a.profit),
      lowStock,
      bills: billsInRange,
      repairs: repairsInRange,
    });
  } catch (error) {
    console.error('GET /api/report', error);
    res.status(500).json({ success: false, message: error.message || 'โหลดรายงานไม่สำเร็จ' });
  }
});

// static pages
app.get('/', (req, res) => {
  const session = getSessionFromRequest(req);
  return res.redirect(session?.user ? '/admin.html' : '/login.html');
});

app.get('/login.html', (req, res) => {
  const session = getSessionFromRequest(req);
  if (session?.user) return res.redirect('/admin.html');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/admin.html', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/pos.html', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pos.html')));
app.get('/repair-history.html', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'repair-history.html')));
app.get('/report.html', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'report.html')));
app.get('/print.html', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'print.html')));

app.use(express.static(PUBLIC_DIR, { index: false, redirect: false }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Data provider: ${supabase ? 'Supabase' : 'JSON file'}`);
});
