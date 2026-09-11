// ── Design tokens (dark theme) ──────────────────────────────────────
const COLORS = {
  blue: "#6366F1",
  cyan: "#06B6D4",
  green: "#10B981",
  greenDim: "rgba(16,185,129,0.15)",
  red: "#EF4444",
  redDim: "rgba(239,68,68,0.15)",
  amber: "#F59E0B",
  amberDim: "rgba(245,158,11,0.15)",
  textMuted: "#64748B",
  border: "rgba(255,255,255,0.08)",
  bg: "#0B0E14",
  surface: "#151A23",
  text: "#F1F5F9",
  textSec: "#94A3B8",
};

const SIGNAL_META = {
  "STRONG BUY": { color: "#10B981", bg: "rgba(16,185,129,0.15)", icon: "⬆" },
  "BUY":        { color: "#34D399", bg: "rgba(52,211,153,0.12)", icon: "↑" },
  "HOLD":       { color: "#F59E0B", bg: "rgba(245,158,11,0.12)", icon: "→" },
  "SELL":       { color: "#F87171", bg: "rgba(248,113,113,0.12)", icon: "↓" },
  "STRONG SELL":{ color: "#EF4444", bg: "rgba(239,68,68,0.15)", icon: "⬇" },
};

const FACTOR_POOL = [
  { name: "Fed Interest Rate Policy", type: "macro" },
  { name: "Sector Rotation Trends", type: "macro" },
  { name: "Inflation Trajectory", type: "macro" },
  { name: "Global Trade Outlook", type: "macro" },
  { name: "Currency Strength", type: "macro" },
  { name: "Social Media Sentiment", type: "sentiment" },
  { name: "Institutional Buying", type: "sentiment" },
  { name: "Retail Investor Interest", type: "sentiment" },
  { name: "Analyst Consensus", type: "sentiment" },
  { name: "Short Interest Ratio", type: "sentiment" },
  { name: "Revenue Growth Rate", type: "financial" },
  { name: "Debt-to-Equity Ratio", type: "financial" },
  { name: "Profit Margin Trend", type: "financial" },
  { name: "Free Cash Flow", type: "financial" },
  { name: "P/E Relative to Sector", type: "financial" },
  { name: "Insider Transaction Activity", type: "financial" },
];

const TIMEFRAMES = [
  { label: "6M", range: "6mo", interval: "1wk" },
  { label: "1Y", range: "1y", interval: "1wk" },
  { label: "3Y", range: "3y", interval: "1mo" },
  { label: "5Y", range: "5y", interval: "1mo" },
  { label: "10Y", range: "10y", interval: "1mo" },
];

// ── Simulated AI fallback ─────────────────────────────────────────────
function tickerSeed(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function generatePrediction(ticker, hist) {
  const price = hist.length ? hist[hist.length - 1].close : 100;
  const rng = seededRandom(tickerSeed(ticker));
  const SIGNALS = ["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"];
  const signal = SIGNALS[Math.floor(rng() * SIGNALS.length)];
  const confidence = Math.round(55 + rng() * 40);
  const drift = signal.includes("BUY") ? 0.015 : signal.includes("SELL") ? -0.012 : 0.002;
  const curve = [price];
  for (let i = 1; i <= 12; i++) curve.push(Math.round(curve[i - 1] * (1 + drift + (rng() - 0.5) * 0.04) * 100) / 100);
  return { signal, confidence, forecastCurve: curve };
}
function generateFactors(ticker) {
  const rng = seededRandom(tickerSeed(ticker) + 99);
  return [...FACTOR_POOL].sort(() => rng() - 0.5).slice(0, 6).map((f) => ({
    ...f, desc: `Simulated factor analysis for ${ticker}.`, impact: Math.round((rng() - 0.4) * 16),
  }));
}
function getLaymanAdvice(pred, yrRet) {
  const { signal, confidence } = pred;
  if (signal.includes("BUY")) return {
    adviceHeadline: "Conditions favor accumulating this stock",
    adviceDetail: `With a ${confidence}% confidence ${signal} signal${yrRet != null ? ` and a ${yrRet > 0 ? "positive" : "negative"} 1-year return of ${yrRet}%` : ""}, the current setup looks constructive. Momentum and sentiment factors lean positive.`,
    adviceAction: "Consider building a position gradually on any near-term pullback.",
  };
  if (signal.includes("SELL")) return {
    adviceHeadline: "Risk-reward tilts against holding here",
    adviceDetail: `At ${confidence}% confidence, the model flags ${signal}. ${yrRet != null && yrRet < 0 ? `Already down ${Math.abs(yrRet)}% over 12 months.` : "Deteriorating factors suggest caution."} Downside pressure may persist.`,
    adviceAction: "Consider trimming exposure or tightening stop-losses.",
  };
  return {
    adviceHeadline: "Neutral stance — wait for clarity",
    adviceDetail: `The model reads HOLD at ${confidence}% confidence. Neither bulls nor bears hold a decisive edge. Key catalysts ahead could break the stalemate.`,
    adviceAction: "Hold current positions; avoid adding until direction clarifies.",
  };
}

// ── Utility ───────────────────────────────────────────────────────────
const fmt = (n, d = 2) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
const fmtBig = (n) => {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
};
const currSym = (c) => c === "INR" ? "₹" : "$";
const escapeHtml = (s) => (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

// ── State ─────────────────────────────────────────────────────────────
let state = {
  ticker: "AAPL",
  stockName: "",
  currency: "USD",
  history: [],
  news: [],
  analysis: null,
  aiSource: "simulated",
  staged: null,
  timeframe: "1y",
};
let searchDebounce = null;

// ── Lightweight canvas charting (no external dependency) ───────────────
// Re-render trigger stored per canvas so we can redraw cleanly
const lastDraw = new WeakMap();

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;

  // Temporarily clear inline width so parent can report its natural size
  canvas.style.width = "";
  canvas.style.height = "";

  // Read the parent's actual content width (minus padding)
  const rect = parent.getBoundingClientRect();
  const style = getComputedStyle(parent);
  const padH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const cssWidth = Math.max(100, Math.round(rect.width - padH));
  const cssHeight = parseInt(canvas.getAttribute("height"), 10) || 200;

  // Set explicit pixel dimensions for both display and buffer
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

function drawLineChart(canvas, values, opts = {}) {
  lastDraw.set(canvas, () => drawLineChart(canvas, values, opts));
  const { ctx, width: W, height: H } = setupCanvas(canvas);
  ctx.clearRect(0, 0, W, H);
  if (!values.length) return;

  const padL = 58, padR = 8, padT = 10, padB = 22;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, H - padT - padB);

  // Mobile-safe min/max (no spread operator to avoid stack overflow)
  const min = values.reduce((a, b) => Math.min(a, b), Infinity);
  const max = values.reduce((a, b) => Math.max(a, b), -Infinity);
  const range = (max - min) || Math.abs(max) || 1;
  const niceMin = min - range * 0.08;
  const niceMax = max + range * 0.08;
  const niceRange = niceMax - niceMin || 1;

  const xAt = (i) => padL + (values.length > 1 ? (i / (values.length - 1)) * plotW : plotW / 2);
  const yAt = (v) => padT + plotH - ((v - niceMin) / niceRange) * plotH;

  // Grid + y labels
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "12px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const v = niceMin + (niceRange * i) / gridLines;
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(W - padR, Math.round(y) + 0.5);
    ctx.stroke();
    if (opts.yFormat) ctx.fillText(opts.yFormat(v), padL - 8, y);
  }

  // Reference line (e.g. current price on forecast chart)
  if (opts.refValue != null) {
    const y = yAt(opts.refValue);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.textMuted;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.restore();
  }

  // Area fill
  if (opts.fillColor) {
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, opts.fillColor + "33");
    grad.addColorStop(1, opts.fillColor + "00");
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(values[0]));
    values.forEach((v, i) => ctx.lineTo(xAt(i), yAt(v)));
    ctx.lineTo(xAt(values.length - 1), padT + plotH);
    ctx.lineTo(xAt(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Line
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xAt(i), y = yAt(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = opts.color || COLORS.blue;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // X labels (sparse)
  if (opts.xLabels) {
    ctx.fillStyle = COLORS.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "11px 'JetBrains Mono', monospace";
    opts.xLabels.forEach((label, i) => {
      if (label) ctx.fillText(label, xAt(i), padT + plotH + 5);
    });
  }

  // Hover interaction
  attachHover(canvas, { xAt, yAt, values, padL, padT, plotW, plotH, tooltipFormat: opts.tooltipFormat, color: opts.color || COLORS.blue });
}

function drawBarChart(canvas, values, colors, opts = {}) {
  lastDraw.set(canvas, () => drawBarChart(canvas, values, colors, opts));
  const { ctx, width: W, height: H } = setupCanvas(canvas);
  ctx.clearRect(0, 0, W, H);
  if (!values.length) return;

  const padL = 58, padR = 8, padT = 10, padB = 10;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, H - padT - padB);

  // Mobile-safe max
  const max = values.reduce((a, b) => Math.max(a, b), 1);
  const barGap = 1.5;
  const barW = Math.max(1, plotW / values.length - barGap);

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "12px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const v = (max * i) / gridLines;
    const y = padT + plotH - (v / max) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(W - padR, Math.round(y) + 0.5);
    ctx.stroke();
    if (opts.yFormat) ctx.fillText(opts.yFormat(v), padL - 8, y);
  }

  values.forEach((v, i) => {
    const x = padL + i * (plotW / values.length) + barGap / 2;
    const h = (v / max) * plotH;
    const y = padT + plotH - h;
    ctx.fillStyle = colors[i] || COLORS.blue;
    const r = Math.min(2, barW / 2);
    roundRectTop(ctx, x, y, barW, h, r);
    ctx.fill();
  });

  attachHover(canvas, {
    xAt: (i) => padL + i * (plotW / values.length) + (plotW / values.length) / 2,
    yAt: (v) => padT + plotH - (v / max) * plotH,
    values, padL, padT, plotW, plotH,
    tooltipFormat: opts.tooltipFormat, color: COLORS.blue, isBar: true,
  });
}

function roundRectTop(ctx, x, y, w, h, r) {
  if (h <= 0) { ctx.beginPath(); return; }
  r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// ── Hover + Crosshair (DOM-based, no getImageData) ─────────────────────
const hoverState = new WeakMap();

function attachHover(canvas, cfg) {
  const prev = hoverState.get(canvas);
  if (prev) {
    canvas.removeEventListener("mousemove", prev.move);
    canvas.removeEventListener("mouseleave", prev.leave);
    if (prev.touchMove) {
      canvas.removeEventListener("touchmove", prev.touchMove);
      canvas.removeEventListener("touchend", prev.leave);
    }
  }

  const tooltip = getOrCreateTooltip(canvas);

  const move = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const n = cfg.values.length;
    if (n === 0) return;
    let idx = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(cfg.xAt(i) - mx);
      if (d < best) { best = d; idx = i; }
    }
    const v = cfg.values[idx];
    const px = cfg.xAt(idx), py = cfg.yAt(v);

    tooltip.style.display = "block";
    tooltip.style.left = Math.min(Math.max(px, 40), canvas.clientWidth - 40) + "px";
    tooltip.style.top = "2px";
    tooltip.textContent = cfg.tooltipFormat ? cfg.tooltipFormat(v, idx) : String(v);

    drawCrosshair(canvas, cfg, px, py);
  };

  const leave = () => {
    tooltip.style.display = "none";
    drawCrosshair(canvas, cfg, -1, -1);
  };

  const touchMove = (e) => {
    if (e.touches.length > 0) move(e.touches[0]);
  };

  hoverState.set(canvas, { move, leave, touchMove });
  canvas.addEventListener("mousemove", move);
  canvas.addEventListener("mouseleave", leave);
  canvas.addEventListener("touchmove", touchMove, { passive: true });
  canvas.addEventListener("touchend", leave);
}

function getOrCreateTooltip(canvas) {
  let wrap = canvas.parentElement;
  if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
  let tip = wrap.querySelector(".chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tooltip";
    wrap.appendChild(tip);
  }
  return tip;
}

// DOM-based crosshair — zero canvas memory usage, no getImageData
function drawCrosshair(canvas, cfg, px, py) {
  let line = canvas._crosshairLine;
  let dot = canvas._crosshairDot;

  if (!line) {
    const wrap = canvas.parentElement;
    wrap.style.position = "relative";

    line = document.createElement("div");
    line.style.cssText = "position:absolute;border-left:1px dashed rgba(255,255,255,0.15);pointer-events:none;display:none;z-index:10;";
    wrap.appendChild(line);
    canvas._crosshairLine = line;

    dot = document.createElement("div");
    dot.style.cssText = "position:absolute;width:6px;height:6px;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;display:none;z-index:11;";
    wrap.appendChild(dot);
    canvas._crosshairDot = dot;
  }

  if (px < 0 || py < 0) {
    line.style.display = "none";
    dot.style.display = "none";
    return;
  }

  line.style.display = "block";
  line.style.left = px + "px";
  line.style.top = cfg.padT + "px";
  line.style.height = cfg.plotH + "px";

  if (!cfg.isBar) {
    dot.style.display = "block";
    dot.style.left = px + "px";
    dot.style.top = py + "px";
    dot.style.background = cfg.color || "#FFF";
  } else {
    dot.style.display = "none";
  }
}

// ── DOM refs ──────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const searchInput = el("searchInput");
const searchDropdown = el("searchDropdown");
const searchInputWrap = document.querySelector(".search-input-wrap");
const stagedDot = el("stagedDot");
const applyBtn = el("applyBtn");

// ── Search ────────────────────────────────────────────────────────────
searchInput.addEventListener("input", (e) => {
  const val = e.target.value;
  clearTimeout(searchDebounce);
  state.staged = null;
  stagedDot.classList.remove("show");
  applyBtn.classList.remove("active");
  applyBtn.disabled = true;
  if (val.length < 1) { searchDropdown.classList.remove("show"); return; }
  searchDebounce = setTimeout(async () => {
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
      const d = await r.json();
      renderSearchResults(d.results || []);
    } catch { renderSearchResults([]); }
  }, 280);
});
searchInput.addEventListener("focus", () => {
  searchInputWrap.classList.add("focused");
  if (searchDropdown.children.length) searchDropdown.classList.add("show");
});
searchInput.addEventListener("blur", () => searchInputWrap.classList.remove("focused"));
document.addEventListener("mousedown", (e) => {
  if (!el("searchWrap").contains(e.target)) searchDropdown.classList.remove("show");
});

function renderSearchResults(results) {
  searchDropdown.innerHTML = results.map((r) => `
    <div class="search-result" data-symbol="${escapeHtml(r.symbol)}" data-name="${escapeHtml(r.name)}">
      <div class="search-result-left">
        <span class="search-result-symbol">${escapeHtml(r.symbol)}</span>
        <span class="search-result-name">${escapeHtml(r.name)}</span>
      </div>
      <span class="search-result-exchange">${escapeHtml(r.exchange)}</span>
    </div>
  `).join("");
  searchDropdown.classList.toggle("show", results.length > 0);
  searchDropdown.querySelectorAll(".search-result").forEach((node) => {
    node.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const symbol = node.dataset.symbol;
      state.staged = symbol;
      searchInput.value = symbol;
      searchDropdown.classList.remove("show");
      stagedDot.classList.add("show");
      applyBtn.classList.add("active");
      applyBtn.disabled = false;
    });
  });
}

applyBtn.addEventListener("click", () => {
  if (!state.staged) return;
  loadTicker(state.staged);
  state.staged = null;
  searchInput.value = "";
  stagedDot.classList.remove("show");
  applyBtn.classList.remove("active");
  applyBtn.disabled = true;
});

// ── Data loading ──────────────────────────────────────────────────────
async function loadTicker(ticker) {
  state.ticker = ticker;
  el("content").style.display = "none";
  el("errorBox").style.display = "none";
  el("loadingMain").style.display = "flex";
  el("loadingMainText").textContent = `Fetching ${ticker} data…`;

  try {
    const [cRes, nRes] = await Promise.all([
      fetch(`/api/chart/${ticker}`),
      fetch(`/api/news/${ticker}`),
    ]);
    if (!cRes.ok) throw new Error("Failed to load chart data");
    const cData = await cRes.json();
    const nData = nRes.ok ? await nRes.json() : { articles: [] };

    state.history = cData.history || [];
    state.stockName = cData.name || ticker;
    state.currency = cData.currency || "USD";
    state.news = nData.articles || [];

    el("loadingMain").style.display = "none";
    renderTickerBar();
    if (!state.history.length) throw new Error("No price history available");

    el("content").style.display = "flex";
    initTimeframeButtons();
    renderStats();
    renderPriceChart();
    renderVolumeChart();
    renderNews();

    await runAiAnalysis();
  } catch (err) {
    el("loadingMain").style.display = "none";
    el("errorBox").textContent = err.message;
    el("errorBox").style.display = "block";
  }
}

// ── Monthly data aggregation ──────────────────────────────────────────
function getMonthlyData(history) {
  const buckets = {};
  history.forEach((d) => {
    const dt = new Date(d.date);
    const key = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
    if (!buckets[key]) buckets[key] = { volume: 0, close: d.close, open: d.open || d.close, count: 0 };
    buckets[key].volume += d.volume || 0;
    buckets[key].close = d.close;
    buckets[key].count++;
  });
  const keys = Object.keys(buckets).sort();
  return keys.map((k) => ({
    date: k,
    volume: buckets[k].volume,
    close: buckets[k].close,
    open: buckets[k].open,
  }));
}

// ── Stats ─────────────────────────────────────────────────────────────
function computeStats() {
  const h = state.history;
  if (!h.length) return {};
  const monthly = getMonthlyData(h);
  const last = h[h.length - 1];
  const prev = h.length > 1 ? h[h.length - 2] : last;
  const yr = h.length > 12 ? h[h.length - 13] : h[0];
  const monthlyChange = prev.close ? parseFloat(((last.close - prev.close) / prev.close * 100).toFixed(2)) : null;
  const yrReturn = yr.close ? parseFloat(((last.close - yr.close) / yr.close * 100).toFixed(2)) : null;
  const avgVol = monthly.length ? Math.round(monthly.slice(-12).reduce((s, d) => s + d.volume, 0) / Math.min(monthly.length, 12)) : 0;
  const lastDate = last.date || "";
  return { lastClose: last.close, monthlyChange, yrReturn, avgVol, lastDate };
}

function renderTickerBar() {
  el("tickerBar").style.display = "flex";
  el("tickerSymbol").textContent = state.ticker;
  el("tickerName").textContent = state.stockName;
  el("tickerCurrency").textContent = state.currency;
}

function renderStats() {
  const stats = computeStats();
  state._stats = stats;
  const items = [
    { label: "📌 Last Close", value: `${currSym(state.currency)}${fmt(stats.lastClose)}`, sub: stats.lastDate, color: "var(--text)" },
    { label: "Monthly", value: stats.monthlyChange != null ? `${stats.monthlyChange >= 0 ? "+" : ""}${stats.monthlyChange}%` : "—", color: stats.monthlyChange >= 0 ? "var(--green)" : "var(--red)" },
    { label: "1Y Return", value: stats.yrReturn != null ? `${stats.yrReturn >= 0 ? "+" : ""}${stats.yrReturn}%` : "—", color: stats.yrReturn >= 0 ? "var(--green)" : "var(--red)" },
    { label: "Monthly Vol", value: fmtBig(stats.avgVol), color: "var(--text)" },
  ];
  let html = items.map((it) => `
    <div class="card stat-card">
      <div class="stat-label">${it.label}</div>
      <div class="stat-value" style="color:${it.color}">${it.value}</div>
      ${it.sub ? `<div style="font-size:11px;color:var(--text-muted);font-family:var(--mono)">${it.sub}</div>` : ""}
    </div>
  `).join("");
  html += `
    <div class="card signal-card" id="signalCard">
      <div class="stat-label">Signal</div>
      <div class="signal-value-row">
        <span class="stat-value" id="signalValue" style="color:var(--text-muted)">—</span>
      </div>
    </div>
  `;
  el("statRow").innerHTML = html;
}

function updateSignalStat() {
  const a = state.analysis;
  const card = el("signalCard");
  const valueEl = el("signalValue");
  if (!a || !card || !valueEl) return;
  const sig = SIGNAL_META[a.signal] || SIGNAL_META.HOLD;
  card.style.borderColor = sig.color + "33";
  card.classList.add("glow");
  valueEl.style.color = sig.color;
  valueEl.innerHTML = `${a.signal} <span class="signal-conf-badge">${a.confidence}%</span>`;
}

// ── Timeframe buttons ─────────────────────────────────────────────────
function initTimeframeButtons() {
  const buttons = document.querySelectorAll(".tf-btn");
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    // Remove old listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", async () => {
      document.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
      newBtn.classList.add("active");
      const range = newBtn.dataset.range;
      const interval = newBtn.dataset.interval;
      state.timeframe = range;
      try {
        const res = await fetch(`/api/chart/${state.ticker}?range=${range}&interval=${interval}`);
        if (!res.ok) throw new Error("Failed to fetch timeframe");
        const data = await res.json();
        state.history = data.history || [];
        renderStats();
        renderPriceChart();
        renderVolumeChart();
      } catch (err) {
        console.error("Timeframe fetch error:", err);
      }
    });
  });
}

// ── Charts ────────────────────────────────────────────────────────────
function renderPriceChart() {
  const canvas = el("priceChart");
  if (!canvas) return;
  const data = state.history.map((d) => d.close);
  const dates = state.history.map((d) => d.date);

  // Smart x-axis labels based on data range
  const n = dates.length;
  const labelCount = Math.min(6, n);
  const step = Math.max(1, Math.floor(n / labelCount));
  const xLabels = dates.map((d, i) => {
    if (i % step === 0 || i === n - 1) {
      const dt = new Date(d);
      const mon = dt.toLocaleString("en", { month: "short" });
      const yr = "'" + String(dt.getFullYear()).slice(-2);
      return `${mon} ${yr}`;
    }
    return "";
  });

  // Price change badge
  const badge = el("priceChangeBadge");
  if (badge && data.length >= 2) {
    const pct = ((data[data.length - 1] - data[0]) / data[0] * 100).toFixed(1);
    const isUp = pct >= 0;
    badge.textContent = `${isUp ? "▲" : "▼"} ${Math.abs(pct)}%`;
    badge.className = "price-change-badge " + (isUp ? "positive" : "negative");
  }

  drawLineChart(canvas, data, {
    color: COLORS.blue,
    fillColor: COLORS.blue,
    yFormat: (v) => currSym(state.currency) + fmtBig(v),
    xLabels,
    tooltipFormat: (v, i) => `${dates[i]}  ${currSym(state.currency)}${fmt(v)}`,
  });
}

function renderVolumeChart() {
  const canvas = el("volumeChart");
  if (!canvas) return;
  const monthly = getMonthlyData(state.history);
  const data = monthly.map((d) => d.volume);
  const dates = monthly.map((d) => d.date);
  const colors = monthly.map((d) => d.close >= d.open ? COLORS.green + "aa" : COLORS.red + "88");

  drawBarChart(canvas, data, colors, {
    yFormat: (v) => fmtBig(v),
    tooltipFormat: (v, i) => `${dates[i]}  Vol ${fmtBig(v)}`,
  });
}

function renderForecastChart() {
  const a = state.analysis;
  if (!a || !a.forecastCurve) return;
  const stats = state._stats;
  const months = ["Now", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"];
  const endPrice = a.forecastCurve[a.forecastCurve.length - 1];
  const isUp = endPrice >= stats.lastClose;
  const diff = ((endPrice - stats.lastClose) / stats.lastClose * 100).toFixed(1);
  const lineColor = isUp ? COLORS.green : COLORS.red;

  const deltaEl = el("forecastDelta");
  if (deltaEl) {
    deltaEl.textContent = `${isUp ? "▲" : "▼"} ${diff}%`;
    deltaEl.style.color = lineColor;
    deltaEl.style.background = isUp ? COLORS.greenDim : COLORS.redDim;
  }

  const canvas = el("forecastChart");
  if (!canvas) return;
  drawLineChart(canvas, a.forecastCurve, {
    color: lineColor,
    fillColor: lineColor,
    refValue: stats.lastClose,
    yFormat: (v) => currSym(state.currency) + fmt(v, 0),
    xLabels: months,
    tooltipFormat: (v, i) => `${months[i]}  ${currSym(state.currency)}${fmt(v)}`,
  });
}

// ── AI analysis ───────────────────────────────────────────────────────
async function runAiAnalysis() {
  if (el("aiLoading")) el("aiLoading").style.display = "flex";
  if (el("verdictCard")) el("verdictCard").innerHTML = "";
  const stats = state._stats;

  let analysis = null;
  let source = "simulated";

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: state.ticker,
        currentPrice: stats.lastClose,
        oneYearReturn: stats.yrReturn,
        monthlyChange: stats.monthlyChange,
        avgVolume: stats.avgVol,
        newsHeadlines: state.news.slice(0, 7).map((n) => n.title),
        currency: state.currency,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      if (d.signal && d.forecastCurve) { analysis = d; source = "gemini"; }
    }
  } catch {}

  if (!analysis) {
    const pred = generatePrediction(state.ticker, state.history);
    const factors = generateFactors(state.ticker);
    const advice = getLaymanAdvice(pred, stats.yrReturn);
    analysis = { ...pred, ...advice, factors };
    source = "simulated";
  }

  state.analysis = analysis;
  state.aiSource = source;
  if (el("aiLoading")) el("aiLoading").style.display = "none";
  renderVerdict();
  updateSignalStat();
  renderForecastChart();
  renderFactors();
}

function renderVerdict() {
  const card = el("verdictCard");
  if (!card) return;
  const a = state.analysis;
  const sig = SIGNAL_META[a.signal] || SIGNAL_META.HOLD;
  const impactfulNews = state.news.filter((n) => n.isImpactful);

  let alertHtml = "";
  if (impactfulNews.length) {
    alertHtml = `
      <div class="market-alert">
        <div class="market-alert-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${COLORS.amber}" stroke-width="2.5" stroke-linecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Market Alert
        </div>
        ${impactfulNews.slice(0, 3).map((n) => `<div class="market-alert-item">• ${escapeHtml(n.title)}</div>`).join("")}
      </div>
    `;
  }

  card.innerHTML = `
    <div class="card verdict-card glow">
      <div class="verdict-accent" style="background: linear-gradient(90deg, ${sig.color}66 0%, transparent 100%)"></div>
      <div class="verdict-body">
        <div class="verdict-top">
          <div>
            <div class="verdict-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${COLORS.blue}" stroke-width="2" stroke-linecap="round">
                <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
                <line x1="10" y1="22" x2="14" y2="22"/>
              </svg>
              AI Verdict
            </div>
            <div class="verdict-headline">${escapeHtml(a.adviceHeadline)}</div>
          </div>
          <div class="verdict-signal-col">
            <span class="signal-pill" style="background:${sig.bg}; color:${sig.color}; box-shadow: 0 0 12px ${sig.color}22;">${sig.icon} ${a.signal}</span>
            <div class="conf-bar-row">
              <div class="conf-bar-track"><div class="conf-bar-fill" style="width:${a.confidence}%; background:${sig.color}"></div></div>
              <span class="conf-bar-text">${a.confidence}%</span>
            </div>
          </div>
        </div>
        <p class="verdict-detail">${escapeHtml(a.adviceDetail)}</p>
        <div class="verdict-action">${escapeHtml(a.adviceAction)}</div>
        ${alertHtml}
        <div class="ai-source-line">
          <span class="ai-source-dot" style="background:${state.aiSource === "gemini" ? COLORS.green : COLORS.amber}"></span>
          ${state.aiSource === "gemini" ? "Gemini AI" : "Simulated model"} · Not financial advice
        </div>
      </div>
    </div>
  `;
}

function renderFactors() {
  const a = state.analysis;
  const flist = el("factorsList");
  if (!a || !a.factors || !flist) return;
  const typeStyle = {
    macro: { color: COLORS.blue, bg: "rgba(99,102,241,0.15)" },
    sentiment: { color: COLORS.amber, bg: COLORS.amberDim },
    financial: { color: COLORS.green, bg: COLORS.greenDim },
  };
  flist.innerHTML = a.factors.map((f, i) => {
    const ts = typeStyle[f.type] || typeStyle.macro;
    const pct = Math.min(Math.abs(f.impact) * 10, 100);
    const pos = f.impact >= 0;
    return `
      <div class="factor-item" style="animation-delay:${i * 0.05}s">
        <div class="factor-top">
          <div class="factor-left">
            <span class="factor-type-badge" style="background:${ts.bg}; color:${ts.color}">${f.type}</span>
            <span class="factor-name">${escapeHtml(f.name)}</span>
          </div>
          <span class="factor-impact" style="color:${pos ? COLORS.green : COLORS.red}">${pos ? "+" : ""}${f.impact}</span>
        </div>
        <div class="factor-desc">${escapeHtml(f.desc)}</div>
        <div class="factor-bar-track">
          <div class="factor-bar-fill" style="width:${pct}%; background:linear-gradient(90deg, ${pos ? COLORS.green : COLORS.red}88, ${pos ? COLORS.green : COLORS.red})"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderNews() {
  const card = el("newsCard");
  const list = el("newsList");
  if (!card || !list) return;
  if (!state.news.length) { card.style.display = "none"; return; }
  card.style.display = "block";
  list.innerHTML = state.news.map((a) => `
    <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer" class="news-item ${a.isImpactful ? "impactful" : ""}">
      <div class="news-title">${escapeHtml(a.title)}</div>
      <div class="news-meta">
        ${a.publisher ? `<span>${escapeHtml(a.publisher)}</span>` : ""}
        ${a.publisher && a.pubDate ? `<span style="opacity:0.4">·</span>` : ""}
        ${a.pubDate ? `<span>${new Date(a.pubDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>` : ""}
        ${a.isImpactful ? `<span class="news-impact-badge">IMPACT</span>` : ""}
      </div>
    </a>
  `).join("");
}

// ── Resize handling (mobile-safe: ignores height-only changes) ────────
let resizeDebounce = null;
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    ["priceChart", "volumeChart", "forecastChart"].forEach((id) => {
      const canvas = el(id);
      if (!canvas) return;
      const fn = lastDraw.get(canvas);
      if (fn) fn();
    });
  }, 250);
});

// ── Init ──────────────────────────────────────────────────────────────
loadTicker(state.ticker);
