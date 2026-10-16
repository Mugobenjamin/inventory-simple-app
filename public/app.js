const form = document.getElementById('productForm');
const productList = document.getElementById('productList');
const summary = document.getElementById('summary');

async function loadSummary() {
  const response = await fetch('/api/summary');
  const data = await response.json();

  summary.innerHTML = `
    <div class="summary-box">
      <small>Products</small>
      <strong>${data.products}</strong>
    </div>
    <div class="summary-box">
      <small>Total stock</small>
      <strong>${data.total_stock}</strong>
    </div>
    <div class="summary-box">
      <small>Retail intake</small>
      <strong>${data.retail_intake}</strong>
    </div>
    <div class="summary-box">
      <small>Wholesale intake</small>
      <strong>${data.wholesale_intake}</strong>
    </div>
  `;
}

async function loadProducts() {
  const response = await fetch('/api/products');
  const products = await response.json();

  if (!products.length) {
    productList.innerHTML = '<div class="empty-state">No products yet. Add your first product above.</div>';
    return;
  }

  productList.innerHTML = products
    .map(
      (product) => `
        <article class="product-card" data-id="${product.id}">
          <div class="product-header">
            <div>
              <h3>${escapeHtml(product.name)}</h3>
              <span class="product-code">SKU: ${escapeHtml(product.sku || '—')}</span>
            </div>

            <div class="inline-form">
              <input type="number" min="0" value="1" aria-label="Adjustment quantity for ${escapeHtml(product.name)}" data-adjust-input="${product.id}" />
              <button class="action-btn primary" data-action="adjust" data-id="${product.id}" data-type="total">+ stock</button>
              <button class="action-btn warning" data-action="adjust" data-id="${product.id}" data-type="retail">+ retail</button>
              <button class="action-btn danger" data-action="adjust" data-id="${product.id}" data-type="wholesale">+ wholesale</button>
            </div>
          </div>

          <div class="stock-grid">
            <div class="stock-box">
              <small>Total stock</small>
              <strong>${product.total_stock}</strong>
            </div>
            <div class="stock-box">
              <small>Retail intake</small>
              <strong>${product.retail_intake}</strong>
            </div>
            <div class="stock-box">
              <small>Wholesale intake</small>
              <strong>${product.wholesale_intake}</strong>
            </div>
          </div>

          <div class="stock-actions">
            <button class="action-btn" data-action="adjust" data-id="${product.id}" data-type="total" data-delta="-1">-1 stock</button>
            <button class="action-btn" data-action="adjust" data-id="${product.id}" data-type="total" data-delta="1">+1 stock</button>
            <button class="action-btn" data-action="adjust" data-id="${product.id}" data-type="retail" data-delta="-1">-1 retail</button>
            <button class="action-btn" data-action="adjust" data-id="${product.id}" data-type="wholesale" data-delta="-1">-1 wholesale</button>
            <button class="action-btn danger" data-action="delete" data-id="${product.id}">Delete</button>
          </div>

          <div class="stock-grid" style="margin-top: 16px;">
            <div class="stock-box">
              <small>Retail price</small>
              <strong>$${Number(product.retail_price).toFixed(2)}</strong>
            </div>
            <div class="stock-box">
              <small>Wholesale price</small>
              <strong>$${Number(product.wholesale_price).toFixed(2)}</strong>
            </div>
            <div class="stock-box">
              <small>Updated</small>
              <strong>${new Date(product.updated_at).toLocaleDateString()}</strong>
            </div>
          </div>
        </article>
      `
    )
    .join('');
}

async function addProduct(event) {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    name: formData.get('name'),
    sku: formData.get('sku'),
    total_stock: Number(formData.get('total_stock') || 0),
    retail_intake: Number(formData.get('retail_intake') || 0),
    wholesale_intake: Number(formData.get('wholesale_intake') || 0),
    retail_price: Number(formData.get('retail_price') || 0),
    wholesale_price: Number(formData.get('wholesale_price') || 0),
  };

  const response = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    alert(error.error || 'Something went wrong.');
    return;
  }

  form.reset();
  document.getElementById('total_stock').value = 0;
  document.getElementById('retail_intake').value = 0;
  document.getElementById('wholesale_intake').value = 0;
  document.getElementById('retail_price').value = 0;
  document.getElementById('wholesale_price').value = 0;

  await loadProducts();
  await loadSummary();
}

async function handleAdjustment(event) {
  const button = event.target.closest('[data-action="adjust"]');
  if (!button) return;

  const productId = button.dataset.id;
  const type = button.dataset.type || 'total';

  // Prefer an explicit data-delta on the button (used for quick +/- buttons).
  let delta = undefined;
  if (button.dataset.delta !== undefined) {
    delta = Number(button.dataset.delta);
  } else {
    const deltaInput = document.querySelector(`[data-adjust-input="${productId}"]`);
    delta = deltaInput ? Number(deltaInput.value || 0) : 0;
  }

  if (!Number.isFinite(delta)) {
    alert('Invalid quantity');
    return;
  }

  await fetch(`/api/products/${productId}/adjust`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta, type }),
  });

  await loadProducts();
  await loadSummary();
}

async function handleDelete(event) {
  const button = event.target.closest('[data-action="delete"]');
  if (!button) return;

  const productId = button.dataset.id;
  const confirmed = window.confirm('Delete this product?');
  if (!confirmed) return;

  await fetch(`/api/products/${productId}`, { method: 'DELETE' });
  await loadProducts();
  await loadSummary();
}

form.addEventListener('submit', addProduct);
productList.addEventListener('click', async (event) => {
  const adjustBtn = event.target.closest('[data-action="adjust"]');
  if (adjustBtn) {
    await handleAdjustment(event);
    return;
  }

  const deleteBtn = event.target.closest('[data-action="delete"]');
  if (deleteBtn) {
    await handleDelete(event);
  }
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

loadSummary();
loadProducts();
