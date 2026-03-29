require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const USE_SUPABASE = String(process.env.USE_SUPABASE || "false").toLowerCase() === "true";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "data.json");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase =
  USE_SUPABASE && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

function readJSON(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error("readJSON error:", err);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function ensureLocalDB() {
  if (!fs.existsSync(DB_FILE)) {
    writeJSON(DB_FILE, { items: [], sales: [], repairs: [] });
  }
}

ensureLocalDB();

function normalizeItemPayload(body = {}, oldItem = {}) {
  return {
    id: oldItem.id ?? (body.id ? Number(body.id) : Date.now()),
    name: String(body.name || oldItem.name || "").trim(),
    barcode: String(body.barcode || oldItem.barcode || "").trim(),
    category: String(body.category || oldItem.category || "").trim(),
    model: String(body.model || oldItem.model || "").trim(),
    year: String(body.year || oldItem.year || "").trim(),
    quantity: Number(body.quantity ?? oldItem.quantity ?? 0) || 0,
    retailPrice: Number(body.retailPrice ?? oldItem.retailPrice ?? 0) || 0,
    wholesalePrice: Number(body.wholesalePrice ?? oldItem.wholesalePrice ?? 0) || 0,
    mechanicPrice: Number(body.mechanicPrice ?? oldItem.mechanicPrice ?? 0) || 0,
    costPrice: Number(body.costPrice ?? oldItem.costPrice ?? 0) || 0,
    minStock: Number(body.minStock ?? oldItem.minStock ?? 0) || 0,
    note: String(body.note || oldItem.note || "").trim(),
    created_at: oldItem.created_at || new Date().toISOString(),
  };
}

function sanitizeItemForResponse(item = {}) {
  return {
    id: item.id,
    name: item.name || "",
    barcode: item.barcode || "",
    category: item.category || "",
    model: item.model || "",
    year: item.year || "",
    quantity: Number(item.quantity || 0),
    retailPrice: Number(item.retailPrice || 0),
    wholesalePrice: Number(item.wholesalePrice || 0),
    mechanicPrice: Number(item.mechanicPrice || 0),
    costPrice: Number(item.costPrice || 0),
    minStock: Number(item.minStock || 0),
    note: item.note || "",
    created_at: item.created_at || null,
  };
}

async function getItems() {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("SUPABASE getItems error:", error);
      throw error;
    }

    return Array.isArray(data) ? data.map(sanitizeItemForResponse) : [];
  }

  const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
  return Array.isArray(db.items) ? db.items.map(sanitizeItemForResponse) : [];
}

app.get("/api/health", async (req, res) => {
  return res.json({
    ok: true,
    provider: USE_SUPABASE ? "supabase" : "json",
  });
});

// =========================
// AUTH ROUTES
// =========================

app.get("/api/auth/me", (req, res) => {
  return res.json({
    success: true,
    user: {
      username: ADMIN_USERNAME,
    },
  });
});

app.post("/api/auth/login", (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "").trim();

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      return res.json({
        success: true,
        redirectTo: "/admin.html",
      });
    }

    return res.status(401).json({
      success: false,
      message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "เข้าสู่ระบบไม่สำเร็จ",
    });
  }
});

// =========================
// ITEMS ROUTES
// =========================

app.get("/api/items", async (req, res) => {
  try {
    const items = await getItems();
    return res.json(items);
  } catch (err) {
    console.error("GET /api/items error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "โหลดสินค้าไม่สำเร็จ",
    });
  }
});

app.post("/api/items", async (req, res) => {
  try {
    const payload = normalizeItemPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: "กรุณาใส่ชื่อสินค้า",
      });
    }

    if (USE_SUPABASE && supabase) {
      const { data, error } = await supabase
        .from("items")
        .insert([payload])
        .select()
        .single();

      if (error) {
        console.error("SUPABASE createItem error:", error);
        throw error;
      }

      return res.json({
        success: true,
        item: sanitizeItemForResponse(data),
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    db.items.unshift(payload);
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      item: sanitizeItemForResponse(payload),
    });
  } catch (err) {
    console.error("POST /api/items error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "บันทึกสินค้าไม่สำเร็จ",
    });
  }
});

app.put("/api/items/:id", async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบรหัสสินค้า",
      });
    }

    if (USE_SUPABASE && supabase) {
      const { data: rows, error: fetchError } = await supabase
        .from("items")
        .select("*")
        .eq("id", itemId);

      if (fetchError) {
        console.error("SUPABASE fetch item for update error:", fetchError);
        throw fetchError;
      }

      const current = Array.isArray(rows) && rows.length ? rows[0] : null;

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "ไม่พบสินค้า",
        });
      }

      const payload = normalizeItemPayload(req.body, current);

      const { data, error } = await supabase
        .from("items")
        .update({
          name: payload.name,
          barcode: payload.barcode,
          category: payload.category,
          model: payload.model,
          year: payload.year,
          quantity: payload.quantity,
          retailPrice: payload.retailPrice,
          wholesalePrice: payload.wholesalePrice,
          mechanicPrice: payload.mechanicPrice,
          costPrice: payload.costPrice,
          minStock: payload.minStock,
          note: payload.note,
        })
        .eq("id", current.id)
        .select()
        .single();

      if (error) {
        console.error("SUPABASE update item error:", error);
        throw error;
      }

      return res.json({
        success: true,
        item: sanitizeItemForResponse(data),
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    const index = db.items.findIndex((i) => String(i.id) === itemId);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบสินค้า",
      });
    }

    const payload = normalizeItemPayload(req.body, db.items[index]);
    db.items[index] = payload;
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      item: sanitizeItemForResponse(payload),
    });
  } catch (err) {
    console.error("PUT /api/items/:id error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "แก้ไขสินค้าไม่สำเร็จ",
    });
  }
});

app.patch("/api/items/:id/stock", async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    const change = Number(req.body?.change || 0);

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบรหัสสินค้า",
      });
    }

    if (!Number.isFinite(change) || change === 0) {
      return res.status(400).json({
        success: false,
        message: "จำนวนไม่ถูกต้อง",
      });
    }

    if (USE_SUPABASE && supabase) {
      const { data: rows, error: fetchError } = await supabase
        .from("items")
        .select("id,name,quantity")
        .eq("id", itemId);

      if (fetchError) {
        console.error("SUPABASE fetch stock item error:", fetchError);
        throw fetchError;
      }

      const current = Array.isArray(rows) && rows.length ? rows[0] : null;

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "ไม่พบสินค้า",
        });
      }

      const oldQty = Number(current.quantity || 0);
      const newQty = oldQty + change;

      if (newQty < 0) {
        return res.status(400).json({
          success: false,
          message: "จำนวนคงเหลือไม่พอ",
        });
      }

      const { data, error } = await supabase
        .from("items")
        .update({ quantity: newQty })
        .eq("id", current.id)
        .select("*")
        .single();

      if (error) {
        console.error("SUPABASE update stock error:", error);
        throw error;
      }

      return res.json({
        success: true,
        item: sanitizeItemForResponse(data),
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    const index = db.items.findIndex((i) => String(i.id) === itemId);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบสินค้า",
      });
    }

    const oldQty = Number(db.items[index].quantity || 0);
    const newQty = oldQty + change;

    if (newQty < 0) {
      return res.status(400).json({
        success: false,
        message: "จำนวนคงเหลือไม่พอ",
      });
    }

    db.items[index].quantity = newQty;
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      item: sanitizeItemForResponse(db.items[index]),
    });
  } catch (err) {
    console.error("PATCH /api/items/:id/stock error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "เกิดข้อผิดพลาดในเซิร์ฟเวอร์",
    });
  }
});

app.delete("/api/items/:id", async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบรหัสสินค้า",
      });
    }

    if (USE_SUPABASE && supabase) {
      const { data: rows, error: fetchError } = await supabase
        .from("items")
        .select("id")
        .eq("id", itemId);

      if (fetchError) throw fetchError;

      const current = Array.isArray(rows) && rows.length ? rows[0] : null;

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "ไม่พบสินค้า",
        });
      }

      const { error } = await supabase
        .from("items")
        .delete()
        .eq("id", current.id);

      if (error) {
        console.error("SUPABASE delete item error:", error);
        throw error;
      }

      return res.json({
        success: true,
        message: "ลบสินค้าเรียบร้อย",
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    const index = db.items.findIndex((i) => String(i.id) === itemId);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบสินค้า",
      });
    }

    db.items.splice(index, 1);
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      message: "ลบสินค้าเรียบร้อย",
    });
  } catch (err) {
    console.error("DELETE /api/items/:id error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "ลบสินค้าไม่สำเร็จ",
    });
  }
});
// =========================
// REPAIRS ROUTES
// =========================

// GET repairs
app.get("/api/repairs", async (req, res) => {
  try {
    if (USE_SUPABASE && supabase) {
      const { data, error } = await supabase
        .from("repairs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json(data || []);
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    return res.json(db.repairs || []);
  } catch (err) {
    console.error("GET repairs error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST repairs
app.post("/api/repairs", async (req, res) => {
  try {
    const payload = {
      id: Date.now(),
      customerName: req.body.customerName || "",
      phone: req.body.phone || "",
      bikeModel: req.body.bikeModel || "",
      plate: req.body.plate || "",
      repairDate: req.body.repairDate || new Date().toISOString(),
      symptom: req.body.symptom || "",
      parts: req.body.parts || [],
      laborCost: Number(req.body.laborCost || 0),
      total: Number(req.body.total || 0),
      note: req.body.note || "",
      created_at: new Date().toISOString()
    };

    if (USE_SUPABASE && supabase) {
      const { data, error } = await supabase
        .from("repairs")
        .insert([payload])
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, repair: data });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    db.repairs.unshift(payload);
    writeJSON(DB_FILE, db);

    return res.json({ success: true, repair: payload });
  } catch (err) {
    console.error("POST repairs error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// =========================
// STATIC PAGES
// =========================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/pos.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pos.html"));
});

app.get("/repair-history.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "repair-history.html"));
});

app.get("/report.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

app.get("/print.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "print.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Data provider: ${USE_SUPABASE ? "Supabase" : "JSON"}`);
});