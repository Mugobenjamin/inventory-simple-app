const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'inventory.db'));

// Schema: products (existing), users, sessions
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

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
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

// --- Auth helpers ---
function hashPassword(password, salt) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256');
  return hash.toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createSession(userId) {
  const token = generateToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function getUserByEmail(email) {
  return db.prepare('SELECT id, name, email, password_hash, salt FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(id);
}

function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization token' });
  const token = auth.slice(7);
  const session = db.prepare('SELECT token, user_id FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  const user = getUserById(session.user_id);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

// --- Auth endpoints ---
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const salt = generateSalt();
  const password_hash = hashPassword(password, salt);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, salt) VALUES (?, ?, ?, ?)').run(name, email, password_hash, salt);
  const user = getUserById(info.lastInsertRowid);
  const token = createSession(user.id);
  res.status(201).json({ token, user });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const row = getUserByEmail(email);
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });
  const attempted = hashPassword(password, row.salt);
  if (attempted !== row.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  const user = getUserById(row.id);
  const token = createSession(user.id);
  res.json({ token, user });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const auth = req.headers['authorization'];
  const token = auth.slice(7);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true });
});

// Protected dashboard data
app.get('/api/dashboard-data', requireAuth, (req, res) => {
  const summary = db.prepare('SELECT COUNT(*) AS count, SUM(total_stock) AS total_stock, SUM(retail_intake) AS retail_intake, SUM(wholesale_intake) AS wholesale_intake FROM products').get();
  const products = db.prepare('SELECT * FROM products ORDER BY updated_at DESC LIMIT 50').all().map(formatProduct);
  res.json({ user: req.user, summary: {
    products: Number(summary.count || 0),
    total_stock: Number(summary.total_stock || 0),
    retail_intake: Number(summary.retail_intake || 0),
    wholesale_intake: Number(summary.wholesale_intake || 0),
  }, products });
});

// --- Products endpoints (unchanged) ---
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

  // We'll compute the actual applied change for intake types so total_stock stays consistent.
  const currentTotal = Number(product.total_stock);
  let updatedTotal = currentTotal;
  let updatedRetail = Number(product.retail_intake);
  let updatedWholesale = Number(product.wholesale_intake);

  if (type === 'retail') {
    const old = updatedRetail;
    let next = old + change;
    if (next < 0) next = 0;
    const applied = next - old; // actual delta applied
    updatedRetail = next;
    updatedTotal = Math.max(0, currentTotal + applied);
  } else if (type === 'wholesale') {
    const old = updatedWholesale;
    let next = old + change;
    if (next < 0) next = 0;
    const applied = next - old;
    updatedWholesale = next;
    updatedTotal = Math.max(0, currentTotal + applied);
  } else {
    // total adjustment only
    updatedTotal = Math.max(0, currentTotal + change);
  }

  const stmt = db.prepare(`
    UPDATE products
    SET total_stock = ?, retail_intake = ?, wholesale_intake = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(updatedTotal, updatedRetail, updatedWholesale, productId);

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

// Serve auth pages explicitly
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// Fallback to index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Inventory app running at http://localhost:${PORT}`);
});
