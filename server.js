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
app.use(express.static(path.join(ROOT, 'public')));


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
    const payload = {
        u: ADMIN_USERNAME,
        exp: Date.now() + SESSION_TTL_MS
    };
    const base = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${base}.${signValue(base)}`;
}

function readSession(req) {
    const cookies = parseCookies(req);
    const raw = cookies[SESSION_COOKIE];
    if (!raw || !raw.includes('.')) return null;
    const [base, sig] = raw.split('.');
    if (!base || !sig) return null;
    if (signValue(base) !== sig) return null;
    try {
        const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'));
        if (!payload || payload.u !== ADMIN_USERNAME || Number(payload.exp || 0) < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

function setSessionCookie(res) {
    const value = createSessionValue();
    const secure = process.env.NODE_ENV === 'production';
    const parts = [
        `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
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
        || pathname === '/logo.jpg'
        || pathname === '/';
}

function requireAuth(req, res, next) {
    if (isPublicPath(req.path)) {
        if (req.path === '/' && readSession(req)) return res.redirect('/pos.html');
        if (req.path === '/') return res.redirect('/login.html');
        return next();
    }

    const session = readSession(req);
    if (session) return next();

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบก่อน' });
    }

    return res.redirect('/login.html');
}

function ensureJsonFiles() {
    for (const [file, fallback] of [[DB_FILE, []], [SALES_FILE, []], [REPAIR_FILE, []]]) {
        if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
    }
}

function loadJsonFile(file, fallback = []) {
    try {
        if (!fs.existsSync(file)) return fallback;
        const text = fs.readFileSync(file, 'utf8').trim();
        if (!text) return fallback;
        return JSON.parse(text);
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

function mapItemOut(row) {
    if (!row) return row;
    return {
        id: Number(row.id),
        name: row.name || '',
        barcode: row.barcode || '',
        category: row.category || '',
        model: row.model || '',
        year: row.year || '',
        quantity: Number(row.quantity || 0),
        retailPrice: money(row.retail_price ?? row.retailPrice),
        wholesalePrice: money(row.wholesale_price ?? row.wholesalePrice),
        mechanicPrice: money(row.mechanic_price ?? row.mechanicPrice),
        note: row.note || '',
        createdAt: row.created_at || row.createdAt || ''
    };
}

function mapSaleOut(row) {
    if (!row) return row;
    return {
        id: Number(row.id),
        saleId: row.sale_id || row.saleId || '',
        itemId: Number(row.item_id ?? row.itemId ?? 0),
        barcode: row.barcode || '',
        name: row.name || '',
        category: row.category || '',
        model: row.model || '',
        year: row.year || '',
        qty: Number(row.qty || 0),
        priceType: row.price_type || row.priceType || 'retail',
        priceLabel: row.price_label || row.priceLabel || 'ราคาปลีก',
        price: money(row.price),
        total: money(row.line_total ?? row.total),
        laborCost: money(row.labor_cost ?? row.laborCost),
        grandTotal: money(row.grand_total ?? row.grandTotal),
        customerName: row.customer_name || row.customerName || '',
        paid: money(row.paid),
        change: money(row.change_amount ?? row.change),
        createdAt: row.created_at || row.createdAt || row.date || ''
    };
}

function mapRepairOut(row) {
    if (!row) return row;
    return {
        id: Number(row.id),
        customerName: row.customer_name || row.customerName || '',
        phone: row.phone || '',
        bikeModel: row.bike_model || row.bikeModel || '',
        plate: row.plate || '',
        repairDate: row.repair_date || row.repairDate || '',
        symptom: row.symptom || '',
        parts: Array.isArray(row.parts) ? row.parts : (() => { try { return JSON.parse(row.parts || '[]'); } catch { return []; } })(),
        partsUsedText: row.parts_used_text || row.partsUsedText || '',
        repairPriceType: row.repair_price_type || row.repairPriceType || 'mechanic',
        repairPriceLabel: row.repair_price_label || row.repairPriceLabel || 'ราคาช่าง',
        partsCost: money(row.parts_cost ?? row.partsCost),
        laborCost: money(row.labor_cost ?? row.laborCost),
        totalCost: money(row.total_cost ?? row.totalCost),
        note: row.note || '',
        createdAt: row.created_at || row.createdAt || ''
    };
}

function getPriceLabel(type) {
    if (type === 'wholesale') return 'ราคาส่ง';
    if (type === 'mechanic') return 'ราคาช่าง';
    return 'ราคาปลีก';
}

function getItemPrice(item, priceType) {
    if (priceType === 'wholesale') return money(item.wholesalePrice || item.wholesale_price);
    if (priceType === 'mechanic') return money(item.mechanicPrice || item.mechanic_price || item.retailPrice || item.retail_price);
    return money(item.retailPrice || item.retail_price);
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

async function createItem(payload) {
    const item = {
        id: Date.now(),
        name: String(payload.name || '').trim(),
        barcode: String(payload.barcode || '').trim(),
        category: String(payload.category || '').trim(),
        model: String(payload.model || '').trim(),
        year: String(payload.year || '').trim(),
        quantity: Number(payload.quantity) || 0,
        retailPrice: money(payload.retailPrice),
        wholesalePrice: money(payload.wholesalePrice),
        mechanicPrice: money(payload.mechanicPrice),
        note: String(payload.note || '').trim(),
        createdAt: nowIso()
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
            note: item.note,
            created_at: item.createdAt
        };
        const { data, error } = await supabase.from('items').insert(row).select().single();
        if (error) throw error;
        return mapItemOut(data);
    } catch (error) {
        console.error('SUPABASE createItem fallback:', error.message || error);
        return saveLocal();
    }
}

async function updateItemStock(id, change) {
    const numId = Number(id);
    const numChange = Number(change);
    if (!Number.isFinite(numChange) || numChange === 0) throw new Error('จำนวนไม่ถูกต้อง');


    const items = await getItems();
    const found = items.find(i => i.id === numId);
    if (!found) throw new Error('ไม่พบสินค้า');

    const newQty = Number(found.quantity) + numChange;
    if (newQty < 0) throw new Error('สต๊อกติดลบไม่ได้');

    const saveLocal = () => {
        const localItems = loadJsonFile(DB_FILE, []).map(mapItemOut);
        const idx = localItems.findIndex(i => i.id === numId);
        if (idx === -1) throw new Error('ไม่พบสินค้า');
        localItems[idx].quantity = newQty;
        saveJsonFile(DB_FILE, localItems);
        return localItems[idx];
    };

    if (!useSupabase) return saveLocal();

    try {
        const { data, error } = await supabase
            .from('items')
            .update({ quantity: newQty })
            .eq('id', numId)
            .select("")
    .maybeSingle();
        if (error) throw error;
        return mapItemOut(data);
    } catch (error) {
        console.error('SUPABASE updateItemStock fallback:', error.message || error);
        return saveLocal();
    }
}

async function deleteItemById(id) {
    const numId = Number(id);
    const saveLocal = () => {
        const items = loadJsonFile(DB_FILE, []).map(mapItemOut);
        const filtered = items.filter(i => i.id !== numId);
        if (filtered.length === items.length) throw new Error('ไม่พบสินค้า');
        saveJsonFile(DB_FILE, filtered);
    };

    if (!useSupabase) return saveLocal();

    try {
        const { error } = await supabase.from('items').delete().eq('id', numId);
        if (error) throw error;
    } catch (error) {
        console.error('SUPABASE deleteItemById fallback:', error.message || error);
        saveLocal();
    }
}

async function getSales() {
    const localReader = () => loadJsonFile(SALES_FILE, []).map(mapSaleOut).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (!useSupabase) return localReader();
    try {
        const { data, error } = await supabase.from('sales').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapSaleOut);
    } catch (error) {
        console.error('SUPABASE getSales fallback:', error.message || error);
        return localReader();
    }
}

async function replaceSales(rows) {
    if (!useSupabase) {
        saveJsonFile(SALES_FILE, rows);
        return;
    }
    try {
        const { error } = await supabase.from('sales').delete().neq('id', 0);
        if (error) throw error;
        saveJsonFile(SALES_FILE, rows);
    } catch (error) {
        console.error('SUPABASE replaceSales fallback:', error.message || error);
        saveJsonFile(SALES_FILE, rows);
    }
}

async function getRepairs(query = '') {
    const q = String(query || '').trim().toLowerCase();
    let rows;
    const localReader = () => loadJsonFile(REPAIR_FILE, []).map(mapRepairOut);
    if (!useSupabase) {
        rows = localReader();
    } else {
        try {
            const { data, error } = await supabase.from('repairs').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            rows = (data || []).map(mapRepairOut);
        } catch (error) {
            console.error('SUPABASE getRepairs fallback:', error.message || error);
            rows = localReader();
        }
    }

    if (!q) return rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return rows.filter(r => {
        const hay = [r.customerName, r.phone, r.bikeModel, r.plate, r.symptom, r.partsUsedText, ...(r.parts || []).map(p => p.name)].join(' ').toLowerCase();
        return hay.includes(q);
    });
}

async function createRepair(payload) {
    const items = await getItems();
    const partsInput = Array.isArray(payload.parts) ? payload.parts : [];
    const repairPriceType = String(payload.repairPriceType || 'mechanic');
    const partsDetail = [];
    let partsCost = 0;

    for (const p of partsInput) {
        const item = items.find(i => i.id === Number(p.id));
        const qty = Number(p.qty) || 0;
        if (!item) throw new Error('พบอะไหล่ที่ไม่มีในสต๊อก');
        if (qty <= 0) throw new Error('จำนวนอะไหล่ไม่ถูกต้อง');
        if (Number(item.quantity) < qty) throw new Error(`อะไหล่ ${item.name} มีไม่พอ`);
        const unitPrice = getItemPrice(item, repairPriceType);
        const lineTotal = unitPrice * qty;
        partsCost += lineTotal;
        partsDetail.push({
            id: item.id,
            barcode: item.barcode || '',
            name: item.name,
            qty,
            unitPrice,
            total: lineTotal,
            priceType: repairPriceType,
            priceLabel: getPriceLabel(repairPriceType)
        });
    }

    const laborCost = money(payload.laborCost);
    const record = {
        id: Date.now(),
        customerName: String(payload.customerName || '').trim(),
        phone: String(payload.phone || '').trim(),
        bikeModel: String(payload.bikeModel || '').trim(),
        plate: String(payload.plate || '').trim(),
        repairDate: String(payload.repairDate || '').trim(),
        symptom: String(payload.symptom || '').trim(),
        parts: partsDetail,
        partsUsedText: partsDetail.map(p => `[${p.barcode || '-'}] ${p.name} x${p.qty}`).join(', '),
        repairPriceType,
        repairPriceLabel: getPriceLabel(repairPriceType),
        partsCost,
        laborCost,
        totalCost: partsCost + laborCost,
        note: String(payload.note || '').trim(),
        createdAt: nowIso()
    };

    if (!record.customerName) throw new Error('กรุณาใส่ชื่อลูกค้า');

    const saveLocal = () => {
        const repairs = loadJsonFile(REPAIR_FILE, []).map(mapRepairOut);
        const localItems = loadJsonFile(DB_FILE, []).map(mapItemOut);
        for (const part of partsDetail) {
            const idx = localItems.findIndex(i => i.id === part.id);
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
            const item = items.find(i => i.id === part.id);
            const newQty = Number(item.quantity) - Number(part.qty);
            const { error: stockError } = await supabase.from('items').update({ quantity: newQty }).eq('id', part.id);
            if (stockError) throw stockError;
        }

        const row = {
            id: record.id,
            customer_name: record.customerName,
            phone: record.phone,
            bike_model: record.bikeModel,
            plate: record.plate,
            repair_date: record.repairDate,
            symptom: record.symptom,
            parts: record.parts,
            parts_used_text: record.partsUsedText,
            repair_price_type: record.repairPriceType,
            repair_price_label: record.repairPriceLabel,
            parts_cost: record.partsCost,
            labor_cost: record.laborCost,
            total_cost: record.totalCost,
            note: record.note,
            created_at: record.createdAt
        };

        const { data, error } = await supabase.from('repairs').insert(row).select().single();
        if (error) throw error;
        return mapRepairOut(data);
    } catch (error) {
        console.error('SUPABASE createRepair fallback:', error.message || error);
        return saveLocal();
    }
}

async function deleteRepairById(id) {
    const numId = Number(id);
    const saveLocal = () => {
        const repairs = loadJsonFile(REPAIR_FILE, []).map(mapRepairOut);
        const filtered = repairs.filter(r => r.id !== numId);
        if (filtered.length === repairs.length) throw new Error('ไม่พบประวัติ');
        saveJsonFile(REPAIR_FILE, filtered);
    };

    if (!useSupabase) return saveLocal();
    try {
        const { error } = await supabase.from('repairs').delete().eq('id', numId);
        if (error) throw error;
    } catch (error) {
        console.error('SUPABASE deleteRepairById fallback:', error.message || error);
        saveLocal();
    }
}

async function checkoutSale(payload) {
    const orderItems = Array.isArray(payload.items) ? payload.items : [];
    const priceType = String(payload.priceType || 'retail');
    const laborCost = money(payload.laborCost);
    const paid = money(payload.paid);
    const customerName = String(payload.customerName || '').trim();

    if (!orderItems.length) throw new Error('ไม่มีสินค้าในตะกร้า');

    const items = await getItems();
    const receiptItems = [];
    let subtotal = 0;

    for (const order of orderItems) {
        const item = items.find(i => i.id === Number(order.id));
        const qty = Number(order.qty) || 0;
        if (!item) throw new Error('ไม่พบสินค้า');
        if (qty <= 0) throw new Error('จำนวนไม่ถูกต้อง');
        if (Number(item.quantity) < qty) throw new Error(`สินค้า ${item.name} มีไม่พอ`);

        const price = getItemPrice(item, priceType);
        const lineTotal = price * qty;
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
            priceLabel: getPriceLabel(priceType)
        });
    }

    const total = subtotal + laborCost;
    const change = paid - total;
    if (paid <= 0) throw new Error('กรุณาใส่เงินที่ลูกค้าจ่าย');
    if (change < 0) throw new Error(`เงินไม่พอ ขาดอีก ${Math.abs(change)} บาท`);

    const saleId = `RC${Date.now()}`;
    const createdAt = nowIso();

    const saveLocal = () => {
        const localItems = loadJsonFile(DB_FILE, []).map(mapItemOut);
        const sales = loadJsonFile(SALES_FILE, []).map(mapSaleOut);
        for (const line of receiptItems) {
            const idx = localItems.findIndex(i => i.id === line.id);
            if (idx !== -1) localItems[idx].quantity = Number(localItems[idx].quantity) - Number(line.qty);
            sales.push({
                id: Date.now() + Math.floor(Math.random() * 10000),
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
                laborCost,
                grandTotal: total,
                customerName,
                paid,
                change,
                createdAt
            });
        }
        saveJsonFile(DB_FILE, localItems);
        saveJsonFile(SALES_FILE, sales);
    };

    if (!useSupabase) {
        saveLocal();
    } else {
        try {
            for (const line of receiptItems) {
                const item = items.find(i => i.id === line.id);
                const newQty = Number(item.quantity) - Number(line.qty);
                const { error: stockError } = await supabase.from('items').update({ quantity: newQty }).eq('id', line.id);
                if (stockError) throw stockError;
            }
            const saleRows = receiptItems.map((line, idx) => ({
                id: Date.now() + idx,
                sale_id: saleId,
                item_id: line.id,
                barcode: line.barcode,
                name: line.name,
                category: line.category,
                model: line.model,
                year: line.year,
                qty: line.qty,
                price_type: line.priceType,
                price_label: line.priceLabel,
                price: line.price,
                line_total: line.total,
                labor_cost: laborCost,
                grand_total: total,
                customer_name: customerName,
                paid,
                change_amount: change,
                created_at: createdAt
            }));
            const { error } = await supabase.from('sales').insert(saleRows);
            if (error) throw error;
            saveJsonFile(SALES_FILE, [...loadJsonFile(SALES_FILE, []).map(mapSaleOut), ...saleRows.map(mapSaleOut)]);
        } catch (error) {
            console.error('SUPABASE checkoutSale fallback:', error.message || error);
            saveLocal();
        }
    }

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
        priceType,
        priceLabel: getPriceLabel(priceType)
    };
}


app.get('/api/auth/me', (req, res) => {
    const session = readSession(req);
    if (!session) return res.status(401).json({ success: false, authenticated: false });
    res.json({ success: true, authenticated: true, username: ADMIN_USERNAME });
});

app.post('/api/login', (req, res) => {
    const username = String(req.body.username || '').trim();
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
        console.error('HEALTH CHECK ERROR:', error);
        res.status(500).json({ ok: false, provider: 'supabase', message: error.message || 'Supabase error' });
    }
});

app.get('/api/items', async (req, res) => {
    try {
        res.json(await getItems());
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'โหลดสินค้าไม่สำเร็จ' });
    }
});

app.post('/api/items', async (req, res) => {
    try {
        const item = await createItem(req.body || {});
        res.json({ success: true, item });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'บันทึกสินค้าไม่สำเร็จ' });
    }
});

app.patch('/api/items/:id/stock', async (req, res) => {
  try {
    console.log('PATCH /api/items/:id/stock');
    console.log('params.id =', req.params.id, typeof req.params.id);
    console.log('body =', req.body);

    const id = Number(req.params.id);
    const change = Number(req.body.change);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'รหัสสินค้าไม่ถูกต้อง' });
    }

    if (!Number.isFinite(change) || change === 0) {
      return res.status(400).json({ success: false, message: 'จำนวนไม่ถูกต้อง' });
    }

    const { data: current, error: findError } = await supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    console.log('current =', current);
    console.log('findError =', findError);

    if (findError) throw findError;

    if (!current) {
      return res.status(404).json({ success: false, message: 'ไม่พบสินค้า' });
    }

    const oldQty = Number(current.quantity || 0);
    const newQty = oldQty + change;

    console.log('oldQty =', oldQty, 'change =', change, 'newQty =', newQty);

    if (newQty < 0) {
      return res.status(400).json({ success: false, message: 'สต๊อกติดลบไม่ได้' });
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('items')
      .update({ quantity: newQty })
      .eq('id', id)
      .select('*');

    console.log('updatedRows =', updatedRows);
    console.log('updateError =', updateError);

    if (updateError) throw updateError;

    if (!updatedRows || updatedRows.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'อัปเดตสต๊อกไม่สำเร็จ ไม่พบข้อมูลหลังอัปเดต'
      });
    }

    return res.json({
      success: true,
      item: updatedRows[0]
    });
  } catch (err) {
    console.error('PATCH stock error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์'
    });
  }
});

app.delete('/api/items/:id', async (req, res) => {
    try {
        await deleteItemById(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'ลบสินค้าไม่สำเร็จ' });
    }
});

app.post('/api/checkout', async (req, res) => {
    try {
        const receipt = await checkoutSale(req.body || {});
        res.json({ success: true, total: receipt.total, receipt });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'คิดเงินไม่สำเร็จ' });
    }
});

app.get('/api/report', async (req, res) => {
    try {
        const sales = await getSales();
        const today = new Date().toISOString().slice(0, 10);
        res.json(sales.filter(s => String(s.createdAt || '').slice(0, 10) === today));
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'โหลดรายงานไม่สำเร็จ' });
    }
});

app.delete('/api/report/clear', async (req, res) => {
    try {
        await replaceSales([]);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'เคลียร์รายงานไม่สำเร็จ' });
    }
});

app.get('/api/repairs', async (req, res) => {
    try {
        res.json(await getRepairs(req.query.q || ''));
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'โหลดประวัติการซ่อมไม่สำเร็จ' });
    }
});

app.post('/api/repairs', async (req, res) => {
    try {
        const record = await createRepair(req.body || {});
        res.json({ success: true, record });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'บันทึกประวัติไม่สำเร็จ' });
    }
});

app.delete('/api/repairs/:id', async (req, res) => {
    try {
        await deleteRepairById(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message || 'ลบประวัติไม่สำเร็จ' });
    }
});

ensureJsonFiles();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Data provider: ${useSupabase ? 'Supabase' : 'JSON files'}`);
});
