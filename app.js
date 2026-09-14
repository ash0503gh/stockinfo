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
  purple: "#A78BFA",
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

const STAGE_COLOR = {
  1: COLORS.gray,
  2: COLORS.green,
  3: COLORS.amber,
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

// Popular peer groups for instant quick-comparison
const PEER_MAP = {
  "TCS.NS": ["INFY.NS", "WIPRO.NS", "HCLTECH.NS"],
  "INFY.NS": ["TCS.NS", "WIPRO.NS", "HCLTECH.NS"],
  "WIPRO.NS": ["TCS.NS", "INFY.NS", "HCLTECH.NS"],
  "HCLTECH.NS": ["TCS.NS", "INFY.NS", "WIPRO.NS"],
  "HDFCBANK.NS": ["ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS"],
  "ICICIBANK.NS": ["HDFCBANK.NS", "SBIN.NS", "AXISBANK.NS"],
  "SBIN.NS": ["HDFCBANK.NS", "ICICIBANK.NS", "PNB.NS"],
  "RELIANCE.NS": ["TCS.NS", "HDFCBANK.NS", "BHARTIARTL.NS"],
  "TATAMOTORS.NS": ["MARUTI.NS", "M&M.NS", "BAJAJ-AUTO.NS"],
  "AAPL": ["MSFT", "GOOGL", "NVDA", "AMZN"],
  "MSFT": ["AAPL", "GOOGL", "NVDA", "AMZN"],
  "NVDA": ["AMD", "INTC", "TSM", "AVGO"],
  "GOOGL": ["MSFT", "META", "AAPL", "AMZN"],
  "TSLA": ["RIVN", "LCID", "F", "GM"],
  "META": ["GOOGL", "SNAP", "MSFT", "AMZN"],
  "AMZN": ["MSFT", "GOOGL", "WMT", "AAPL"],
};

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

// ── In-memory Cache (30-Minute TTL) ───────────────────────────────────
const CACHE_TTL_MS = 30 * 60 * 1000;
const chartCache = new Map();
const tickerCache = new Map();

function isFresh(timestamp) {
  return typeof timestamp === "number" && (Date.now() - timestamp) < CACHE_TTL_MS;
}

// ── State ─────────────────────────────────────────────────────────────
let state = {
  ticker: "AAPL",
  stockName: "",
  currency: "USD",
  history: [],
  statsHistory: [],
  news: [],
  analysis: null,
  stageData: null,
  stageToggles: { sma: true, ema: true },
  aiSource: "simulated",
  staged: null,
  timeframe: "1y",
  trueLastClose: null,
  high52: null,
  low52: null,
};
let searchDebounce = null;

// ── Stage-Grounded Fallback (Deterministic & Technical) ───────────────
function getStageBasedAdvice(stageData, yrRet) {
  const stage = stageData ? stageData.stage : 1;
  const pVsMa = stageData ? stageData.priceVsMaPct : 0;
  const slope = stageData ? stageData.maSlopePct : 0;
  const side = pVsMa >= 0 ? "above" : "below";
  const slopeDir = slope >= 0 ? "rising" : "falling";

  const templates = {
    1: {
      adviceHeadline: "Basing Phase — Accumulation in Progress",
      adviceDetail: `Price is trading sideways (${Math.abs(pVsMa)}% ${side} a flat 30-week average). Institutional accumulation often occurs here, but upside momentum is not yet confirmed.`,
      adviceAction: "Wait for a high-volume breakout above the 30-week moving average before buying.",
    },
    2: {
      adviceHeadline: "Advancing Phase — Strong Uptrend Confirmed",
      adviceDetail: `Price is ${pVsMa}% above a ${slopeDir} 30-week moving average. This is the institutional markup phase where the strongest compounding occurs.`,
      adviceAction: "Hold or add on dips, using the 30-week average as your trailing stop-loss.",
    },
    3: {
      adviceHeadline: "Topping Phase — Momentum is Exhausting",
      adviceDetail: `Price is flattening after an extended rally, trading near an unstable 30-week average. Distribution patterns suggest institutional profit-taking.`,
      adviceAction: "Consider booking partial profits and tightening stop-losses; avoid fresh entries.",
    },
    4: {
      adviceHeadline: "Declining Phase — Severe Downtrend in Place",
      adviceDetail: `Price is ${Math.abs(pVsMa)}% below a falling 30-week average. The stock is in a persistent markdown phase with high risk of capital erosion.`,
      adviceAction: "Avoid buying or catch falling knives until a sound base (Stage 1) establishes.",
    },
  };
  return templates[stage] || templates[1];
}

function generateForecastFromStage(stageData, currentPrice) {
  const slope = stageData ? stageData.maSlopePct : 0;
  const monthlyDrift = (slope / 5 / 100) * 4.33;
  const clampedDrift = Math.max(-0.04, Math.min(0.04, monthlyDrift));
  const curve = [currentPrice];
  for (let i = 1; i <= 12; i++) {
    curve.push(Math.round(curve[i - 1] * (1 + clampedDrift) * 100) / 100);
  }
  return curve;
}

function generateFactorsFromStage(stageData, ticker) {
  if (!stageData) return [];
  const { priceVsMaPct, maSlopePct, stage } = stageData;
  return [
    {
      name: "Price vs 30-Week Average",
      desc: `Currently ${Math.abs(priceVsMaPct)}% ${priceVsMaPct >= 0 ? "above" : "below"} the institutional baseline.`,
      type: "financial",
      impact: Math.max(-10, Math.min(10, Math.round(priceVsMaPct / 2))),
    },
    {
      name: "Moving Average Trend Slope",
      desc: `The 30-week average is ${maSlopePct >= 0 ? "rising" : "falling"} ${Math.abs(maSlopePct)}% over the last 5 weeks.`,
      type: "financial",
      impact: Math.max(-10, Math.min(10, Math.round(maSlopePct * 2))),
    },
    {
      name: "Market Cycle Stage",
      desc: `Classified as Stage ${stage} (${stageData.stageLabel}) in the Weinstein cycle.`,
      type: "macro",
      impact: stage === 2 ? 8 : stage === 4 ? -8 : 1,
    },
    {
      name: "Institutional EMA Agreement",
      desc: stageData.emaAgreement ? "Yearly 52-week EMA confirms the directional trend." : "52-week EMA diverges from shorter trend.",
      type: "sentiment",
      impact: stageData.emaAgreement ? 5 : -4,
    }
  ];
}

// ── Lightweight Canvas Charting Engine ────────────────────────────────
const lastDraw = new WeakMap();

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;

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

  // Grid lines & Y labels
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

  // Reference line
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

  // Price Line
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

  // X Labels
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

// ── Multi-Line Stage Chart (Price + 30W SMA + 52W EMA) ───────────────
function drawStageChart(canvas, stageData) {
  if (!stageData || !stageData.closes || !stageData.closes.length) return;
  lastDraw.set(canvas, () => drawStageChart(canvas, stageData));

  const { ctx, width: W, height: H } = setupCanvas(canvas);
  ctx.clearRect(0, 0, W, H);

  const { closes, ma30, ema52, dates } = stageData;
  const padL = 58, padR = 8, padT = 10, padB = 22;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, H - padT - padB);

  // Determine global min and max across price, SMA, and EMA
  let allVals = [...closes];
  if (state.stageToggles.sma) allVals = allVals.concat(ma30.filter(v => v != null));
  if (state.stageToggles.ema) allVals = allVals.concat(ema52.filter(v => v != null));

  const min = allVals.reduce((a, b) => Math.min(a, b), Infinity);
  const max = allVals.reduce((a, b) => Math.max(a, b), -Infinity);
  const range = (max - min) || Math.abs(max) || 1;
  const niceMin = min - range * 0.08;
  const niceMax = max + range * 0.08;
  const niceRange = niceMax - niceMin || 1;

  const xAt = (i) => padL + (closes.length > 1 ? (i / (closes.length - 1)) * plotW : plotW / 2);
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
    ctx.fillText(currSym(state.currency) + fmtBig(v), padL - 8, y);
  }

  // 1. Draw 52W EMA line (Purple)
  if (state.stageToggles.ema) {
    ctx.beginPath();
    ema52.forEach((v, i) => {
      if (v == null) return;
      const x = xAt(i), y = yAt(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLORS.purple;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // 2. Draw 30W SMA line (Amber)
  if (state.stageToggles.sma) {
    ctx.beginPath();
    let started = false;
    ma30.forEach((v, i) => {
      if (v == null) return;
      const x = xAt(i), y = yAt(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 3. Draw Price Line (Blue)
  ctx.beginPath();
  closes.forEach((v, i) => {
    const x = xAt(i), y = yAt(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = COLORS.blue;
  ctx.lineWidth = 2;
  ctx.stroke();

  // X date labels
  const n = dates.length;
  const step = Math.max(1, Math.floor(n / 5));
  ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "11px 'JetBrains Mono', monospace";
  dates.forEach((d, i) => {
    if (i % step === 0 || i === n - 1) {
      const dt = new Date(d);
      const mon = dt.toLocaleString("en", { month: "short" });
      const yr = "'" + String(dt.getFullYear()).slice(-2);
      ctx.fillText(`${mon} ${yr}`, xAt(i), padT + plotH + 5);
    }
  });

  // Attach hover for Stage Chart
  attachHover(canvas, {
    xAt, yAt, values: closes, padL, padT, plotW, plotH, color: COLORS.blue,
    tooltipFormat: (v, i) => {
      let txt = `${dates[i]}  Price: ${currSym(state.currency)}${fmt(v)}`;
      if (state.stageToggles.sma && ma30[i] != null) txt += ` · 30W SMA: ${fmt(ma30[i])}`;
      if (state.stageToggles.ema && ema52[i] != null) txt += ` · 52W EMA: ${fmt(ema52[i])}`;
      return txt;
    }
  });
}

// ── Hover & Crosshair (DOM Overlays, Offset-Accurate) ─────────────────
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

// ── DOM References ────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const searchInput = el("searchInput");
const searchDropdown = el("searchDropdown");
const searchInputWrap = document.querySelector(".search-input-wrap");
const stagedDot = el("stagedDot");
const applyBtn = el("applyBtn");

// ── Search Handlers ───────────────────────────────────────────────────
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

// ── Core Data Loading with In-Memory Caching ──────────────────────────
async function loadTicker(ticker) {
  state.ticker = ticker;
  el("content").style.display = "none";
  el("errorBox").style.display = "none";
  el("loadingMain").style.display = "flex";
  el("loadingMainText").textContent = `Analyzing ${ticker}…`;

  const chartKey = `${ticker}|${state.timeframe}|1wk`;
  const cachedChart = chartCache.get(chartKey);
  const cachedMeta = tickerCache.get(ticker);

  const canUseCache = cachedChart && isFresh(cachedChart.timestamp) && cachedMeta && isFresh(cachedMeta.timestamp);

  if (canUseCache) {
    state.history = cachedChart.data.history || [];
    state.statsHistory = cachedChart.data.history || [];
    state.trueLastClose = { close: cachedChart.data.lastClose, date: cachedChart.data.lastCloseDate };
    state.high52 = cachedChart.data.high52;
    state.low52 = cachedChart.data.low52;
    state.stockName = cachedMeta.stockName;
    state.currency = cachedMeta.currency;
    state.news = cachedMeta.news;
    state.stageData = cachedMeta.stageData;
    state.analysis = cachedMeta.analysis;
    state.aiSource = cachedMeta.aiSource;

    el("loadingMain").style.display = "none";
    renderAllUI();
    return;
  }

  try {
    const [cRes, sRes, nRes] = await Promise.all([
      fetch(`/api/chart/${ticker}?range=1y&interval=1wk`),
      fetch(`/api/stage/${ticker}`),
      fetch(`/api/news/${ticker}`),
    ]);

    if (!cRes.ok) throw new Error("Failed to load chart data");
    const cData = await cRes.json();
    const sData = sRes.ok ? await sRes.json() : null;
    const nData = nRes.ok ? await nRes.json() : { articles: [] };

    state.history = cData.history || [];
    state.statsHistory = cData.history || [];
    state.trueLastClose = { close: cData.lastClose, date: cData.lastCloseDate };
    state.high52 = cData.high52;
    state.low52 = cData.low52;
    state.stockName = cData.name || ticker;
    state.currency = cData.currency || "USD";
    state.news = nData.articles || [];
    state.stageData = sData;

    // Cache the raw chart data
    chartCache.set(chartKey, { data: cData, timestamp: Date.now() });

    el("loadingMain").style.display = "none";
    if (!state.history.length) throw new Error("No price history available");

    renderAllUI();
    await runAiAnalysis();

    // Cache full ticker metadata
    tickerCache.set(ticker, {
      stockName: state.stockName,
      currency: state.currency,
      news: state.news,
      stageData: state.stageData,
      analysis: state.analysis,
      aiSource: state.aiSource,
      timestamp: Date.now()
    });

  } catch (err) {
    el("loadingMain").style.display = "none";
    el("errorBox").textContent = err.message || "Error loading stock";
    el("errorBox").style.display = "block";
  }
}

function renderAllUI() {
  el("content").style.display = "flex";
  renderTickerBar();
  renderPeerChips();
  renderRangeBar();
  renderStats();
  renderStageCard();
  renderKeyLevels();
  initTimeframeButtons();
  renderPriceChart();
  renderVolumeChart();
  renderNews();
}

// ── Render Ticker Bar & Peer Chips ────────────────────────────────────
function renderTickerBar() {
  el("tickerBar").style.display = "flex";
  el("tickerSymbol").textContent = state.ticker;
  el("tickerName").textContent = state.stockName;
  el("tickerCurrency").textContent = state.currency;
}

function renderPeerChips() {
  const container = el("peerChips");
  if (!container) return;

  let peers = PEER_MAP[state.ticker];
  if (!peers) {
    // Contextual fallback: if Indian stock, suggest top leaders; if US, suggest US tech
    if (state.ticker.endsWith(".NS") || state.ticker.endsWith(".BO")) {
      peers = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS"].filter(t => t !== state.ticker);
    } else {
      peers = ["AAPL", "MSFT", "NVDA"].filter(t => t !== state.ticker);
    }
  }

  container.innerHTML = peers.map(p => `
    <button class="peer-chip" data-peer="${escapeHtml(p)}">${escapeHtml(p.replace(/\.(NS|BO)/, ""))}</button>
  `).join("");

  container.querySelectorAll(".peer-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      loadTicker(btn.dataset.peer);
    });
  });
}

// ── Render 52-Week Range Bar ──────────────────────────────────────────
function renderRangeBar() {
  const card = el("rangeBarCard");
  if (!card) return;

  const current = state.trueLastClose ? state.trueLastClose.close : (state.history.length ? state.history[state.history.length - 1].close : null);
  const low = state.low52;
  const high = state.high52;

  if (current == null || low == null || high == null || high <= low) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));

  el("range52Low").textContent = `${currSym(state.currency)}${fmt(low)}`;
  el("range52High").textContent = `${currSym(state.currency)}${fmt(high)}`;
  el("rangeCurrentLbl").textContent = `Current: ${currSym(state.currency)}${fmt(current)}`;
  el("rangeBarBadge").textContent = `${pct.toFixed(0)}% of 52W Range`;
  el("rangeFill").style.width = `${pct}%`;
  el("rangePin").style.left = `${pct}%`;
}

// ── Render Market Stage Cycle Card (Weinstein Analysis) ───────────────
function renderStageCard() {
  const card = el("stageCard");
  const s = state.stageData;
  if (!card || !s) {
    if (card) card.style.display = "none";
    return;
  }

  card.style.display = "block";

  // 1. Stage Badge & Stepper
  const badge = el("stageBadge");
  badge.textContent = `Stage ${s.stage}: ${s.stageLabel}`;
  badge.style.color = STAGE_COLOR[s.stage] || COLORS.gray;
  badge.style.background = (STAGE_COLOR[s.stage] || COLORS.gray) + "22";

  document.querySelectorAll("#stageStepper .step-pill").forEach(pill => {
    const stepNum = parseInt(pill.dataset.step, 10);
    pill.classList.toggle("active", stepNum === s.stage);
  });

  // 2. Explanations
  el("stageDesc").textContent = s.stageDescription;

  const emaNote = el("stageEmaNote");
  if (s.emaAgreement) {
    emaNote.className = "stage-ema-note agree";
    emaNote.textContent = `✓ High Conviction: 52-week (yearly) EMA aligns with the 30-week trend (${s.priceVsEmaPct >= 0 ? "above" : "below"} average).`;
  } else {
    emaNote.className = "stage-ema-note disagree";
    emaNote.textContent = `⚠ Caution: 52-week EMA diverges from the 30-week trend. Market is in transition.`;
  }

  // 3. Stage Chart
  const canvas = el("stageChart");
  drawStageChart(canvas, s);

  // 4. Toggle listeners (bind once)
  const smaToggle = el("smaToggle");
  const emaToggle = el("emaToggle");
  if (smaToggle && !smaToggle._bound) {
    smaToggle._bound = true;
    smaToggle.addEventListener("change", () => {
      state.stageToggles.sma = smaToggle.checked;
      drawStageChart(canvas, state.stageData);
    });
  }
  if (emaToggle && !emaToggle._bound) {
    emaToggle._bound = true;
    emaToggle.addEventListener("change", () => {
      state.stageToggles.ema = emaToggle.checked;
      drawStageChart(canvas, state.stageData);
    });
  }
}

// ── Render Key Levels & Action Plan ───────────────────────────────────
function renderKeyLevels() {
  const card = el("levelsCard");
  const s = state.stageData;
  if (!card || !s) {
    if (card) card.style.display = "none";
    return;
  }

  card.style.display = "block";

  el("levelSupport").textContent = `${currSym(state.currency)}${fmt(s.support)}`;
  el("levelSupportDist").textContent = `Safety Cushion: -${s.downsidePct}% downside`;

  el("levelResistance").textContent = `${currSym(state.currency)}${fmt(s.resistance)}`;
  el("levelResistanceDist").textContent = `Upside Target: +${s.upsidePct}%`;

  el("riskRewardBadge").textContent = `R:R  1 : ${s.riskReward}`;

  // Smart action scenario advice
  const buyEl = el("scenarioBuy");
  const holdEl = el("scenarioHold");

  if (s.stage === 2) {
    buyEl.textContent = `Setup favors breakout continuation. Look to accumulate above ${currSym(state.currency)}${fmt(s.resistance)} or on pullbacks near support at ${currSym(state.currency)}${fmt(s.support)}.`;
    holdEl.textContent = `Maintain long positions. Trail your protective stop-loss just beneath support around ${currSym(state.currency)}${fmt(s.support * 0.98)}.`;
  } else if (s.stage === 4) {
    buyEl.textContent = `High risk of capital erosion. Avoid aggressive long entries until a confirmed accumulation base forms.`;
    holdEl.textContent = `Downside momentum is active. Consider trimming exposure or setting tight stop-losses near resistance at ${currSym(state.currency)}${fmt(s.resistance)}.`;
  } else {
    buyEl.textContent = `Stock is consolidating sideways. Wait for price to decisively breach ${currSym(state.currency)}${fmt(s.resistance)} with heavy volume before entering.`;
    holdEl.textContent = `Hold existing core positions. Expect chop between ${currSym(state.currency)}${fmt(s.support)} and ${currSym(state.currency)}${fmt(s.resistance)}.`;
  }
}

// ── Monthly Aggregation & Calendar-Days Accurate Stats ────────────────
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

function computeStats() {
  const h = state.statsHistory.length ? state.statsHistory : state.history;
  if (!h.length) return {};

  const monthly = getMonthlyData(h);
  const lastClose = state.trueLastClose ? state.trueLastClose.close : h[h.length - 1].close;
  const lastDate = state.trueLastClose ? state.trueLastClose.date : h[h.length - 1].date;

  const monthPoint = closestPointByDaysAgo(h, 30);
  const yrPoint = closestPointByDaysAgo(h, 365);

  const monthlyChange = monthPoint && monthPoint.close
    ? parseFloat(((lastClose - monthPoint.close) / monthPoint.close * 100).toFixed(2))
    : null;

  const yrReturn = yrPoint && yrPoint.close
    ? parseFloat(((lastClose - yrPoint.close) / yrPoint.close * 100).toFixed(2))
    : null;

  const avgVol = monthly.length
    ? Math.round(monthly.slice(-12).reduce((s, d) => s + d.volume, 0) / Math.min(monthly.length, 12))
    : 0;

  return { lastClose, monthlyChange, yrReturn, avgVol, lastDate };
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

// ── Timeframe Buttons ─────────────────────────────────────────────────
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

      const chartKey = `${state.ticker}|${range}|${interval}`;
      const cached = chartCache.get(chartKey);
      if (cached && isFresh(cached.timestamp)) {
        state.history = cached.data.history || [];
        renderPriceChart();
        renderVolumeChart();
        return;
      }

      try {
        const res = await fetch(`/api/chart/${state.ticker}?range=${range}&interval=${interval}`);
        if (!res.ok) throw new Error("Failed to fetch timeframe");
        const data = await res.json();
        state.history = data.history || [];
        chartCache.set(chartKey, { data, timestamp: Date.now() });
        renderPriceChart();
        renderVolumeChart();
      } catch (err) {
        console.error("Timeframe fetch error:", err);
      }
    });
  });
}

// ── Render Charts ─────────────────────────────────────────────────────
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

// ── AI Analysis (Gemini with Stage-Grounded Fallback) ─────────────────
async function runAiAnalysis() {
  if (el("aiLoading")) el("aiLoading").style.display = "flex";
  if (el("verdictCard")) el("verdictCard").innerHTML = "";
  const stats = state._stats;
  const s = state.stageData;

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
        newsHeadlines: state.news.slice(0, 10).map((n) => n.title),
        currency: state.currency,
        stage: s ? s.stage : undefined,
        stageLabel: s ? s.stageLabel : undefined,
        priceVsMaPct: s ? s.priceVsMaPct : undefined,
        computedSignal: s ? s.signal : undefined,
        computedConfidence: s ? s.confidence : undefined,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      if (d.signal && d.forecastCurve) { analysis = d; source = "gemini"; }
    }
  } catch {}

  if (!analysis) {
    const advice = getStageBasedAdvice(s, stats.yrReturn);
    const factors = generateFactorsFromStage(s, state.ticker);
    const forecastCurve = generateForecastFromStage(s, stats.lastClose);
    analysis = {
      signal: s ? s.signal : "HOLD",
      confidence: s ? s.confidence : 60,
      forecastCurve,
      ...advice,
      factors,
    };
    source = "stage-model";
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
              AI Research Verdict
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
          <span class="ai-source-dot" style="background:${state.aiSource === "gemini" ? COLORS.green : COLORS.cyan}"></span>
          ${state.aiSource === "gemini" ? "Gemini AI" : "Stan Weinstein Cycle Model"} · Not financial advice
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

// ── Mobile-Safe Resize Handler ────────────────────────────────────────
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

// ── Initialize App ────────────────────────────────────────────────────
loadTicker(state.ticker);
