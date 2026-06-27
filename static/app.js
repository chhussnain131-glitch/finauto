/**
 * FinAuto – Frontend JavaScript
 * Covers:
 *   1. Car CRUD (add, list, delete)
 *   2. Customer Management – Sell Modal with customer_name / customer_phone
 *   3. Installment Tracking – add, list, mark paid, delete per chassis
 *   4. PDF Export button – triggers GET /api/export-pdf/<month>
 *   5. Business View – KPI summary + sold cars table
 */

const API = "";
// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format a number as PKR currency string */
const pkr = (n) =>
  "PKR " + Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });

/** Show / hide loading overlay (optional – add <div id="loader"> in HTML) */
const setLoading = (on) => {
  const el = document.getElementById("loader");
  if (el) el.style.display = on ? "flex" : "none";
};

/** Show a small toast notification */
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/** Generic API wrapper */
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    showToast(err.message, "error");
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CAR MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function loadCars() {
  const cars = await apiFetch("/api/cars");
  const tbody = document.getElementById("carsTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  cars.forEach((car) => {
    const statusBadge =
      car.status === "Sold"
        ? `<span class="badge badge-sold">Sold</span>`
        : `<span class="badge badge-available">Available</span>`;

    const actionBtn =
  car.status === "Sold"
    ? `<button class="btn btn-sm btn-outline"
         onclick="openInstallmentsPanel('${car.chassis_number}')">
         💳 Installments
       </button>`
    : `<button class="btn btn-sm btn-primary"
         onclick="openSellModal('${car.chassis_number}')">
         🤝 Sell
       </button>`;

    const row = document.createElement("tr");
    row.dataset.date = (car.created_at || '').slice(0, 10); // "YYYY-MM-DD"
    row.innerHTML = `
      <td>${car.chassis_number}</td>
      <td>${car.make} ${car.model} ${car.year || ""}</td>
      <td>${pkr(car.purchase_price)}</td>
      <td>${car.purchase_date || '—'}</td>
      <td>${statusBadge}</td>
      <td>
        ${actionBtn}
        <button class="btn btn-sm btn-warning"
        onclick="openEditModal('${car.chassis_number}')">✏ Edit</button>
        <button class="btn btn-sm btn-danger"
onclick="deleteCar('${car.chassis_number}')">🗑</button>
      </td>`;
    tbody.appendChild(row);
  });
}

async function addCar(event) {
  event.preventDefault();
  const form = event.target;
  const body = {
    chassis_number: form.chassis_number.value.trim(),
    make:           form.make.value.trim(),
    model:          form.model.value.trim(),
    year:           parseInt(form.year.value) || null,
    purchase_price: parseFloat(form.purchase_price.value) || 0,
    purchase_date:  form.purchase_date.value || null,
};
  await apiFetch("/api/cars", { method: "POST", body: JSON.stringify(body) });
  showToast("Car added successfully ✅");
  form.reset();
  await loadCars();
  await loadBusinessView(); // refresh KPIs
}

async function deleteCar(chassisNumber) {
  if (!confirm(`Delete car ${chassisNumber}? This cannot be undone.`)) return;
  await apiFetch(`/api/cars/${chassisNumber}`, { method: "DELETE" });
  showToast("Car deleted");
  await loadCars();
  await loadBusinessView();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FEATURE 1 – CUSTOMER MANAGEMENT: Sell Modal
// ─────────────────────────────────────────────────────────────────────────────

/** Opens the sell modal and stores the chassis number in a data attribute */
function openSellModal(chassisNumber) {
  const modal = document.getElementById("sellModal");
  if (!modal) return console.error("sellModal element not found");
  modal.dataset.chassis = chassisNumber;

  // Reset form
  const form = modal.querySelector("form");
  if (form) form.reset();

  // Show chassis in modal title
  const titleEl = modal.querySelector(".modal-chassis");
  if (titleEl) titleEl.textContent = chassisNumber;

  modal.classList.add("active");
}

function closeSellModal() {
  const modal = document.getElementById("sellModal");
  if (modal) modal.classList.remove("active");
}

/**
 * Called when the Sell Modal form is submitted.
 * Sends customer_name, customer_phone, and optional sale_price to Flask.
 */
async function submitSellModal(event) {
  event.preventDefault();
  const modal        = document.getElementById("sellModal");
  const chassisNumber = modal?.dataset.chassis;
  if (!chassisNumber) return showToast("No chassis selected", "error");

  const form = event.target;

  const customerName  = form.customer_name.value.trim();
  const customerPhone = form.customer_phone.value.trim();
  const salePriceRaw  = form.sale_price?.value?.trim();

  if (!customerName || !customerPhone) {
    return showToast("Customer name and phone are required", "error");
  }
   const body = { customer_name: customerName, customer_phone: customerPhone };
 if (salePriceRaw) body.sale_price = parseFloat(salePriceRaw);
const advanceRaw = form.advance_payment?.value?.trim();
if (advanceRaw) body.advance_payment = parseFloat(advanceRaw);
const advanceDateRaw = form.advance_date?.value?.trim();
if (advanceDateRaw) body.advance_date = advanceDateRaw;
  await apiFetch(`/api/cars/${chassisNumber}/mark_sold`, {
    method: "PATCH",
    body:   JSON.stringify(body),
  });

  showToast(`Car ${chassisNumber} marked as Sold ✅`);
  closeSellModal();
  await loadCars();
  await loadBusinessView();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. FEATURE 3 – INSTALLMENT TRACKING
// ─────────────────────────────────────────────────────────────────────────────

/** Open the installments side-panel for a specific chassis */
async function openInstallmentsPanel(chassisNumber) {
  const panel = document.getElementById("installmentsPanel");
  if (!panel) return console.error("installmentsPanel element not found");

  panel.dataset.chassis = chassisNumber;
  panel.querySelector(".panel-chassis-number").textContent = chassisNumber;
  panel.classList.add("active");

  await loadInstallments(chassisNumber);
}

function closeInstallmentsPanel() {
  const panel = document.getElementById("installmentsPanel");
  if (panel) panel.classList.remove("active");
}

/** Fetch and render installments for a chassis */
async function loadInstallments(chassisNumber) {
  const [installments, summary] = await Promise.all([
    apiFetch(`/api/installments/${chassisNumber}`),
    apiFetch(`/api/installments/${chassisNumber}/summary`),
  ]);

  // Summary KPIs
  const summaryEl = document.getElementById("installmentSummary");
  if (summaryEl) {
   summaryEl.innerHTML = `
  <div class="kpi-mini">
    <span>Total Owed</span>
    <strong>${pkr(summary.total_owed)}</strong>
  </div>
  <div class="kpi-mini">
    <span>Advance</span>
    <strong class="text-green">${pkr(summary.advance || 0)}</strong>
  </div>
  <div class="kpi-mini">
    <span>Paid Installments</span>
    <strong class="text-green">${pkr(summary.total_paid)}</strong>
  </div>
  <div class="kpi-mini highlight">
    <span>Total Paid</span>
    <strong class="text-green">${pkr((summary.advance || 0) + summary.total_paid)}</strong>
  </div>
  <div class="kpi-mini">
    <span>Balance</span>
    <strong class="${summary.balance_remaining > 0 ? 'text-red' : 'text-green'}">
      ${pkr(summary.balance_remaining)}
    </strong>
  </div>`;
  }

  // Installments list
  const listEl = document.getElementById("installmentsList");
  if (!listEl) return;

  if (!installments.length) {
    listEl.innerHTML = `<p class="empty-state">No installments yet. Add the first one below.</p>`;
    return;
  }

  listEl.innerHTML = installments
    .map(
      (inst) => `
    <div class="installment-row ${
  inst.payment_status === "Paid" ? "paid" :
  inst.payment_status === "Overdue" ? "overdue" : "pending"
}">
      <div class="inst-info">
        <span class="inst-date">📅 ${inst.due_date}</span>
        <span class="inst-amount">${pkr(inst.installment_amount)}</span>
        <span class="inst-badge ${
  inst.payment_status === "Paid" ? "badge-paid" :
  inst.payment_status === "Overdue" ? "badge-overdue" : "badge-pending"
}">
  ${inst.payment_status}
</span>
        ${inst.paid_at ? `<span class="inst-paid-date">Paid: ${inst.paid_at.slice(0,10)}</span>` : ""}
      </div>
      <div class="inst-actions">
        ${
          inst.payment_status === "Pending"
            ? `<button class="btn btn-xs btn-success"
   onclick="openPartialPaymentModal(${inst.id}, ${inst.installment_amount})">
   💰 Pay</button>`
            : `<button class="btn btn-xs btn-outline"
                 onclick='markInstallmentPending(${inst.id})'>↩ Revert</button>`
        }
        <button class="btn btn-xs btn-danger"
          onclick='deleteInstallment(${inst.id})'>🗑</button>
      </div>
    </div>`
    )
    .join("");
}

/** Add a new installment from the panel form */
async function addInstallment(event) {
  event.preventDefault();
  const panel        = document.getElementById("installmentsPanel");
  const chassisNumber = panel?.dataset.chassis;
  if (!chassisNumber) return;

  const form = event.target;
  const body = {
    chassis_number:     chassisNumber,
    installment_amount: parseFloat(form.inst_amount.value),
    due_date:           form.inst_due_date.value,
    payment_status:     "Pending",
  };

  await apiFetch("/api/installments/add", {
    method: "POST",
    body:   JSON.stringify(body),
  });

  showToast("Installment added ✅");
  form.reset();
  await loadInstallments(chassisNumber);
}

async function markInstallmentPaid(id) {
  const panel = document.getElementById("installmentsPanel");
  await apiFetch(`/api/installments/${id}`, {
    method: "PATCH",
    body:   JSON.stringify({ payment_status: "Paid" }),
  });
  showToast("Marked as Paid ✅");
  await loadInstallments(panel.dataset.chassis);
}

async function markInstallmentPending(id) {
  const panel = document.getElementById("installmentsPanel");
  await apiFetch(`/api/installments/${id}`, {
    method: "PATCH",
    body:   JSON.stringify({ payment_status: "Pending" }),
  });
  showToast("Reverted to Pending");
  await loadInstallments(panel.dataset.chassis);
}

async function deleteInstallment(id) {
  if (!confirm("Delete this installment?")) return;
  const panel = document.getElementById("installmentsPanel");
  await apiFetch(`/api/installments/${id}`, { method: "DELETE" });
  showToast("Installment deleted");
  await loadInstallments(panel.dataset.chassis);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FEATURE 2 – PDF EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Triggers a PDF download for the selected month.
 * Works by setting window.location – the browser will download the file.
 */
function exportPDF() {
  const monthInput = document.getElementById("pdfMonthPicker");
  const month      = monthInput?.value || new Date().toISOString().slice(0, 7);
  window.location.href = `${API}/api/export-pdf/${month}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BUSINESS VIEW – KPI Summary + Sold Cars Table
// ─────────────────────────────────────────────────────────────────────────────

async function loadBusinessView() {
  const cars = await apiFetch("/api/cars");

  const sold        = cars.filter((c) => c.status === "Sold");
  const available   = cars.filter((c) => c.status !== "Sold");
  const totalRevenue = sold.reduce((s, c) => s + (c.sale_price || 0), 0);
  const totalCosts   = sold.reduce((s, c) => s + (c.purchase_price || 0), 0);
  const netProfit    = totalRevenue - totalCosts;

  // KPI cards
  _setKPI("kpiTotalCars",    cars.length);
  _setKPI("kpiAvailable",    available.length);
  _setKPI("kpiSold",         sold.length);
  _setKPI("kpiRevenue",      pkr(totalRevenue));
  _setKPI("kpiCosts",        pkr(totalCosts));
  _setKPI("kpiProfit",       pkr(netProfit));

  // Sold cars table in Business View
  const tbody = document.getElementById("soldCarsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!sold.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No sold cars yet</td></tr>`;
    return;
  }

  sold.forEach((c) => {
    const profit = (c.sale_price || 0) - (c.purchase_price || 0);
    const row    = document.createElement("tr");
    row.innerHTML = `
      <td>${c.chassis_number}</td>
      <td>${c.make} ${c.model} ${c.year || ""}</td>
      <td>${c.customer_name || "—"}</td>
      <td>${c.customer_phone || "—"}</td>
      <td>${pkr(c.purchase_price)}</td>
      <td>${pkr(c.sale_price)}</td>
      <td>${c.advance_date || '—'}</td>
      <td class="${profit >= 0 ? 'text-green' : 'text-red'}">${pkr(profit)}</td>
    `;
    tbody.appendChild(row);
  });
}

function _setKPI(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap on page load
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("addCarForm")
    ?.addEventListener("submit", addCar);
  document.getElementById("sellModalForm")
    ?.addEventListener("submit", submitSellModal);
  document.getElementById("addInstallmentForm")
    ?.addEventListener("submit", addInstallment);

  document.getElementById("searchInput")
    ?.addEventListener("input", window.applyFilters);
  document.getElementById("statusFilter")
    ?.addEventListener("change", window.applyFilters);
  document.getElementById("dateFrom")
    ?.addEventListener("change", window.applyFilters);
  document.getElementById("dateTo")
    ?.addEventListener("change", window.applyFilters);
  document.getElementById("clearBtn")
    ?.addEventListener("click", window.clearFilters);
  document.getElementById("editModalForm")
    ?.addEventListener("submit", submitEditModal);

  loadCars();
  loadBusinessView();

  const monthPicker = document.getElementById("pdfMonthPicker");
  if (monthPicker) {
    monthPicker.value = new Date().toISOString().slice(0, 7);
  }
});
// ← Edit functions YAHAN aayenge (DOMContentLoaded se BAHAR)
async function openEditModal(chassisNumber) {
 const car = await apiFetch("/api/cars/" + chassisNumber);
  const modal = document.getElementById("editModal");
  modal.dataset.chassis = chassisNumber;
  modal.querySelector("[name=edit_make]").value           = car.make || "";
  modal.querySelector("[name=edit_model]").value          = car.model || "";
  modal.querySelector("[name=edit_year]").value           = car.year || "";
  modal.querySelector("[name=edit_purchase_price]").value = car.purchase_price || "";
  modal.classList.add("active");
}

function closeEditModal() {
  document.getElementById("editModal").classList.remove("active");
}



async function submitEditModal(event) {
  event.preventDefault();
  const modal   = document.getElementById("editModal");
  const chassis = modal.dataset.chassis;
  const form    = event.target;
  const body    = {
    make:           form.edit_make.value.trim(),
    model:          form.edit_model.value.trim(),
    year:           parseInt(form.edit_year.value) || null,
    purchase_price: parseFloat(form.edit_purchase_price.value) || 0,
  };
  await apiFetch(`/api/cars/${chassis}`, { method: "PUT", body: JSON.stringify(body) });
  showToast("Car updated ✅");
  closeEditModal();
  await loadCars();
  await loadBusinessView();
}
// ─────────────────────────────────────────────────────────────────────────────
// PARTIAL PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────

async function openPartialPaymentModal(installmentId, installmentAmount) {
  const modal = document.getElementById("partialPaymentModal");
  if (!modal) return;
  modal.dataset.installmentId     = installmentId;
  modal.dataset.installmentAmount = installmentAmount;
  modal.querySelector(".inst-total-amount").textContent = pkr(installmentAmount);
  modal.querySelector("form").reset();

  // Existing payments load karo
  const payments = await apiFetch(`/api/installments/${installmentId}/payments`);
  const totalPaid = payments.reduce((s, p) => s + p.amount_paid, 0);
  const remaining = installmentAmount - totalPaid;

  modal.querySelector(".inst-paid-so-far").textContent  = pkr(totalPaid);
  modal.querySelector(".inst-remaining").textContent    = pkr(remaining);

  // Payments list render karo
  const listEl = modal.querySelector(".existing-payments-list");
  listEl.innerHTML = payments.length
    ? payments.map(p => `
        <div class="payment-entry">
          <span>📅 ${p.payment_date}</span>
          <span>${pkr(p.amount_paid)}</span>
          <span class="text-grey">${p.notes || ""}</span>
          <button class="btn btn-xs btn-danger"
            onclick="deletePartialPayment(${p.id}, ${installmentId})">🗑</button>
        </div>`).join("")
    : `<p class="empty-state">No payments yet</p>`;

  modal.classList.add("active");
}

function closePartialPaymentModal() {
  document.getElementById("partialPaymentModal")?.classList.remove("active");
}

async function submitPartialPayment(event) {
  event.preventDefault();
  const modal         = document.getElementById("partialPaymentModal");
  const installmentId = modal.dataset.installmentId;
  const form          = event.target;

  const body = {
    amount_paid:  parseFloat(form.partial_amount.value),
    payment_date: form.partial_date.value,
    notes:        form.partial_notes.value.trim(),
  };

  await apiFetch(`/api/installments/${installmentId}/payments`, {
    method: "POST",
    body:   JSON.stringify(body),
  });

  showToast("Payment added ✅");
  closePartialPaymentModal();

  // Panel refresh karo
  const panel = document.getElementById("installmentsPanel");
  await loadInstallments(panel.dataset.chassis);
}

async function deletePartialPayment(paymentId, installmentId) {
  if (!confirm("Delete this payment?")) return;
  await apiFetch(`/api/payments/${paymentId}`, { method: "DELETE" });
  showToast("Payment deleted");
  await openPartialPaymentModal(
    installmentId,
    parseFloat(document.getElementById("partialPaymentModal").dataset.installmentAmount)
  );
}

// DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("addCarForm")
    ?.addEventListener("submit", addCar);
  document.getElementById("sellModalForm")
    ?.addEventListener("submit", submitSellModal);
  document.getElementById("addInstallmentForm")
    ?.addEventListener("submit", addInstallment);
  document.getElementById("editModalForm")
    ?.addEventListener("submit", submitEditModal);
     document.getElementById("partialPaymentForm")        // ← YAHAN add karo
    ?.addEventListener("submit", submitPartialPayment);

  document.getElementById("searchInput")
    ?.addEventListener("input", window.applyFilters);
  document.getElementById("statusFilter")
    ?.addEventListener("change", window.applyFilters);
  document.getElementById("dateFrom")
    ?.addEventListener("change", window.applyFilters);
  document.getElementById("dateTo")
    ?.addEventListener("change", window.applyFilters);
  document.getElementById("clearBtn")
    ?.addEventListener("click", window.clearFilters);

  loadCars();
  loadBusinessView();

  const monthPicker = document.getElementById("pdfMonthPicker");
  if (monthPicker) {
    monthPicker.value = new Date().toISOString().slice(0, 7);
  }
});

window.applyFilters = function() {
  const search   = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const status   = (document.getElementById('statusFilter')?.value || '').toLowerCase();
  const dateFrom = document.getElementById('dateFrom')?.value || '';
  const dateTo   = document.getElementById('dateTo')?.value || '';
  const rows = document.querySelectorAll('#carsTableBody tr');
  let visible = 0;
  rows.forEach((row) => {
    if (row.cells.length <= 1) { row.style.display = ''; return; }
    const chassisCell = row.cells[0]?.textContent.toLowerCase() || '';
    const vehicleCell = row.cells[1]?.textContent.toLowerCase() || '';
    const statusCell  = row.cells[3]?.textContent.toLowerCase() || '';
    const rowDate     = row.dataset.date || '';
    const matchSearch = !search || chassisCell.includes(search) || vehicleCell.includes(search);
    const matchStatus = !status || statusCell.includes(status);
    const matchFrom   = !dateFrom || rowDate >= dateFrom;
    const matchTo     = !dateTo   || rowDate <= dateTo;
    const show = matchSearch && matchStatus && matchFrom && matchTo;
    row.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const countEl = document.getElementById('filterCount');
  if (countEl) {
    countEl.textContent = visible + ' cars found';
    countEl.style.display = (search || status || dateFrom || dateTo) ? 'block' : 'none';
  }
}

window.clearFilters = function() {
  ['searchInput','statusFilter','dateFrom','dateTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('#carsTableBody tr').forEach(r => r.style.display = '');
  const countEl = document.getElementById('filterCount');
  if (countEl) countEl.style.display = 'none';
}