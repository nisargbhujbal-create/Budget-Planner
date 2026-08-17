// Ledger — frontend application logic. No build step, no framework.

const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const state = {
  months: [],
  currentMonth: null,
  categories: [],
  categoryChart: null,
  trendChart: null,
};

// ---------------------------------------------------------------- tabs ----

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  activateTab(btn.dataset.tab);
});

document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", () => activateTab(el.dataset.goto));
});

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("is-active", p.id === `panel-${name}`));
  if (name === "goals") { loadGoals(); }
  if (name === "history") { loadHistory(); }
}

// ------------------------------------------------------------- helpers ----

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// -------------------------------------------------------- init & months ----

async function init() {
  await loadCategories();
  await refreshMonths();
  buildExpenseRows(state.categories.map((c) => ({ category: c.name, amount: "" })));
  document.getElementById("input-month").value = currentYearMonth();
  wireForms();
}

async function loadCategories() {
  state.categories = await api("/api/categories");
}

async function refreshMonths() {
  state.months = await api("/api/months");
  const select = document.getElementById("month-select");
  select.innerHTML = "";
  if (state.months.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No months recorded";
    opt.disabled = true;
    select.appendChild(opt);
    select.disabled = true;
    state.currentMonth = null;
    renderDashboard(null);
    return;
  }
  select.disabled = false;
  state.months.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.month;
    opt.textContent = monthLabel(m.month);
    select.appendChild(opt);
  });
  state.currentMonth = state.currentMonth && state.months.some(m => m.month === state.currentMonth)
    ? state.currentMonth
    : state.months[0].month;
  select.value = state.currentMonth;
  await loadDashboard(state.currentMonth);
}

document.getElementById("month-select").addEventListener("change", (e) => {
  state.currentMonth = e.target.value;
  loadDashboard(state.currentMonth);
});

// ------------------------------------------------------------ dashboard ----

async function loadDashboard(month) {
  if (!month) { renderDashboard(null); return; }
  try {
    const data = await api(`/api/budget/${month}`);
    renderDashboard(data);
  } catch {
    renderDashboard(null);
  }
}

function renderDashboard(data) {
  const empty = document.getElementById("empty-state");
  const body = document.getElementById("dashboard-body");

  if (!data) {
    empty.hidden = false;
    body.hidden = true;
    return;
  }
  empty.hidden = true;
  body.hidden = false;

  document.getElementById("stat-income").textContent = fmt(data.income);
  document.getElementById("stat-expenses").textContent = fmt(data.total_expenses);
  document.getElementById("stat-balance").textContent = fmt(data.balance);

  const tbody = document.getElementById("ledger-tbody");
  tbody.innerHTML = "";
  const total = data.total_expenses || 1;
  data.expenses.forEach((e) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(e.category)}</td>
      <td class="num">${fmt(e.amount)}</td>
      <td class="num">${((e.amount / total) * 100).toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });
  if (data.expenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="list-empty">No expenses logged for this month.</td></tr>`;
  }

  drawCategoryChart(data.expenses);
}

function drawCategoryChart(expenses) {
  const ctx = document.getElementById("category-chart");
  const palette = ["#EC7263", "#EFC745", "#974859", "#D9A441", "#C9603D", "#A75265", "#B98F3B", "#E0956B"];
  if (state.categoryChart) state.categoryChart.destroy();
  state.categoryChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: expenses.map((e) => e.category),
      datasets: [{
        data: expenses.map((e) => e.amount),
        backgroundColor: expenses.map((_, i) => palette[i % palette.length]),
        borderColor: "#FFFFFF",
        borderWidth: 2,
      }],
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { color: "#2E241F", font: { family: "Inter" }, boxWidth: 12, padding: 14 } },
      },
      cutout: "62%",
    },
  });
}

document.getElementById("export-btn").addEventListener("click", () => {
  if (!state.currentMonth) return;
  window.location.href = `/api/export/${state.currentMonth}`;
});

document.getElementById("delete-btn").addEventListener("click", async () => {
  if (!state.currentMonth) return;
  if (!confirm(`Delete the record for ${monthLabel(state.currentMonth)}? This can't be undone.`)) return;
  await api(`/api/budget/${state.currentMonth}`, { method: "DELETE" });
  state.currentMonth = null;
  await refreshMonths();
});

// --------------------------------------------------------- record form ----

function buildExpenseRows(rows) {
  const container = document.getElementById("expense-rows");
  container.innerHTML = "";
  rows.forEach((r) => addExpenseRow(r.category, r.amount));
}

function addExpenseRow(category = "", amount = "") {
  const container = document.getElementById("expense-rows");
  const row = document.createElement("div");
  row.className = "expense-row";
  row.innerHTML = `
    <input type="text" class="expense-category" placeholder="Category" value="${escapeAttr(category)}">
    <input type="number" class="expense-amount" placeholder="0.00" min="0" step="0.01" value="${escapeAttr(amount)}">
    <button type="button" class="row-remove" title="Remove row">✕</button>
  `;
  row.querySelector(".row-remove").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

document.getElementById("add-category-btn").addEventListener("click", () => {
  const input = document.getElementById("new-category-name");
  const name = input.value.trim();
  if (!name) return;
  addExpenseRow(name, "");
  input.value = "";
});

function wireForms() {
  document.getElementById("record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("record-msg");
    msg.textContent = "";
    msg.classList.remove("is-error");

    const month = document.getElementById("input-month").value;
    const income = document.getElementById("input-income").value;
    const expenses = Array.from(document.querySelectorAll(".expense-row")).map((row) => ({
      category: row.querySelector(".expense-category").value.trim(),
      amount: row.querySelector(".expense-amount").value,
    })).filter((r) => r.category && r.amount !== "");

    if (!month) {
      msg.textContent = "Pick a month first.";
      msg.classList.add("is-error");
      return;
    }

    try {
      await api("/api/budget", {
        method: "POST",
        body: JSON.stringify({ month, income, expenses }),
      });
      msg.textContent = `Saved ${monthLabel(month)}.`;
      await loadCategories();
      state.currentMonth = month;
      await refreshMonths();
      activateTab("dashboard");
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add("is-error");
    }
  });

  document.getElementById("goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("goal-name").value.trim();
    const target = document.getElementById("goal-target").value;
    try {
      await api("/api/goals", { method: "POST", body: JSON.stringify({ name, target }) });
      document.getElementById("goal-form").reset();
      loadGoals();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("estimate-amount").addEventListener("input", debounce(estimateTimeToGoal, 250));
}

// ------------------------------------------------------------- goals ----

async function loadGoals() {
  const goals = await api("/api/goals");
  const list = document.getElementById("goals-list");
  list.innerHTML = "";
  if (goals.length === 0) {
    list.innerHTML = `<p class="list-empty">No goals yet — create one on the left.</p>`;
    return;
  }
  goals.forEach((g) => {
    const pct = Math.min(100, (g.saved / g.target) * 100);
    const el = document.createElement("div");
    el.className = "goal-card";
    el.innerHTML = `
      <div class="goal-card__top">
        <span class="goal-card__name">${escapeHtml(g.name)}</span>
        <span class="goal-card__amounts">${fmt(g.saved)} / ${fmt(g.target)}</span>
      </div>
      <div class="goal-bar"><div class="goal-bar__fill" style="width:${pct}%"></div></div>
      <div class="goal-card__actions">
        <input type="number" placeholder="Amount" min="0" step="0.01" class="goal-add-input">
        <button type="button" class="btn btn--ghost goal-add-btn">Add to savings</button>
        <button type="button" class="btn btn--ghost btn--danger goal-delete-btn">Delete</button>
      </div>
    `;
    el.querySelector(".goal-add-btn").addEventListener("click", async () => {
      const input = el.querySelector(".goal-add-input");
      const val = parseFloat(input.value);
      if (!val) return;
      await api(`/api/goals/${g.id}`, { method: "PATCH", body: JSON.stringify({ add_amount: val }) });
      loadGoals();
    });
    el.querySelector(".goal-delete-btn").addEventListener("click", async () => {
      if (!confirm(`Delete goal "${g.name}"?`)) return;
      await api(`/api/goals/${g.id}`, { method: "DELETE" });
      loadGoals();
    });
    list.appendChild(el);
  });
}

async function estimateTimeToGoal() {
  const amountInput = document.getElementById("estimate-amount");
  const result = document.getElementById("estimate-result");
  const amount = parseFloat(amountInput.value);
  if (!amount) { result.textContent = ""; return; }

  const summary = await api("/api/summary");
  const avg = summary.average_monthly_balance;
  if (!summary.trend.length) {
    result.textContent = "Record at least one month to estimate this.";
    return;
  }
  if (avg <= 0) {
    result.textContent = "Your average monthly balance is zero or negative — no timeline to show yet.";
    return;
  }
  const months = amount / avg;
  result.textContent = `About ${months.toFixed(1)} months, saving your average monthly balance of ${fmt(avg)}.`;
}

// ------------------------------------------------------------ history ----

async function loadHistory() {
  const summary = await api("/api/summary");
  const ctx = document.getElementById("trend-chart");
  if (state.trendChart) state.trendChart.destroy();

  if (summary.trend.length === 0) {
    ctx.getContext("2d").clearRect(0, 0, ctx.width, ctx.height);
    return;
  }

  state.trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: summary.trend.map((t) => monthLabel(t.month)),
      datasets: [
        { label: "Income", data: summary.trend.map((t) => t.income), borderColor: "#D9A441", backgroundColor: "transparent", tension: 0.25 },
        { label: "Expenses", data: summary.trend.map((t) => t.expenses), borderColor: "#C9603D", backgroundColor: "transparent", tension: 0.25 },
        { label: "Balance", data: summary.trend.map((t) => t.balance), borderColor: "#974859", backgroundColor: "transparent", tension: 0.25 },
      ],
    },
    options: {
      scales: {
        x: { ticks: { color: "#7A6B62" }, grid: { color: "#E5DED5" } },
        y: { ticks: { color: "#7A6B62" }, grid: { color: "#E5DED5" } },
      },
      plugins: {
        legend: { labels: { color: "#2E241F", font: { family: "Inter" } } },
      },
    },
  });
}

// ------------------------------------------------------------- utility ----

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

init();
