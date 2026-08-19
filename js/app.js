/* ============================================================
   Expense & Budget Visualizer — app.js
   Vanilla JS · LocalStorage · Chart.js

   Core features:
     - Add / delete transactions (name, amount, type, category)
     - Form validation (all fields required)
     - Total balance (income − expense), auto-updates
     - Doughnut / pie chart by category, auto-updates
     - Persisted to localStorage

   Optional challenges (3 of 5):
     1. Custom categories  — add any category, persisted
     2. Monthly summary    — totals grouped by month
     3. Sort transactions  — by date, amount, or category
     + Bonus: Dark/light mode toggle
     + Bonus: Spending limit highlight
   ============================================================ */

'use strict';

/* ----------------------------------------------------------
   Storage keys
   ---------------------------------------------------------- */
const KEY_TXN   = 'bv_transactions';
const KEY_CATS  = 'bv_categories';
const KEY_THEME = 'bv_theme';
const KEY_LIMIT = 'bv_limit';

/* ----------------------------------------------------------
   Category meta (icon lookup, chart colours)
   ---------------------------------------------------------- */
const CAT_ICONS = {
  Food:      '🍔',
  Transport: '🚌',
  Fun:       '🎮',
};

const PALETTE = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  '#06b6d4', '#84cc16',
];

/* ----------------------------------------------------------
   App state
   ---------------------------------------------------------- */
let transactions  = [];   // array of transaction objects
let categories    = ['Food', 'Transport', 'Fun'];
let spendingLimit = 0;
let sortMode      = 'date-desc';
let pieChart      = null; // Chart.js instance

/* ----------------------------------------------------------
   DOM refs
   ---------------------------------------------------------- */
const $ = id => document.getElementById(id);

const form          = $('txn-form');
const fName         = $('f-name');
const fAmount       = $('f-amount');
const fType         = $('f-type');
const fCategory     = $('f-category');
const fCustom       = $('f-custom');
const addCatBtn     = $('add-cat-btn');
const fLimit        = $('f-limit');
const saveLimitBtn  = $('save-limit-btn');
const sortSelect    = $('sort-select');
const themeBtn      = $('theme-btn');
const themeIcon     = $('theme-icon');
const limitBanner   = $('limit-banner');
const balanceEl     = $('total-balance');
const incomeEl      = $('total-income');
const expenseEl     = $('total-expense');
const txnList       = $('txn-list');
const txnEmpty      = $('txn-empty');
const chartCanvas   = $('pie-chart');
const chartEmpty    = $('chart-empty');
const monthlySumEl  = $('monthly-summary');
const monthlyEmpty  = $('monthly-empty');
const errName       = $('err-name');
const errAmount     = $('err-amount');

/* ----------------------------------------------------------
   Initialise
   ---------------------------------------------------------- */
function init() {
  loadStorage();
  applyTheme(loadTheme());
  syncCategorySelect();
  render();

  form.addEventListener('submit', onSubmit);
  addCatBtn.addEventListener('click', onAddCategory);
  saveLimitBtn.addEventListener('click', onSaveLimit);
  sortSelect.addEventListener('change', () => { sortMode = sortSelect.value; renderList(); });
  themeBtn.addEventListener('click', onThemeToggle);
}

/* ----------------------------------------------------------
   LocalStorage helpers
   ---------------------------------------------------------- */
function loadStorage() {
  try {
    const t = localStorage.getItem(KEY_TXN);
    transactions = t ? JSON.parse(t) : [];

    const c = localStorage.getItem(KEY_CATS);
    if (c) {
      const extra = JSON.parse(c);
      categories = [...new Set([...categories, ...extra])];
    }

    const l = localStorage.getItem(KEY_LIMIT);
    spendingLimit = l ? parseFloat(l) : 0;
    if (spendingLimit > 0) fLimit.value = spendingLimit;
  } catch (e) {
    transactions = [];
  }
}

function saveTxns()  { localStorage.setItem(KEY_TXN,  JSON.stringify(transactions)); }
function saveCats()  { localStorage.setItem(KEY_CATS, JSON.stringify(categories)); }
function saveLimit() { localStorage.setItem(KEY_LIMIT, String(spendingLimit)); }

/* ----------------------------------------------------------
   Theme  (Optional challenge: dark/light toggle)
   ---------------------------------------------------------- */
function loadTheme() {
  return localStorage.getItem(KEY_THEME) || 'light';
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(KEY_THEME, theme);
  // Rebuild chart so legend text colour matches new theme
  if (pieChart) { pieChart.destroy(); pieChart = null; }
  renderChart();
}

function onThemeToggle() {
  const current = document.body.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ----------------------------------------------------------
   Custom categories  (Optional challenge)
   ---------------------------------------------------------- */
function onAddCategory() {
  const raw = fCustom.value.trim();
  if (!raw) return;

  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (!categories.includes(name)) {
    categories.push(name);
    saveCats();
    syncCategorySelect();
  }

  fCategory.value = name;
  fCustom.value = '';
}

function syncCategorySelect() {
  const prev = fCategory.value;
  fCategory.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = `${CAT_ICONS[cat] || '🏷️'} ${cat}`;
    fCategory.appendChild(opt);
  });
  if (categories.includes(prev)) fCategory.value = prev;
}

/* ----------------------------------------------------------
   Spending limit  (Optional challenge: highlight over limit)
   ---------------------------------------------------------- */
function onSaveLimit() {
  const v = parseFloat(fLimit.value);
  spendingLimit = (!isNaN(v) && v > 0) ? v : 0;
  saveLimit();
  checkLimit();
}

function checkLimit() {
  if (spendingLimit <= 0) { limitBanner.classList.add('hidden'); return; }
  const totalExp = transactions
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);
  limitBanner.classList.toggle('hidden', totalExp <= spendingLimit);
}

/* ----------------------------------------------------------
   Form validation & submission
   ---------------------------------------------------------- */
function clearErrors() {
  errName.textContent = '';
  errAmount.textContent = '';
}

function validate(name, amount) {
  let ok = true;
  clearErrors();
  if (!name) { errName.textContent = 'Item name is required.'; ok = false; }
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    errAmount.textContent = 'Enter a valid amount greater than 0.'; ok = false;
  }
  return ok;
}

function onSubmit(e) {
  e.preventDefault();

  const name     = fName.value.trim();
  const amount   = fAmount.value.trim();
  const type     = fType.value;
  const category = fCategory.value;

  if (!validate(name, amount)) return;

  transactions.unshift({
    id:       Date.now(),
    name,
    amount:   parseFloat(amount),
    type,
    category,
    date:     new Date().toISOString(),
  });

  saveTxns();
  render();

  fName.value   = '';
  fAmount.value = '';
  fName.focus();
}

/* ----------------------------------------------------------
   Delete
   ---------------------------------------------------------- */
function onDelete(id) {
  transactions = transactions.filter(t => t.id !== id);
  saveTxns();
  render();
}

/* ----------------------------------------------------------
   Sorting  (Optional challenge)
   ---------------------------------------------------------- */
function sorted() {
  const list = [...transactions];
  switch (sortMode) {
    case 'date-asc':    return list.sort((a,b) => new Date(a.date) - new Date(b.date));
    case 'amount-desc': return list.sort((a,b) => b.amount - a.amount);
    case 'amount-asc':  return list.sort((a,b) => a.amount - b.amount);
    case 'category':    return list.sort((a,b) => a.category.localeCompare(b.category));
    default:            return list.sort((a,b) => new Date(b.date) - new Date(a.date));
  }
}

/* ----------------------------------------------------------
   Formatters
   ---------------------------------------------------------- */
function fmtRp(n) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function esc(str) {
  return str
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

/* ----------------------------------------------------------
   Render: balance
   ---------------------------------------------------------- */
function renderBalance() {
  const income  = transactions.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  balanceEl.textContent = fmtRp(income - expense);
  incomeEl.textContent  = fmtRp(income);
  expenseEl.textContent = fmtRp(expense);
}

/* ----------------------------------------------------------
   Render: transaction list
   ---------------------------------------------------------- */
function renderList() {
  txnList.innerHTML = '';

  if (transactions.length === 0) {
    txnEmpty.classList.remove('hidden');
    return;
  }
  txnEmpty.classList.add('hidden');

  sorted().forEach(t => {
    const li   = document.createElement('li');
    const sign = t.type === 'income' ? '+' : '−';
    const icon = CAT_ICONS[t.category] || '🏷️';

    li.className = `txn-item is-${t.type}`;
    li.innerHTML = `
      <span class="txn-icon" aria-hidden="true">${icon}</span>
      <div class="txn-info">
        <p class="txn-name">${esc(t.name)}</p>
        <p class="txn-meta">${esc(t.category)} · ${fmtDate(t.date)}</p>
      </div>
      <span class="txn-amount ${t.type}">${sign} ${fmtRp(t.amount)}</span>
      <button class="txn-del" aria-label="Delete ${esc(t.name)}" data-id="${t.id}">✕</button>
    `;
    txnList.appendChild(li);
  });

  // Event delegation for delete buttons
  txnList.querySelectorAll('.txn-del').forEach(btn => {
    btn.addEventListener('click', () => onDelete(Number(btn.dataset.id)));
  });
}

/* ----------------------------------------------------------
   Render: monthly summary  (Optional challenge)
   ---------------------------------------------------------- */
function renderMonthly() {
  const map = {};

  transactions.forEach(t => {
    const d   = new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map[key]) map[key] = { income: 0, expense: 0 };
    map[key][t.type] += t.amount;
  });

  const keys = Object.keys(map).sort((a,b) => b.localeCompare(a));

  if (keys.length === 0) {
    monthlySumEl.innerHTML = '';
    monthlyEmpty.classList.remove('hidden');
    return;
  }

  monthlyEmpty.classList.add('hidden');
  monthlySumEl.innerHTML = keys.map(key => {
    const [yr, mo] = key.split('-');
    const label = new Date(yr, mo - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const { income, expense } = map[key];
    return `
      <div class="month-row">
        <span class="month-name">${label}</span>
        <span class="month-figures">
          <span class="month-income">+${fmtRp(income)}</span>
          <span class="month-expense">−${fmtRp(expense)}</span>
        </span>
      </div>`;
  }).join('');
}

/* ----------------------------------------------------------
   Render: pie/doughnut chart
   ---------------------------------------------------------- */
function renderChart() {
  const expenses = transactions.filter(t => t.type === 'expense');

  if (expenses.length === 0) {
    chartEmpty.classList.remove('hidden');
    chartCanvas.classList.add('hidden');
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    return;
  }

  chartEmpty.classList.add('hidden');
  chartCanvas.classList.remove('hidden');

  // Aggregate by category
  const agg = {};
  expenses.forEach(t => { agg[t.category] = (agg[t.category] || 0) + t.amount; });
  const labels = Object.keys(agg);
  const data   = Object.values(agg);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  const isDark    = document.body.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e6edf3' : '#111827';

  if (pieChart) {
    // Update existing chart in-place (no flicker)
    pieChart.data.labels                    = labels;
    pieChart.data.datasets[0].data          = data;
    pieChart.data.datasets[0].backgroundColor = colors;
    pieChart.options.plugins.legend.labels.color = textColor;
    pieChart.update();
  } else {
    pieChart = new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: isDark ? '#161b22' : '#ffffff',
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        cutout: '50%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: textColor,
              padding: 14,
              usePointStyle: true,
              pointStyleWidth: 10,
              font: { size: 12, family: "'Segoe UI', system-ui, sans-serif" },
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${fmtRp(ctx.parsed)}`,
            },
          },
        },
      },
    });
  }
}

/* ----------------------------------------------------------
   Master render
   ---------------------------------------------------------- */
function render() {
  renderBalance();
  renderList();
  renderMonthly();
  renderChart();
  checkLimit();
}

/* ----------------------------------------------------------
   Boot
   ---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', init);
