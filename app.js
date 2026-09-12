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
  gray: "#94A3B8",
  grayDim: "rgba(148,163,184,0.15)",
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

// Stage number -> chart/badge color
const STAGE_COLOR = {
  1: COLORS.gray,
  2: COLORS.green,
  3: COLORS.gray,
  4: COLORS.red,
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
];

const TIMEFRAMES = [
  { label: "6M", range: "6mo", interval: "1wk" },
  { label: "1Y", range: "1y", interval: "1wk" },
  { label: "3Y", range: "3y", interval: "1mo" },
  { label: "5Y", range: "5y", interval: "1mo" },
  { label: "10Y", range: "10y", interval: "1mo" },
];

// ── Stage-grounded fallback (used when Gemini is unavailable) ──────────
// Unlike the old random-PRNG fallback, this is derived entirely from the
// real /api/stage computation — same signal/confidence a person would get
// with Gemini working, just without an AI-written narrative.

function getStageBasedAdvice(stageData) {
  const { stage, priceVsMaPct, maSlopePct } = stageData;
  const side = priceVsMaPct >= 0 ? "above" : "below";
  const slopeDir = maSlopePct >= 0 ? "rising" : "falling";

  const templates = {
    1: {
      adviceHeadline: "Basing — no clear trend yet",
      adviceDetail: `Price is trading sideways, ${Math.abs(priceVsMaPct)}% ${side} a roughly flat 30-week average. This consolidation phase often precedes a bigger move, but the direction isn't confirmed yet.`,
      adviceAction: "Wait for a confirmed breakout above the average before considering a buy.",
    },
    2: {
      adviceHeadline: "Advancing — established uptrend",
      adviceDetail: `Price is ${priceVsMaPct}% above a ${slopeDir} 30-week average, which has moved ${Math.abs(maSlopePct)}% over the last 5 weeks. This is the classic markup phase of a stock's cycle.`,
      adviceAction: "Consider holding or building a position, using the moving average as a trailing reference for risk.",
    },
    3: {
      adviceHeadline: "Topping — momentum is fading",
      adviceDetail: `Price is ${Math.abs(priceVsMaPct)}% ${side} a flattening 30-week average after a prior advance. This distribution phase often precedes a trend reversal.`,
      adviceAction: "Consider taking profits or tightening stops rather than adding to a position here.",
    },
    4: {
      adviceHeadline: "Declining — established downtrend",
      adviceDetail: `Price is ${Math.abs(priceVsMaPct)}% below a ${slopeDir} 30-week average, which has fallen ${Math.abs(maSlopePct)}% over the last 5 weeks. This is the markdown phase of a stock's cycle.`,
      adviceAction: "Avoid new positions; a base typically needs to form before this trend reverses.",
    },
  };
  return templates[stage] || templates[1];
}

function getStageBasedFactors(stageData, ticker) {
  const { priceVsMaPct, maSlopePct } = stageData;
  const rng = seededRandom(tickerSeed(ticker) + 7);

  const realFactors = [
    {
      name: "Price vs 30-week average",
      desc: `Currently ${Math.abs(priceVsMaPct)}% ${priceVsMaPct >= 0 ? "above" : "below"} the average.`,
      type: "financial",
      impact: Math.max(-10, Math.min(10, Math.round(priceVsMaPct / 2))),
    },
    {
      name: "30-week average slope",
      desc: `The average itself is ${maSlopePct >= 0 ? "rising" : "falling"} ${Math.abs(maSlopePct)}% over 5 weeks.`,
      type: "financial",
      impact: Math.max(-10, Math.min(10, Math.round(maSlopePct * 2))),
    },
  ];

  const flavorFactors = [...FACTOR_POOL].sort(() => rng() - 0.5).slice(0, 3).map((f) => ({
    ...f,
    desc: `Simulated context factor for ${ticker}.`,
    impact: Math.round((rng() - 0.4) * 14),
  }));

  return [...realFactors, ...flavorFactors];
}

function generateForecastFromStage(stageData, currentPrice) {
  // Deterministic linear projection from the MA slope — no randomness.
  // maSlopePct is measured over 5 weeks; scale to a monthly drift.
  const weeklyDrift = stageData.maSlopePct / 5 / 100;
  const monthlyDrift = weeklyDrift * 4.33;
  const curve = [currentPrice];
  for (let i = 1; i <= 12; i++) {
    curve.push(Math.round(curve[i - 1] * (1 + monthlyDrift) * 100) / 100);
  }
  return curve;
}

// ── Legacy seeding utils (still used for factor flavor text) ───────────
function tickerSeed(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
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
  stageData: null,
  stageToggles: { sma: true, ema: true },
  statsHistory: [], // fixed ~1-year weekly dataset, independent of the chart's selected timeframe
  trueLastClose: null, // { close, date } from a daily-granularity fetch — see computeStats()
};
let searchDebounce = null;

// ── In-memory cache (tab session only, 30-minute TTL) ───────────────────
// Two stores: chart data varies by ticker+timeframe, everything else
// (news, stage, AI analysis) only varies by ticker.
const CACHE_TTL_MS = 30 * 60 * 1000;
const chartCache = new Map();   // key: "TICKER|range|interval" -> { data, timestamp }
const tickerCache = new Map();  // key: "TICKER" -> { stockName, currency, news, stageData, analysis, aiSource, timestamp, analysisTimestamp }

function isFresh(timestamp) {
  return typeof timestamp === "number" && (Date.now() - timestamp) < CACHE_TTL_MS;
}
function chartCacheKey(ticker, range, interval) {
  return `${ticker}|${range}|${interval}`;
}

// ── Lightweight canvas charting (no external dependency) ───────────────
const lastDraw = new WeakMap();

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;

  // Cache the ORIGINAL intended CSS height in a data-attribute that is
  // never touched again. canvas.height (buffer property) is a *reflected*
  // attribute — setting it also overwrites the "height" content attribute,
  // so re-reading getAttribute("height") on later calls would pick up the
  // previous call's already-scaled buffer size and double it again.
  if (!canvas.dataset.baseHeight) {
    canvas.dataset.baseHeight = canvas.getAttribute("height") || "200";
  }
  const cssHeight = parseInt(canvas.dataset.baseHeight, 10) || 200;

  canvas.style.width = "";
  canvas.style.height = "";

  const rect = parent.getBoundingClientRect();
  const style = getComputedStyle(parent);
  const padH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const cssWidth = Math.max(100, Math.round(rect.width - padH));

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

  const min = values.reduce((a, b) => Math.min(a, b), Infinity);
  const max = values.reduce((a, b) => Math.max(a, b), -Infinity);
  const range = (max - min) || Math.abs(max) || 1;
  const niceMin = min - range * 0.08;
  const niceMax = max + range * 0.08;
  const niceRange = niceMax - niceMin || 1;

  const xAt = (i) => padL + (values.length > 1 ? (i / (values.length - 1)) * plotW : plotW / 2);
  const yAt = (v) => padT + plotH - ((v - niceMin) / niceRange) * plotH;

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

  if (opts.xLabels) {
    ctx.fillStyle = COLORS.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "11px 'JetBrains Mono', monospace";
    opts.xLabels.forEach((label, i) => {
      if (label) ctx.fillText(label, xAt(i), padT + plotH + 5);
    });
  }

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

// Multi-series line chart: price plus any number of toggleable overlay
// lines (e.g. 30-week SMA, 52-week EMA), with a shaded "current stage"
// highlight band over the most recent N points.
// series: [{ values, color, dash: [a,b] or null, width, visible, label, key }]
// The FIRST series in the array is treated as "price" — always drawn,
// always the hover-tracking series, and included in the y-domain always.
// Subsequent series are only drawn/considered for y-domain when visible.
function drawStageChart(canvas, series, opts = {}) {
  lastDraw.set(canvas, () => drawStageChart(canvas, series, opts));
  const { ctx, width: W, height: H } = setupCanvas(canvas);
  ctx.clearRect(0, 0, W, H);
  const priceSeries = series[0];
  const prices = priceSeries.values;
  if (!prices.length) return;

  const padL = 58, padR = 8, padT = 10, padB = 22;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, H - padT - padB);

  const visibleSeries = series.filter((s) => s === priceSeries || s.visible);
  const combined = visibleSeries.flatMap((s) => s.values.filter((v) => v != null));
  const min = combined.reduce((a, b) => Math.min(a, b), Infinity);
  const max = combined.reduce((a, b) => Math.max(a, b), -Infinity);
  const range = (max - min) || Math.abs(max) || 1;
  const niceMin = min - range * 0.08;
  const niceMax = max + range * 0.08;
  const niceRange = niceMax - niceMin || 1;

  const n = prices.length;
  const xAt = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yAt = (v) => padT + plotH - ((v - niceMin) / niceRange) * plotH;

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "12px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = niceMin + (niceRange * i) / 4;
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(W - padR, Math.round(y) + 0.5);
    ctx.stroke();
    if (opts.yFormat) ctx.fillText(opts.yFormat(v), padL - 8, y);
  }

  // "You are here" highlight band over the most recent ~8 points
  if (opts.stageColor) {
    const bandStart = Math.max(0, n - 8);
    ctx.fillStyle = opts.stageColor + "14";
    ctx.fillRect(xAt(bandStart), padT, xAt(n - 1) - xAt(bandStart), plotH);
  }

  // Overlay lines first (drawn underneath price), only if visible
  series.slice(1).forEach((s) => {
    if (!s.visible) return;
    ctx.beginPath();
    let started = false;
    s.values.forEach((v, i) => {
      if (v == null) return;
      const x = xAt(i), y = yAt(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1.6;
    if (s.dash) ctx.setLineDash(s.dash);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // Price line always drawn last (on top)
  ctx.beginPath();
  prices.forEach((v, i) => {
    const x = xAt(i), y = yAt(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = priceSeries.color;
  ctx.lineWidth = priceSeries.width || 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  if (opts.xLabels) {
    ctx.fillStyle = COLORS.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "11px 'JetBrains Mono', monospace";
    opts.xLabels.forEach((label, i) => {
      if (label) ctx.fillText(label, xAt(i), padT + plotH + 5);
    });
  }

  attachHover(canvas, {
    xAt, yAt, values: prices, padL, padT, plotW, plotH,
    tooltipFormat: opts.tooltipFormat, color: priceSeries.color,
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
    // px/py are in CANVAS-local pixel space. The tooltip and crosshair are
    // appended to the canvas's PARENT (so they can render outside the
    // canvas's own clip box), which may have other content — label rows,
    // badges, descriptions — stacked above the canvas. Without adding the
    // canvas's own offset within that parent, the crosshair renders as if
    // the canvas started at the very top of the card.
    const offsetLeft = canvas.offsetLeft;
    const offsetTop = canvas.offsetTop;

    tooltip.style.display = "block";
    tooltip.style.left = (offsetLeft + Math.min(Math.max(px, 40), canvas.clientWidth - 40)) + "px";
    tooltip.style.top = (offsetTop + 2) + "px";
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

  const offsetLeft = canvas.offsetLeft;
  const offsetTop = canvas.offsetTop;

  line.style.display = "block";
  line.style.left = (offsetLeft + px) + "px";
  line.style.top = (offsetTop + cfg.padT) + "px";
  line.style.height = cfg.plotH + "px";

  if (!cfg.isBar) {
    dot.style.display = "block";
    dot.style.left = (offsetLeft + px) + "px";
    dot.style.top = (offsetTop + py) + "px";
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
  state.timeframe = "1y";
  el("content").style.display = "none";
  el("errorBox").style.display = "none";

  const defaultChartKey = chartCacheKey(ticker, "1y", "1wk");
  const cachedChart = chartCache.get(defaultChartKey);
  const cachedMeta = tickerCache.get(ticker);
  const canUseCache = isFresh(cachedChart && cachedChart.timestamp) && isFresh(cachedMeta && cachedMeta.timestamp);

  if (canUseCache) {
    state.history = cachedChart.data.history || [];
    state.statsHistory = cachedChart.data.history || [];
    state.trueLastClose = { close: cachedChart.data.lastClose, date: cachedChart.data.lastCloseDate };
    state.stockName = cachedMeta.stockName;
    state.currency = cachedMeta.currency;
    state.news = cachedMeta.news;
    state.stageData = cachedMeta.stageData;

    renderTickerBar(true);
    if (!state.history.length) {
      el("errorBox").textContent = "No price history available";
      el("errorBox").style.display = "block";
      return;
    }

    el("content").style.display = "flex";
    resetTimeframeButtonsToDefault();
    initTimeframeButtons();
    renderStats();
    renderPriceChart();
    renderVolumeChart();
    renderNews();
    renderStageCard();

    if (isFresh(cachedMeta.analysisTimestamp) && cachedMeta.analysis) {
      state.analysis = cachedMeta.analysis;
      state.aiSource = cachedMeta.aiSource;
      renderVerdict();
      updateSignalStat();
      renderForecastChart();
      renderFactors();
    } else {
      await runAiAnalysis();
    }
    return;
  }

  el("loadingMain").style.display = "flex";
  el("loadingMainText").textContent = `Fetching ${ticker} data…`;

  try {
    const [cRes, nRes, sRes] = await Promise.all([
      fetch(`/api/chart/${ticker}`),
      fetch(`/api/news/${ticker}`),
      fetch(`/api/stage/${ticker}`),
    ]);
    if (!cRes.ok) throw new Error("Failed to load chart data");
    const cData = await cRes.json();
    const nData = nRes.ok ? await nRes.json() : { articles: [] };
    const sData = sRes.ok ? await sRes.json() : null;

    state.history = cData.history || [];
    state.statsHistory = cData.history || [];
    state.trueLastClose = { close: cData.lastClose, date: cData.lastCloseDate };
    state.stockName = cData.name || ticker;
    state.currency = cData.currency || "USD";
    state.news = nData.articles || [];
    state.stageData = sData;

    chartCache.set(defaultChartKey, { data: cData, timestamp: Date.now() });
    tickerCache.set(ticker, {
      stockName: state.stockName,
      currency: state.currency,
      news: state.news,
      stageData: state.stageData,
      timestamp: Date.now(),
      analysis: null,
      aiSource: null,
      analysisTimestamp: 0,
    });

    el("loadingMain").style.display = "none";
    renderTickerBar(false);
    if (!state.history.length) throw new Error("No price history available");

    el("content").style.display = "flex";
    resetTimeframeButtonsToDefault();
    initTimeframeButtons();
    renderStats();
    renderPriceChart();
    renderVolumeChart();
    renderNews();
    renderStageCard();

    await runAiAnalysis();
  } catch (err) {
    el("loadingMain").style.display = "none";
    el("errorBox").textContent = err.message;
    el("errorBox").style.display = "block";
  }
}

function resetTimeframeButtonsToDefault() {
  document.querySelectorAll(".tf-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.range === "1y");
  });
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
// IMPORTANT: these stats must be computed against a FIXED ~1-year dataset
// (state.statsHistory), not whatever timeframe the chart happens to be
// zoomed to (state.history) — the chart's data can be weekly, monthly, or
// span 6 months to 10 years depending on the selected button, so a fixed
// index offset like "13 entries back = 1 year ago" silently breaks: it's
// only true if the data happens to be monthly. Finding the closest point
// by actual date works regardless of the data's granularity.
function closestPointByDaysAgo(history, daysAgo) {
  if (!history.length) return null;
  const lastTime = new Date(history[history.length - 1].date).getTime();
  const targetTime = lastTime - daysAgo * 86400000;
  let closest = history[0];
  let bestDiff = Infinity;
  for (const point of history) {
    const diff = Math.abs(new Date(point.date).getTime() - targetTime);
    if (diff < bestDiff) { bestDiff = diff; closest = point; }
  }
  return closest;
}

function hasEnoughSpanFor(history, daysAgo, toleranceDays) {
  if (history.length < 2) return false;
  const spanDays = (new Date(history[history.length - 1].date) - new Date(history[0].date)) / 86400000;
  return spanDays >= (daysAgo - toleranceDays);
}

function computeStats() {
  const h = (state.statsHistory && state.statsHistory.length) ? state.statsHistory : state.history;
  if (!h.length) return {};
  const weeklyLast = h[h.length - 1];

  // Prefer the accurate daily-fetched last close/date over the weekly bar's
  // tail — a weekly bar is labeled by the START of its period, so its own
  // "last" entry can look several days stale even though the actual close
  // price is current. See /api/chart's lastClose/lastCloseDate fields.
  const hasTrueLast = state.trueLastClose && state.trueLastClose.close != null;
  const lastClose = hasTrueLast ? state.trueLastClose.close : weeklyLast.close;
  const lastDate = hasTrueLast ? state.trueLastClose.date : (weeklyLast.date || "");

  const monthPoint = hasEnoughSpanFor(h, 30, 10) ? closestPointByDaysAgo(h, 30) : null;
  const yearPoint = hasEnoughSpanFor(h, 365, 25) ? closestPointByDaysAgo(h, 365) : null;

  const monthlyChange = (monthPoint && monthPoint.close) ? parseFloat(((lastClose - monthPoint.close) / monthPoint.close * 100).toFixed(2)) : null;
  const yrReturn = (yearPoint && yearPoint.close) ? parseFloat(((lastClose - yearPoint.close) / yearPoint.close * 100).toFixed(2)) : null;

  const monthly = getMonthlyData(h);
  const avgVol = monthly.length ? Math.round(monthly.slice(-12).reduce((s, d) => s + d.volume, 0) / Math.min(monthly.length, 12)) : 0;
  return { lastClose, monthlyChange, yrReturn, avgVol, lastDate };
}

function renderTickerBar(fromCache) {
  el("tickerBar").style.display = "flex";
  el("tickerSymbol").textContent = state.ticker;
  el("tickerName").textContent = state.stockName;
  el("tickerCurrency").textContent = state.currency;
  const cacheEl = el("cacheIndicator");
  if (cacheEl) cacheEl.style.display = fromCache ? "inline" : "none";
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

// ── Market Stage card ────────────────────────────────────────────────
function renderStageCard() {
  const sd = state.stageData;
  const card = el("stageCard");
  if (!sd || !card) { if (card) card.style.display = "none"; return; }
  card.style.display = "block";

  const badge = el("stageBadge");
  badge.className = "stage-badge stage-" + sd.stage;
  badge.textContent = `Stage ${sd.stage} — ${sd.stageLabel}`;

  el("stageDesc").textContent = sd.stageDescription;

  const emaNote = el("stageEmaNote");
  if (emaNote && sd.emaAgreement != null) {
    emaNote.textContent = sd.emaAgreement
      ? "Yearly EMA agrees with this trend — confidence boosted."
      : "Yearly EMA disagrees with this trend — confidence reduced.";
    emaNote.className = "stage-ema-note " + (sd.emaAgreement ? "agree" : "disagree");
  }

  drawStageChartFromState();
  initStageToggles();
}

function drawStageChartFromState() {
  const sd = state.stageData;
  if (!sd) return;
  const canvas = el("stageChart");
  const dates = sd.dates;
  let lastYear = null;
  const xLabels = dates.map((d) => {
    const dt = new Date(d);
    const y = dt.getFullYear();
    if (y !== lastYear) { lastYear = y; return String(y); }
    return "";
  });

  const series = [
    { key: "price", values: sd.closes, color: COLORS.blue, width: 2 },
    { key: "sma", values: sd.ma30, color: COLORS.amber, width: 1.6, dash: [5, 3], visible: state.stageToggles.sma },
    { key: "ema", values: sd.ema52, color: "#A78BFA", width: 1.6, dash: [1, 3], visible: state.stageToggles.ema },
  ];

  drawStageChart(canvas, series, {
    stageColor: STAGE_COLOR[sd.stage],
    yFormat: (v) => currSym(state.currency) + fmtBig(v),
    xLabels,
    tooltipFormat: (v, i) => {
      const parts = [`${dates[i]}  ${currSym(state.currency)}${fmt(v)}`];
      if (state.stageToggles.sma && sd.ma30[i] != null) parts.push(`SMA ${currSym(state.currency)}${fmt(sd.ma30[i])}`);
      if (state.stageToggles.ema && sd.ema52[i] != null) parts.push(`EMA ${currSym(state.currency)}${fmt(sd.ema52[i])}`);
      return parts.join("  ·  ");
    },
  });
}

function initStageToggles() {
  const smaToggle = el("smaToggle");
  const emaToggle = el("emaToggle");
  if (smaToggle) {
    smaToggle.checked = state.stageToggles.sma;
    smaToggle.onchange = () => {
      state.stageToggles.sma = smaToggle.checked;
      drawStageChartFromState();
    };
  }
  if (emaToggle) {
    emaToggle.checked = state.stageToggles.ema;
    emaToggle.onchange = () => {
      state.stageToggles.ema = emaToggle.checked;
      drawStageChartFromState();
    };
  }
}

// ── Timeframe buttons ─────────────────────────────────────────────────
function initTimeframeButtons() {
  const buttons = document.querySelectorAll(".tf-btn");
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", async () => {
      document.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
      newBtn.classList.add("active");
      const range = newBtn.dataset.range;
      const interval = newBtn.dataset.interval;
      state.timeframe = range;

      const key = chartCacheKey(state.ticker, range, interval);
      const cached = chartCache.get(key);
      if (isFresh(cached && cached.timestamp)) {
        state.history = cached.data.history || [];
        renderStats();
        updateSignalStat();
        renderPriceChart();
        renderVolumeChart();
        return;
      }

      try {
        const res = await fetch(`/api/chart/${state.ticker}?range=${range}&interval=${interval}`);
        if (!res.ok) throw new Error("Failed to fetch timeframe");
        const data = await res.json();
        chartCache.set(key, { data, timestamp: Date.now() });
        state.history = data.history || [];
        renderStats();
        updateSignalStat();
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
    tooltipFormat: (v, i) => `${dates[i]} ${currSym(state.currency)}${fmt(v)}`,
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
    tooltipFormat: (v, i) => `${dates[i]} Vol ${fmtBig(v)}`,
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
    tooltipFormat: (v, i) => `${months[i]} ${currSym(state.currency)}${fmt(v)}`,
  });
}

// ── AI analysis ───────────────────────────────────────────────────────
async function runAiAnalysis() {
  if (el("aiLoading")) el("aiLoading").style.display = "flex";
  if (el("verdictCard")) el("verdictCard").innerHTML = "";
  const stats = state._stats;
  const sd = state.stageData;

  let analysis = null;
  let source = "simulated";

  try {
    const body = {
      ticker: state.ticker,
      currentPrice: stats.lastClose,
      oneYearReturn: stats.yrReturn,
      monthlyChange: stats.monthlyChange,
      avgVolume: stats.avgVol,
      newsHeadlines: state.news.slice(0, 7).map((n) => n.title),
      currency: state.currency,
    };
    // Ground the Gemini prompt in the real computed stage, when available.
    if (sd) {
      body.stage = sd.stage;
      body.stageLabel = sd.stageLabel;
      body.priceVsMaPct = sd.priceVsMaPct;
      body.maSlopePct = sd.maSlopePct;
      body.computedSignal = sd.signal;
      body.computedConfidence = sd.confidence;
    }

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const d = await res.json();
      if (d.signal && d.forecastCurve) { analysis = d; source = "gemini"; }
    }
  } catch {}

  if (!analysis) {
    if (sd) {
      // Stage-grounded fallback: real signal/confidence from the math,
      // canned narrative text, deterministic forecast curve.
      const advice = getStageBasedAdvice(sd);
      const factors = getStageBasedFactors(sd, state.ticker);
      const forecastCurve = generateForecastFromStage(sd, stats.lastClose);
      analysis = { signal: sd.signal, confidence: sd.confidence, forecastCurve, ...advice, factors };
    } else {
      // Stage data itself unavailable — last-resort neutral placeholder.
      analysis = {
        signal: "HOLD", confidence: 40,
        forecastCurve: Array(13).fill(stats.lastClose),
        adviceHeadline: "Not enough data for a confident read",
        adviceDetail: "Price history was too limited to compute a reliable technical stage for this ticker.",
        adviceAction: "Try a ticker with more trading history.",
        factors: [],
      };
    }
    source = "simulated";
  }

  state.analysis = analysis;
  state.aiSource = source;

  const cacheEntry = tickerCache.get(state.ticker);
  if (cacheEntry) {
    cacheEntry.analysis = analysis;
    cacheEntry.aiSource = source;
    cacheEntry.analysisTimestamp = Date.now();
  }
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
          ${state.aiSource === "gemini" ? "Gemini AI" : "Computed from Stage Analysis"} · Not financial advice
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
    ["priceChart", "volumeChart", "forecastChart", "stageChart"].forEach((id) => {
      const canvas = el(id);
      if (!canvas) return;
      const fn = lastDraw.get(canvas);
      if (fn) fn();
    });
  }, 250);
});

// ── Init ──────────────────────────────────────────────────────────────
loadTicker(state.ticker);
