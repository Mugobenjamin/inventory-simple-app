const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'inventory.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT,
    total_stock INTEGER NOT NULL DEFAULT 0,
    retail_intake INTEGER NOT NULL DEFAULT 0,
    wholesale_intake INTEGER NOT NULL DEFAULT 0,
    retail_price REAL NOT NULL DEFAULT 0,
    wholesale_price REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function formatProduct(product) {
  return {
    ...product,
    total_stock: Number(product.total_stock),
    retail_intake: Number(product.retail_intake),
    wholesale_intake: Number(product.wholesale_intake),
    retail_price: Number(product.retail_price),
    wholesale_price: Number(product.wholesale_price),
  };
}

app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY updated_at DESC').all();
  res.json(rows.map(formatProduct));
});

app.get('/api/summary', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS count, SUM(total_stock) AS total_stock FROM products').get();
  const retail = db.prepare('SELECT SUM(retail_intake) AS sum FROM products').get();
  const wholesale = db.prepare('SELECT SUM(wholesale_intake) AS sum FROM products').get();

  res.json({
    products: Number(total.count || 0),
    total_stock: Number(total.total_stock || 0),
    retail_intake: Number(retail.sum || 0),
    wholesale_intake: Number(wholesale.sum || 0),
  });
});

app.post('/api/products', (req, res) => {
  const { name, sku, total_stock, retail_intake, wholesale_intake, retail_price, wholesale_price } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Product name is required.' });
  }

  const total = Number(total_stock || 0);
  const retail = Number(retail_intake || 0);
  const wholesale = Number(wholesale_intake || 0);
  const retailPrice = Number(retail_price || 0);
  const wholesalePrice = Number(wholesale_price || 0);

  const stmt = db.prepare(`
    INSERT INTO products (name, sku, total_stock, retail_intake, wholesale_intake, retail_price, wholesale_price)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(name.trim(), sku ? sku.trim() : '', total, retail, wholesale, retailPrice, wholesalePrice);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(formatProduct(product));
});

app.put('/api/products/:id', (req, res) => {
  const { name, sku, total_stock, retail_intake, wholesale_intake, retail_price, wholesale_price } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Product name is required.' });
  }

  const stmt = db.prepare(`
    UPDATE products
    SET name = ?, sku = ?, total_stock = ?, retail_intake = ?, wholesale_intake = ?, retail_price = ?, wholesale_price = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const result = stmt.run(
    name.trim(),
    sku ? sku.trim() : '',
    Number(total_stock || 0),
    Number(retail_intake || 0),
    Number(wholesale_intake || 0),
    Number(retail_price || 0),
    Number(wholesale_price || 0),
    Number(req.params.id)
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  res.json(formatProduct(product));
});

app.post('/api/products/:id/adjust', (req, res) => {
  const { delta, type } = req.body;
  const productId = Number(req.params.id);
  const change = Number(delta || 0);

  if (!Number.isFinite(change)) {
    return res.status(400).json({ error: 'A valid quantity is required.' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  let updated = { ...product };

  if (type === 'retail') {
    updated.retail_intake = Math.max(0, Number(product.retail_intake) + change);
  } else if (type === 'wholesale') {
    updated.wholesale_intake = Math.max(0, Number(product.wholesale_intake) + change);
  } else {
    updated.total_stock = Math.max(0, Number(product.total_stock) + change);
  }

  const stmt = db.prepare(`
    UPDATE products
    SET total_stock = ?, retail_intake = ?, wholesale_intake = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(updated.total_stock, updated.retail_intake, updated.wholesale_intake, productId);

  const fresh = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  res.json(formatProduct(fresh));
});

app.delete('/api/products/:id', (req, res) => {
  const productId = Number(req.params.id);
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(productId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Inventory app running at http://localhost:${PORT}`);
});
