# Inventory Simple App

A lightweight inventory management MVP built with Node.js (Express) and SQLite. It provides a minimal web UI to add products, track total stock and separate retail/wholesale intake counts, and quickly adjust quantities from a product dashboard. It also includes simple account registration and login with token-based sessions.

This README explains how the system works, how to run it locally, the API surface, the database schema, the adjustment logic, troubleshooting, and recommended next steps.

---

## Table of contents

- Overview
- Features
- Architecture
- Data model (tables)
- Server behavior and adjustment logic
- Frontend behavior
- API endpoints (examples)
- Run locally (dev)
- Troubleshooting
- Security notes
- Future improvements

---

## Overview

This app is an MVP inventory system. It tracks products with three core numeric fields:

- `total_stock` — canonical current stock for the product
- `retail_intake` — cumulative retail intake count (affects total_stock when changed)
- `wholesale_intake` — cumulative wholesale intake count (affects total_stock when changed)

Adjustments from the UI or API either modify `total_stock` directly or update one of the intake counters; when an intake counter changes the same applied delta is applied to `total_stock` to keep counts consistent.

Authentication is implemented with simple email/password registration and session tokens stored in the SQLite `sessions` table. Tokens are returned to the client and stored in localStorage in the current UI.

---

## Features

- Add, edit, and delete products
- Track `total_stock`, `retail_intake`, `wholesale_intake`, retail/wholesale prices
- Quick adjustments: + / - stock, + / - retail, + / - wholesale from the product card or inline input
- Account registration, login, logout
- Protected dashboard view that shows summary and recent products
- Simple SQLite DB (data/inventory.db) — created automatically on first run

---

## Architecture

- Backend: Node.js + Express
- DB: SQLite via better-sqlite3 (single-file DB at `data/inventory.db`)
- Frontend: static HTML/CSS/vanilla JS served from `public/`
- Sessions: simple token strings inserted in `sessions` table; client stores token in `localStorage` and sends `Authorization: Bearer <token>` on protected requests

Files of interest

- `server.js` — application entry point and API routes
- `public/` — frontend static files (index.html, dashboard.html, login/register, app.js, auth.js, styles.css)
- `data/` — created at runtime and contains `inventory.db`

---

## Data model (tables)

Main tables (created in `server.js` on startup):

- `products`:
  - id INTEGER PRIMARY KEY
  - name TEXT
  - sku TEXT
  - total_stock INTEGER
  - retail_intake INTEGER
  - wholesale_intake INTEGER
  - retail_price REAL
  - wholesale_price REAL
  - updated_at TEXT

- `users`:
  - id INTEGER PRIMARY KEY
  - name TEXT
  - email TEXT UNIQUE
  - password_hash TEXT
  - salt TEXT
  - created_at TEXT

- `sessions`:
  - token TEXT PRIMARY KEY
  - user_id INTEGER (FK users.id)
  - created_at TEXT

Note: For a production-grade system, consider adding a `stock_movements` table (immutable audit log) instead of maintaining intake counters directly.

---

## Server behavior and adjustment logic

The important behavior to understand is how adjustments are applied. The server enforces these rules (atomic, inside a transaction):

1. `total_stock` is treated as the canonical stock balance.
2. When changing an intake counter (`retail_intake` or `wholesale_intake`), the server:
   - computes `next = max(0, oldIntake + delta)`
   - `applied = next - oldIntake` (the actual applied delta after clamping)
   - sets `retail_intake` / `wholesale_intake` = `next`
   - updates `total_stock = max(0, currentTotal + applied)`
3. When changing `total_stock` directly, the server sets `total_stock = max(0, currentTotal + delta)` (intake counters remain unchanged)
4. Each adjust operation runs in a DB transaction to avoid partial updates / race conditions. The API returns the updated product and `appliedDelta` so the client can accurately update the UI.

This approach preserves consistency between the intake counters and the total while preventing negative totals.

---

## Frontend behavior

- Main inventory view (/) — add products and manage adjustments.
- Dashboard (`/dashboard`) — protected page (requires token) that shows summary and recent products.
- Login (`/login`) and Register (`/register`) — centered, responsive, touch-friendly pages.

Adjustment UI rules:
- Quick +/- buttons on product cards provide `data-delta` values (e.g., -1, +1) for small changes.
- The inline number input on the card is used for custom adjustment amounts when the user clicks the + retail / + wholesale / + stock buttons without `data-delta` on them.
- The client disables the product card controls while an adjustment request is in-flight to avoid duplicate clicks. After the response the client updates only the changed product card and refreshes the top summary.

Important: If you edit a product directly (PUT), ensure your values reflect the intended invariant (see Server behavior above). The app attempts to keep fields consistent, but manual edits can lead to mismatches if you set contradictory numbers.

---

## API endpoints and examples

All requests use JSON bodies and responses.

Authentication

- POST /api/register
  - Body: { name, email, password }
  - Response: { token, user }

- POST /api/login
  - Body: { email, password }
  - Response: { token, user }

- POST /api/logout
  - Header: Authorization: Bearer <token>
  - Response: { success: true }

Product management

- GET /api/products
  - Returns all products

- GET /api/summary
  - Returns { products, total_stock, retail_intake, wholesale_intake }

- POST /api/products
  - Body: { name, sku, total_stock, retail_intake, wholesale_intake, retail_price, wholesale_price }
  - Response: created product
  - Note: If you omit total_stock it will be stored as 0 by default — consider setting total_stock = retail + wholesale if desired.

- PUT /api/products/:id
  - Replace product fields (name is required). Provide numeric fields explicitly to avoid unexpected zeros.

- POST /api/products/:id/adjust
  - Body: { delta, type }  where `type` is one of `total` | `retail` | `wholesale`
  - Response: { product, appliedDelta }
  - Example: Increase retail by 2
    curl -X POST http://localhost:3000/api/products/1/adjust -H 'Content-Type: application/json' -d '{"delta":2, "type":"retail"}'

- DELETE /api/products/:id

---

## Run locally (development)

Prerequisites

- Node.js (16+ recommended)
- npm
- On Debian/Ubuntu, install build tools for `better-sqlite3`:

  sudo apt update && sudo apt install -y build-essential python3 pkg-config libsqlite3-dev

Steps

1. Clone

  git clone https://github.com/Mugobenjamin/inventory-simple-app.git
  cd inventory-simple-app

2. Install

  npm install

3. Start

  npm start

4. Open in your browser

  http://localhost:3000

Notes
- The database file is created at `data/inventory.db` the first time the server runs.
- If you make changes to server code, restart the server. You can use `npm run dev` if `nodemon` is installed to auto-restart.

---

## Troubleshooting

- Missing `package.json` after cloning: run `git pull origin main` to fetch the latest pushed files.
- `npm install` fails when compiling `better-sqlite3`: ensure `libsqlite3-dev` and build tools are installed (see prerequisites above).
- If adjustments behave unexpectedly:
  1. Use the `curl` test example in this README to exercise the server endpoint directly and compare results to the UI.
  2. Open browser DevTools → Network/Console to inspect /api/products/:id/adjust request and response.
  3. Check server console for `[ADJUST]` logs (server prints requested/applied values and before/after totals).
  4. If the UI shows inconsistent values even though the API response is correct, the client DOM update code may not find elements — try a full page refresh to confirm DB state.

- To inspect DB directly if sqlite3 is installed:
  sqlite3 data/inventory.db "SELECT id,name,total_stock,retail_intake,wholesale_intake,updated_at FROM products;"

---

## Security notes

- Passwords are hashed with PBKDF2 and a per-user salt. This is acceptable for MVPs but consider a stronger, tested solution in production.
- Tokens are stored in `sessions` table and returned to the client; the current UI stores tokens in `localStorage` (convenient for an MVP but less secure than HttpOnly cookies). In production prefer secure, HttpOnly cookies with CSRF protection and session expiry.
- Always run the app behind HTTPS in production.

---

## Future improvements (recommended)

- Add `stock_movements` (immutable audit log) and compute current stock from movements instead of storing intake counters directly.
- Add session expiration and refresh tokens, or switch to secure cookies.
- Add input validation and inline form errors in the UI.
- Add role-based access control for multiple users (admin/manager/viewer).
- Add CSV import/export and barcode scanner support for mobile.
- Add automated tests for server endpoints and client flows.

---

If you want, I can:
- Implement the `stock_movements` table and migration, and update APIs to record movements.
- Add Dockerfile and a deployment guide.
- Add a nicer logo and deploy a demo.

Thanks — tell me which next step you want and I’ll update the repo. 
