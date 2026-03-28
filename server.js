// =========================
// ITEMS ROUTES
// =========================
const express = require("express");
const app = express();

app.use(express.json());

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
    created_at: oldItem.created_at || new Date().toISOString()
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
    created_at: item.created_at || null
  };
}

async function getItems() {
  if (USE_SUPABASE) {
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

// GET items
app.get("/api/items", async (req, res) => {
  try {
    const items = await getItems();
    return res.json(items);
  } catch (err) {
    console.error("GET /api/items error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "โหลดสินค้าไม่สำเร็จ"
    });
  }
});

// POST create item
app.post("/api/items", async (req, res) => {
  try {
    const payload = normalizeItemPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: "กรุณาใส่ชื่อสินค้า"
      });
    }

    if (USE_SUPABASE) {
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
        item: sanitizeItemForResponse(data)
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    db.items.unshift(payload);
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      item: sanitizeItemForResponse(payload)
    });
  } catch (err) {
    console.error("POST /api/items error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "บันทึกสินค้าไม่สำเร็จ"
    });
  }
});

// PUT update item
app.put("/api/items/:id", async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบรหัสสินค้า"
      });
    }

    if (USE_SUPABASE) {
      const items = await getItems();
      const current = items.find(i => String(i.id) === itemId);

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "ไม่พบสินค้า"
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
          note: payload.note
        })
        .eq("id", current.id)
        .select()
        .single();

      if (error) {
        console.error("SUPABASE updateItem error:", error);
        throw error;
      }

      return res.json({
        success: true,
        item: sanitizeItemForResponse(data)
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    const index = db.items.findIndex(i => String(i.id) === itemId);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบสินค้า"
      });
    }

    const payload = normalizeItemPayload(req.body, db.items[index]);
    db.items[index] = payload;
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      item: sanitizeItemForResponse(payload)
    });
  } catch (err) {
    console.error("PUT /api/items/:id error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "แก้ไขสินค้าไม่สำเร็จ"
    });
  }
});

// PATCH adjust stock
app.patch("/api/items/:id/stock", async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();
    const change = Number(req.body?.change || 0);

    console.log("PATCH /api/items/:id/stock");
    console.log("params.id =", req.params.id, typeof req.params.id);
    console.log("body =", req.body);

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบรหัสสินค้า"
      });
    }

    if (!Number.isFinite(change) || change === 0) {
      return res.status(400).json({
        success: false,
        message: "จำนวนไม่ถูกต้อง"
      });
    }

    if (USE_SUPABASE) {
      const items = await getItems();
      const current = items.find(i => String(i.id) === itemId);

      console.log("current =", current);

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "ไม่พบสินค้า"
        });
      }

      const oldQty = Number(current.quantity || 0);
      const newQty = oldQty + change;

      console.log("oldQty =", oldQty, "change =", change, "newQty =", newQty);

      if (newQty < 0) {
        return res.status(400).json({
          success: false,
          message: "จำนวนคงเหลือไม่พอ"
        });
      }

      const { data, error } = await supabase
        .from("items")
        .update({
          quantity: newQty
        })
        .eq("id", current.id)
        .select()
        .single();

      console.log("updated data =", data);
      console.log("update error =", error);

      if (error) {
        throw error;
      }

      return res.json({
        success: true,
        item: sanitizeItemForResponse(data)
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    const index = db.items.findIndex(i => String(i.id) === itemId);

    console.log("json index =", index);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบสินค้า"
      });
    }

    const oldQty = Number(db.items[index].quantity || 0);
    const newQty = oldQty + change;

    if (newQty < 0) {
      return res.status(400).json({
        success: false,
        message: "จำนวนคงเหลือไม่พอ"
      });
    }

    db.items[index].quantity = newQty;
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      item: sanitizeItemForResponse(db.items[index])
    });
  } catch (err) {
    console.error("PATCH /api/items/:id/stock error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "เกิดข้อผิดพลาดในเซิร์ฟเวอร์"
    });
  }
});

// DELETE item
app.delete("/api/items/:id", async (req, res) => {
  try {
    const itemId = String(req.params.id || "").trim();

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบรหัสสินค้า"
      });
    }

    if (USE_SUPABASE) {
      const items = await getItems();
      const current = items.find(i => String(i.id) === itemId);

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "ไม่พบสินค้า"
        });
      }

      const { error } = await supabase
        .from("items")
        .delete()
        .eq("id", current.id);

      if (error) {
        console.error("SUPABASE deleteItem error:", error);
        throw error;
      }

      return res.json({
        success: true,
        message: "ลบสินค้าเรียบร้อย"
      });
    }

    const db = readJSON(DB_FILE, { items: [], sales: [], repairs: [] });
    const index = db.items.findIndex(i => String(i.id) === itemId);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบสินค้า"
      });
    }

    db.items.splice(index, 1);
    writeJSON(DB_FILE, db);

    return res.json({
      success: true,
      message: "ลบสินค้าเรียบร้อย"
    });
  } catch (err) {
    console.error("DELETE /api/items/:id error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "ลบสินค้าไม่สำเร็จ"
    });
  }
});