// ── Design tokens ("Private Ledger" light theme; mirrors style.css) ────
const COLORS = {
  ink: "#1C1B18",
  ink2: "#3B3832",
  mute: "#7B7466",
  faint: "#A39C8E",
  grid: "rgba(28,27,24,0.08)",
  brass: "#A67C3D",
  forest: "#1F6A46",
  oxblood: "#9A2B22",
};
const CHART_FONT = "500 11px Inter, -apple-system, sans-serif";

const SIGNAL_META = {
  "BUY":  { color: COLORS.forest, cls: "sig-buy", word: "Buy" },
  "HOLD": { color: COLORS.brass, cls: "sig-hold", word: "Hold" },
  "SELL": { color: COLORS.oxblood, cls: "sig-sell", word: "Sell" },
};

const STAGE_COLOR = {
  1: COLORS.mute,
  2: COLORS.forest,
  3: COLORS.brass,
  4: COLORS.oxblood,
};
const ROMAN = ["", "I", "II", "III", "IV"];

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
  { label: "6M", range: "6mo", interval: "1d" },
  { label: "1Y", range: "1y", interval: "1d" },
  { label: "3Y", range: "3y", interval: "1wk" },
  { label: "5Y", range: "5y", interval: "1wk" },
  { label: "10Y", range: "10y", interval: "1wk" },
];

// ── Utility ───────────────────────────────────────────────────────────
const fmt = (n, d = 2) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
const fmtBig = (n) => {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
};
const fmtAxis = (v) => Math.abs(v) >= 100000 ? fmtBig(v) : fmt(v, Math.abs(v) >= 100 ? 0 : 2);
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
  exchange: "",
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
      adviceHeadline: "Bottoming Out — Price Moving Sideways",
      adviceDetail: `The stock is moving sideways (${Math.abs(pVsMa)}% ${side} its 30-week average). The price is trying to stabilize and form a floor, but a clear upward trend has not started yet.`,
      adviceAction: "Wait for the stock to clearly break upward with strong trading activity before buying.",
    },
    2: {
      adviceHeadline: "Healthy Uptrend — Strong Buyer Demand",
      adviceDetail: `The stock is trading ${pVsMa}% above its ${slopeDir} 30-week average. Buyers are in control, and the stock is showing steady upward momentum.`,
      adviceAction: "A good time to hold or add shares whenever the price dips slightly.",
    },
    3: {
      adviceHeadline: "Cooling Off — Upward Momentum Is Fading",
      adviceDetail: `After a strong run, the price is flattening out near its highs. Investors are starting to take profits off the table rather than buying aggressively.`,
      adviceAction: "Consider locking in some profits and avoid rushing to buy more at this level.",
    },
    4: {
      adviceHeadline: "Downtrend Alert — Heavy Selling Pressure",
      adviceDetail: `The stock is trading ${Math.abs(pVsMa)}% below its falling 30-week average. The price has been steadily declining, and buying now carries a high risk of losing money.`,
      adviceAction: "Avoid buying until the stock stops falling and shows signs of stabilizing.",
    },
  };
  return templates[stage] || templates[1];
}


function generateFactorsFromStage(stageData, ticker) {
  if (!stageData) return [];
  const { priceVsMaPct, maSlopePct, stage } = stageData;
  return [
    {
      name: "Price vs 30-Week Average",
      desc: `Currently ${Math.abs(priceVsMaPct)}% ${priceVsMaPct >= 0 ? "above" : "below"} its long-term average price.`,
      type: "financial",
      impact: Math.max(-10, Math.min(10, Math.round(priceVsMaPct / 2))),
    },
    {
      name: "Trend Direction (Slope)",
      desc: `The 30-week trend is ${maSlopePct >= 0 ? "heading up" : "heading down"} ${Math.abs(maSlopePct)}% over the last 5 weeks.`,
      type: "financial",
      impact: Math.max(-10, Math.min(10, Math.round(maSlopePct * 2))),
    },
    {
      name: "Market Cycle Stage",
      desc: `Currently in Stage ${stage} (${stageData.stageLabel}) of the market cycle.`,
      type: "macro",
      impact: stage === 2 ? 8 : stage === 4 ? -8 : 1,
    },
    {
      name: "1-Year Trend Agreement",
      desc: stageData.emaAgreement ? "The 1-year long-term moving average confirms this trend direction." : "The 1-year long-term average shows mixed signals against the shorter trend.",
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
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.fillStyle = COLORS.mute;
  ctx.font = CHART_FONT;
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
  ctx.setLineDash([]);

  // Reference line
  if (opts.refValue != null) {
    const y = yAt(opts.refValue);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.mute;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.restore();
  }

  // Labelled reference lines (e.g. year high / year low), only when inside the plotted range
  (opts.refLines || []).forEach(({ value, label }) => {
    if (value == null || value < niceMin || value > niceMax) return;
    const y = Math.round(yAt(value)) + 0.5;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(166,124,61,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.brass;
    ctx.font = "600 9.5px Inter, -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, W - padR, y - 3);
    ctx.restore();
  });

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
  ctx.strokeStyle = opts.color || COLORS.ink;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // X Labels
  if (opts.xLabels) {
    ctx.fillStyle = COLORS.mute;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = CHART_FONT;
    opts.xLabels.forEach((label, i) => {
      if (label) drawXLabel(ctx, label, xAt(i), padT + plotH + 6, padL, W - padR);
    });
  }

  attachHover(canvas, { xAt, yAt, values, padL, padT, plotW, plotH, tooltipFormat: opts.tooltipFormat, color: opts.color || COLORS.ink });
}

// Centered axis label, nudged inward so it never clips at the plot edges.
function drawXLabel(ctx, label, x, y, minX, maxX) {
  const half = ctx.measureText(label).width / 2;
  ctx.textAlign = "center";
  ctx.fillText(label, Math.min(Math.max(x, minX + half), maxX - half), y);
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

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.fillStyle = COLORS.mute;
  ctx.font = CHART_FONT;
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
  ctx.setLineDash([]);

  values.forEach((v, i) => {
    const x = padL + i * (plotW / values.length) + barGap / 2;
    const h = (v / max) * plotH;
    const y = padT + plotH - h;
    ctx.fillStyle = colors[i] || COLORS.ink;
    const r = Math.min(2, barW / 2);
    roundRectTop(ctx, x, y, barW, h, r);
    ctx.fill();
  });

  attachHover(canvas, {
    xAt: (i) => padL + i * (plotW / values.length) + (plotW / values.length) / 2,
    yAt: (v) => padT + plotH - (v / max) * plotH,
    values, padL, padT, plotW, plotH,
    tooltipFormat: opts.tooltipFormat, color: COLORS.ink, isBar: true,
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
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.fillStyle = COLORS.mute;
  ctx.font = CHART_FONT;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = niceMin + (niceRange * i) / 4;
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(W - padR, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText(currSym(state.currency) + fmtAxis(v), padL - 8, y);
  }
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 1. 52W EMA (dotted, muted)
  if (state.stageToggles.ema) {
    ctx.beginPath();
    ema52.forEach((v, i) => {
      if (v == null) return;
      const x = xAt(i), y = yAt(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.setLineDash([1, 4]);
    ctx.strokeStyle = COLORS.mute;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 2. 30W SMA (brass)
  if (state.stageToggles.sma) {
    ctx.beginPath();
    let started = false;
    ma30.forEach((v, i) => {
      if (v == null) return;
      const x = xAt(i), y = yAt(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLORS.brass;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 3. Price (ink)
  ctx.beginPath();
  closes.forEach((v, i) => {
    const x = xAt(i), y = yAt(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // X date labels
  const n = dates.length;
  const step = Math.max(1, Math.floor(n / (W < 500 ? 4 : 5)));
  ctx.fillStyle = COLORS.mute;
  ctx.textBaseline = "top";
  ctx.font = CHART_FONT;
  dates.forEach((d, i) => {
    if ((i % step === 0 && (n - 1 - i) >= Math.floor(step * 0.75)) || i === n - 1) {
      const dt = new Date(d);
      const mon = dt.toLocaleString("en", { month: "short" });
      const yr = "'" + String(dt.getFullYear()).slice(-2);
      drawXLabel(ctx, `${mon} ${yr}`, xAt(i), padT + plotH + 6, padL, W - padR);
    }
  });

  // Attach hover for Stage Chart
  attachHover(canvas, {
    xAt, yAt, values: closes, padL, padT, plotW, plotH, color: COLORS.ink,
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

    tooltip.textContent = cfg.tooltipFormat ? cfg.tooltipFormat(v, idx) : String(v);
    tooltip.style.display = "block";
    // Measure on one line, wrap only if wider than the chart, then center on the point without leaving the chart.
    tooltip.style.whiteSpace = "nowrap";
    tooltip.style.width = "";
    tooltip.style.left = "0px";
    const wrapW = canvas.parentElement.clientWidth;
    let tipW = tooltip.offsetWidth;
    if (tipW > wrapW) {
      tooltip.style.whiteSpace = "normal";
      tooltip.style.width = wrapW + "px";
      tipW = wrapW;
    }
    tooltip.style.left = Math.max(0, Math.min(offsetLeft + px - tipW / 2, wrapW - tipW)) + "px";
    tooltip.style.top = (offsetTop + 2) + "px";

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
    line.style.cssText = "position:absolute;border-left:1px dashed rgba(28,27,24,0.3);pointer-events:none;display:none;z-index:10;";
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
    dot.style.background = cfg.color || COLORS.ink;
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
  state.timeframe = "1y";
  document.querySelectorAll(".tf-btn").forEach(b => b.classList.toggle("active", b.dataset.range === "1y"));
  el("content").style.display = "none";
  el("tickerBar").style.display = "none";
  el("errorBox").style.display = "none";
  el("loadingMain").style.display = "flex";
  el("loadingMainText").textContent = `Analyzing ${ticker}…`;

  const chartKey = `${ticker}|1y|1d`;
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
    state.exchange = cachedChart.data.exchange || "";
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
      fetch(`/api/chart/${ticker}?range=1y&interval=1d`),
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
    state.exchange = cData.exchange || "";
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
  updateWatchlistStar();
  renderRangeBar();
  renderStats();
  renderStageCard();
  renderKeyLevels();
  initTimeframeButtons();
  renderPriceChart();
  renderVolumeChart();
  renderNews();
  if (state.analysis) {
    renderVerdict();
    updateSignalStat();
    renderFactors();
  }
}

// ── Render Ticker Bar ────────────────────────────────────────────────
function renderTickerBar() {
  el("tickerBar").style.display = "flex";
  el("tickerExchange").textContent = state.exchange || "";
  el("tickerSymbol").textContent = state.ticker.replace(/\.(NS|BO)$/, "");
  el("tickerCurrency").textContent = state.currency;
  el("tickerName").textContent = state.stockName;
}

function renderMastDate() {
  const d = new Date();
  const wd = d.toLocaleString("en-US", { weekday: "short" });
  const mon = d.toLocaleString("en-US", { month: "short" });
  el("mastDate").textContent = `${wd} · ${d.getDate()} ${mon} ${d.getFullYear()}`;
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
  const sym = currSym(state.currency);

  el("range52Low").textContent = `${sym}${fmt(low)}`;
  el("range52High").textContent = `${sym}${fmt(high)}`;
  const lbl = el("rangeCurrentLbl");
  lbl.textContent = `${sym}${fmt(current)}`;
  lbl.style.left = `${Math.min(Math.max(pct, 7), 93)}%`;

  const where = pct >= 75 ? "close to the high" : pct <= 25 ? "close to the low" : "roughly midway";
  el("rangeBarBadge").textContent = `Trading at ${pct.toFixed(0)}% of its one-year range, ${where}.`;
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

  // 1. Stage heading & stepper
  el("stageBadge").textContent = `Stage ${ROMAN[s.stage] || s.stage} — ${s.stageLabel}`;
  el("stageStepper").style.setProperty("--stage-color", STAGE_COLOR[s.stage] || COLORS.mute);
  const pvm = el("stagePvm");
  pvm.textContent = `${s.priceVsMaPct >= 0 ? "+" : ""}${s.priceVsMaPct}% vs 30-wk avg`;
  pvm.style.color = s.priceVsMaPct >= 0 ? COLORS.forest : COLORS.oxblood;

  document.querySelectorAll("#stageStepper .step-pill").forEach(pill => {
    const stepNum = parseInt(pill.dataset.step, 10);
    pill.classList.toggle("active", stepNum === s.stage);
  });

  // 2. Explanations
  el("stageDesc").textContent = s.stageDescription;

  const emaNote = el("stageEmaNote");
  if (s.emaAgreement) {
    emaNote.className = "stage-ema-note agree";
    emaNote.textContent = `✓ Strong Trend Alignment: The 1-year long-term trend confirms the current direction (${s.priceVsEmaPct >= 0 ? "above" : "below"} average).`;
  } else {
    emaNote.className = "stage-ema-note disagree";
    emaNote.textContent = `⚠ Mixed Signals: The 1-year long-term trend differs from the recent move. Market is in transition.`;
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
  el("levelSupportDist").textContent = `${s.downsidePct}% below today`;

  el("levelResistance").textContent = `${currSym(state.currency)}${fmt(s.resistance)}`;
  el("levelResistanceDist").textContent = `${s.upsidePct}% above today`;

  el("riskRewardBadge").innerHTML = `Risk to reward <b>1 : ${escapeHtml(String(s.riskReward))}</b>`;

  // Smart action scenario advice
  const buyEl = el("scenarioBuy");
  const holdEl = el("scenarioHold");

  if (s.stage === 2) {
    buyEl.textContent = `Strong upward trend. Good time to buy if the price breaks above the ceiling at ${currSym(state.currency)}${fmt(s.resistance)}, or if it dips near the floor at ${currSym(state.currency)}${fmt(s.support)}.`;
    holdEl.textContent = `Hold your shares and let profits grow. You can keep a safety exit just under the floor around ${currSym(state.currency)}${fmt(s.support * 0.98)} to protect your gains.`;
  } else if (s.stage === 4) {
    buyEl.textContent = `High risk of losing money. Avoid buying new shares until the stock stops falling and stabilizes.`;
    holdEl.textContent = `Selling pressure remains high. Consider selling some shares to protect your capital, or keep a strict safety exit near ${currSym(state.currency)}${fmt(s.resistance)}.`;
  } else if (s.stage === 3) {
    buyEl.textContent = `The rally is slowing down near recent highs. Avoid rushing to buy until a clear upward direction resumes.`;
    holdEl.textContent = `Consider locking in some profits. Keep a close safety exit near the floor at ${currSym(state.currency)}${fmt(s.support)}.`;
  } else {
    buyEl.textContent = `The stock is moving sideways and trying to form a bottom. Wait for the price to clearly break above the ceiling at ${currSym(state.currency)}${fmt(s.resistance)} before buying.`;
    holdEl.textContent = `Hold your current shares if you already own them. Expect the price to bounce between ${currSym(state.currency)}${fmt(s.support)} and ${currSym(state.currency)}${fmt(s.resistance)}.`;
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

function fmtLongDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function renderStats() {
  const stats = computeStats();
  state._stats = stats;
  const signed = (v) => `${v >= 0 ? "+" : ""}${v}%`;
  const tone = (v) => v == null ? "" : v >= 0 ? "pos" : "neg";

  el("heroPrice").textContent = stats.lastClose != null ? `${currSym(state.currency)}${fmt(stats.lastClose)}` : "—";
  const chg = el("heroChange");
  chg.className = `price-change ${tone(stats.yrReturn)}`;
  chg.innerHTML = stats.yrReturn != null ? `${signed(stats.yrReturn)}<small>over the year</small>` : "";
  el("heroDate").textContent = stats.lastDate ? `Last close · ${fmtLongDate(stats.lastDate)}` : "";

  const s = state.stageData;
  const cells = [
    { label: "Past month", value: stats.monthlyChange != null ? signed(stats.monthlyChange) : "—", cls: tone(stats.monthlyChange) },
    { label: "Signal", value: "—", id: "signalValue", cellId: "signalCard" },
    { label: "Monthly volume", value: fmtBig(stats.avgVol) },
    { label: "Stage", value: s ? `${ROMAN[s.stage] || s.stage}<em>${escapeHtml(s.stageLabel)}</em>` : "—" },
  ];
  el("statRow").innerHTML = cells.map((c) => `
    <div class="stat-cell"${c.cellId ? ` id="${c.cellId}"` : ""}>
      <div class="stat-label">${c.label}</div>
      <div class="stat-value ${c.cls || ""}"${c.id ? ` id="${c.id}"` : ""}>${c.value}</div>
    </div>`).join("");
}

function updateSignalStat() {
  const a = state.analysis;
  const valueEl = el("signalValue");
  if (!a || !valueEl) return;
  const sig = SIGNAL_META[a.signal] || SIGNAL_META.HOLD;
  valueEl.style.color = sig.color;
  valueEl.innerHTML = `${sig.word}<small>${escapeHtml(String(a.confidence))}%</small>`;
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

      const badge = el("priceChangeBadge");
      if (badge) badge.textContent = "…";

      const chartKey = `${state.ticker}|${range}|${interval}`;
      const cached = chartCache.get(chartKey);
      if (cached && isFresh(cached.timestamp)) {
        state.history = cached.data.history || [];
        if (cached.data.lastClose) {
          state.trueLastClose = { close: cached.data.lastClose, date: cached.data.lastCloseDate };
        }
        renderPriceChart();
        renderVolumeChart();
        return;
      }

      try {
        const res = await fetch(`/api/chart/${state.ticker}?range=${range}&interval=${interval}`);
        if (!res.ok) throw new Error("Failed to fetch timeframe");
        const data = await res.json();
        state.history = data.history || [];
        if (data.lastClose) {
          state.trueLastClose = { close: data.lastClose, date: data.lastCloseDate };
        }
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
  const narrow = (canvas.parentElement ? canvas.parentElement.clientWidth : 0) < 500;
  const labelCount = Math.min(narrow ? 4 : 6, n);
  const step = Math.max(1, Math.floor(n / labelCount));
  const xLabels = dates.map((d, i) => {
    if ((i % step === 0 && (n - 1 - i) >= Math.floor(step * 0.75)) || i === n - 1) {
      const parts = d.split("-");
      if (parts.length === 3) {
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const mon = dt.toLocaleString("en", { month: "short" });
        const yr = "'" + String(dt.getFullYear()).slice(-2);
        return `${mon} ${yr}`;
      }
    }
    return "";
  });

  const badge = el("priceChangeBadge");
  if (badge && data.length >= 2) {
    const firstClose = data[0];
    const lastClose = data[data.length - 1];
    if (firstClose != null && firstClose > 0 && lastClose != null && lastClose > 0) {
      const pct = ((lastClose - firstClose) / firstClose * 100).toFixed(1);
      const isUp = parseFloat(pct) >= 0;
      const tf = TIMEFRAMES.find((t) => t.range === state.timeframe);
      badge.textContent = `${isUp ? "+" : "−"}${Math.abs(parseFloat(pct)).toFixed(1)}% over ${tf ? tf.label : "the period"}`;
      badge.className = "price-change-badge " + (isUp ? "positive" : "negative");
    } else {
      badge.textContent = "—";
    }
  }

  drawLineChart(canvas, data, {
    color: COLORS.ink,
    fillColor: COLORS.brass,
    refLines: [
      { value: state.high52, label: `YEAR HIGH ${fmt(state.high52)}` },
      { value: state.low52, label: `YEAR LOW ${fmt(state.low52)}` },
    ],
    yFormat: (v) => currSym(state.currency) + fmtAxis(v),
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
  const colors = monthly.map((d) => d.close >= d.open ? COLORS.forest + "99" : COLORS.oxblood + "80");

  drawBarChart(canvas, data, colors, {
    yFormat: (v) => fmtBig(v),
    tooltipFormat: (v, i) => `${dates[i]}  Vol ${fmtBig(v)}`,
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
        maSlopePct: s ? s.maSlopePct : undefined,
        emaAgreement: s ? s.emaAgreement : undefined,
        computedSignal: s ? s.signal : undefined,
        computedConfidence: s ? s.confidence : undefined,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      if (d.signal) {
        analysis = d;
        source = d.jevPowered ? "jev" : "gemini";
        // Apply news scoring from unified response
        if (d.newsScoring && Array.isArray(d.newsScoring)) {
          d.newsScoring.forEach(ns => {
            if (ns.headline_index != null && state.news[ns.headline_index]) {
              state.news[ns.headline_index].sentimentScore = ns.sentimentScore;
              state.news[ns.headline_index].impactConfidence = ns.impactConfidence;
            }
          });
        }
      }
    }
  } catch {}

  if (!analysis) {
    const advice = getStageBasedAdvice(s, stats.yrReturn);
    const factors = generateFactorsFromStage(s, state.ticker);
    analysis = {
      signal: s ? s.signal : "HOLD",
      confidence: s ? s.confidence : 60,
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
  renderFactors();
  renderNews(); // Re-render news with updated sentiment scores
}

function renderVerdict() {
  const card = el("verdictCard");
  if (!card) return;
  const a = state.analysis;
  const sig = SIGNAL_META[a.signal] || SIGNAL_META.HOLD;
  const impactfulNews = state.news.filter((n) => n.isImpactful);

  const alertHtml = impactfulNews.length ? `
    <div class="market-alert">
      <div class="market-alert-title">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Market alert
      </div>
      ${impactfulNews.slice(0, 3).map((n) => `<div class="market-alert-item">${escapeHtml(n.title)}</div>`).join("")}
    </div>` : "";

  card.innerHTML = `
    <article class="card verdict">
      <div class="verdict-head">
        <h3 class="verdict-headline">${escapeHtml(a.adviceHeadline)}</h3>
        <div class="verdict-stamp ${sig.cls}"><div><b>${escapeHtml(a.signal)}</b><small>${escapeHtml(String(a.confidence))}% CONF.</small></div></div>
      </div>
      <p class="verdict-detail">${escapeHtml(a.adviceDetail)}</p>
      <blockquote class="verdict-action">${escapeHtml(a.adviceAction)}</blockquote>
      ${alertHtml}
      <div class="ai-source-line"><span class="ai-source-dot"></span>AI-powered analysis · Not financial advice</div>
    </article>`;
}

function renderFactors() {
  const a = state.analysis;
  const flist = el("factorsList");
  if (!a || !a.factors || !flist) return;
  const typeColor = { macro: COLORS.brass, sentiment: COLORS.mute, financial: COLORS.forest };
  flist.innerHTML = a.factors.map((f, i) => {
    const pct = Math.min(Math.abs(f.impact) * 10, 100);
    const pos = f.impact >= 0;
    const tone = pos ? COLORS.forest : COLORS.oxblood;
    return `
      <div class="factor-item" style="animation-delay:${i * 0.05}s">
        <div class="factor-top">
          <div class="factor-left">
            <span class="factor-name">${escapeHtml(f.name)}</span>
            <span class="factor-type-badge" style="color:${typeColor[f.type] || COLORS.brass}">${escapeHtml(f.type)}</span>
          </div>
          <span class="factor-impact" style="color:${tone}">${pos ? "+" : ""}${escapeHtml(String(f.impact))}</span>
        </div>
        <div class="factor-desc">${escapeHtml(f.desc)}</div>
        <div class="factor-bar-track">
          <div class="factor-bar-fill" style="width:${pct}%; background:${tone}"></div>
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
  list.innerHTML = state.news.map((a) => {
    const sentLabel = a.sentimentScore != null
      ? (a.sentimentScore >= 4 ? "Positive" : a.sentimentScore <= 2 ? "Negative" : "Neutral")
      : "";
    const sentColor = a.sentimentScore != null
      ? (a.sentimentScore >= 4 ? COLORS.forest : a.sentimentScore <= 2 ? COLORS.oxblood : COLORS.mute)
      : "";
    return `
    <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer" class="news-item ${a.isImpactful ? "impactful" : ""}">
      <div class="news-title">${escapeHtml(a.title)}</div>
      <div class="news-meta">
        ${a.publisher ? `<span>${escapeHtml(a.publisher)}</span>` : ""}
        ${a.publisher && a.pubDate ? `<span style="opacity:0.4">·</span>` : ""}
        ${a.pubDate ? `<span>${new Date(a.pubDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>` : ""}
        ${a.isImpactful ? `<span class="news-impact-badge">IMPACT</span>` : ""}
        ${sentLabel ? `<span style="color:${sentColor}; font-size:0.7rem; font-weight:600; margin-left:4px">${sentLabel}</span>` : ""}
      </div>
    </a>
    `;
  }).join("");
}

// ── Mobile-Safe Resize Handler ────────────────────────────────────────
let resizeDebounce = null;
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    ["priceChart", "volumeChart", "stageChart"].forEach((id) => {
      const canvas = el(id);
      if (!canvas) return;
      const fn = lastDraw.get(canvas);
      if (fn) fn();
    });
  }, 250);
});

// ── Tab Navigation ───────────────────────────────────────────────────
document.querySelectorAll(".tab-bar .tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-bar .tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.tab;
    el("dashboardView").style.display = target === "dashboardView" ? "" : "none";
    el("watchlistView").style.display = target === "watchlistView" ? "" : "none";
    if (target === "watchlistView") { renderWlTabs(); loadWatchlist(); }
  });
});

function switchToDashboard(ticker) {
  document.querySelectorAll(".tab-bar .tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === "dashboardView");
  });
  el("dashboardView").style.display = "";
  el("watchlistView").style.display = "none";
  loadTicker(ticker);
}

function showToast(msg) {
  const existing = document.getElementById("sdToast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.id = "sdToast";
  t.textContent = msg;
  t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--surface,#1a1d23);border:1px solid var(--border,#2a2d35);color:var(--text,#e0e0e0);padding:10px 20px;border-radius:8px;font-size:13px;white-space:nowrap;z-index:9999;opacity:0;transition:opacity 0.3s;";
  document.body.appendChild(t);
  requestAnimationFrame(() => t.style.opacity = "1");
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 2500);
}

// ── Watchlist Logic ──────────────────────────────────────────────────
const WL_KEY = "stockdash_watchlist";
const WL_V2_KEY = "stockdash_wl_v2";
const WL_MAX_LISTS = 6;
const WL_MAX_PER_LIST = 10;
let wlActiveIdx = 0;

function getWlStore() {
  try {
    const v2 = JSON.parse(localStorage.getItem(WL_V2_KEY));
    if (v2 && Array.isArray(v2.lists) && v2.lists.length) return v2;
  } catch {}
  try {
    const old = JSON.parse(localStorage.getItem(WL_KEY));
    if (Array.isArray(old) && old.length) {
      const migrated = { lists: [{ name: "Watchlist 1", tickers: old.slice(0, WL_MAX_PER_LIST) }] };
      localStorage.setItem(WL_V2_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {}
  return { lists: [{ name: "Watchlist 1", tickers: [] }] };
}

function saveWlStore(store) {
  localStorage.setItem(WL_V2_KEY, JSON.stringify(store));
}

function getActiveList() {
  const store = getWlStore();
  if (wlActiveIdx >= store.lists.length) wlActiveIdx = 0;
  return store.lists[wlActiveIdx];
}

function getWatchlistTickers() {
  return getActiveList().tickers;
}

function addToWatchlist(ticker) {
  const t = ticker.toUpperCase().trim();
  if (!t) return;
  const store = getWlStore();
  const list = store.lists[wlActiveIdx];
  if (list.tickers.includes(t)) return;
  if (list.tickers.length >= WL_MAX_PER_LIST) { showToast(`Limit reached: ${WL_MAX_PER_LIST} stocks per list`); return; }
  list.tickers.push(t);
  saveWlStore(store);
  updateWatchlistStar();
  loadWatchlist(true);
}

function removeFromWatchlist(ticker) {
  const store = getWlStore();
  store.lists[wlActiveIdx].tickers = store.lists[wlActiveIdx].tickers.filter(t => t !== ticker);
  saveWlStore(store);
  updateWatchlistStar();
  loadWatchlist(true);
}

function isInAnyWatchlist(ticker) {
  return getWlStore().lists.some(l => l.tickers.includes(ticker));
}

function updateWatchlistStar() {
  const star = el("watchlistStar");
  if (!star) return;
  const inList = isInAnyWatchlist(state.ticker);
  star.classList.toggle("active", inList);
  star.title = inList ? "Remove from watchlist" : "Add to watchlist";
}

document.getElementById("watchlistStar").addEventListener("click", () => {
  const store = getWlStore();
  const listIdx = store.lists.findIndex(l => l.tickers.includes(state.ticker));
  if (listIdx >= 0) {
    store.lists[listIdx].tickers = store.lists[listIdx].tickers.filter(t => t !== state.ticker);
    saveWlStore(store);
    updateWatchlistStar();
    if (listIdx === wlActiveIdx) loadWatchlist();
  } else {
    addToWatchlist(state.ticker);
  }
});

function showWlDeleteConfirm(tabName, onConfirm) {
  const existing = document.getElementById("wlDeleteOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "wlDeleteOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;";
  const box = document.createElement("div");
  box.style.cssText = "background:var(--surface,#1a1d23);border:1px solid var(--border,#2a2d35);border-radius:12px;padding:24px;max-width:320px;width:90%;text-align:center;";
  box.innerHTML = `
    <div style="font:500 20px var(--serif,Georgia,serif);color:var(--text,#e0e0e0);margin-bottom:8px;">Delete "${tabName}"?</div>
    <div style="font-size:13px;color:var(--text-sec,#8b8d93);margin-bottom:20px;">All stocks in this list will be removed.</div>
    <div style="display:flex;gap:10px;justify-content:center;">
      <button id="wlDelNo" style="padding:8px 24px;background:var(--glass,#252830);border:1px solid var(--border,#2a2d35);color:var(--text,#e0e0e0);border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;">No</button>
      <button id="wlDelYes" style="padding:8px 24px;background:var(--red,#e24b4a);border:none;color:white;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;">Yes, delete</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  box.querySelector("#wlDelNo").addEventListener("click", () => overlay.remove());
  box.querySelector("#wlDelYes").addEventListener("click", () => { overlay.remove(); onConfirm(); });
}

function renderWlTabs() {
  const bar = el("wlTabBar");
  if (!bar) return;
  const store = getWlStore();
  let html = store.lists.map((l, i) => {
    const active = i === wlActiveIdx ? " wl-tab-active" : "";
    const canDelete = store.lists.length > 1 ? `<span class="wl-tab-del" data-delidx="${i}" title="Delete list">✕</span>` : "";
    return `<button class="wl-tab${active}" data-tabidx="${i}"><span class="wl-tab-name" data-nameidx="${i}">${escapeHtml(l.name)}</span>${canDelete}</button>`;
  }).join("");
  if (store.lists.length < WL_MAX_LISTS) {
    html += `<button class="wl-tab wl-tab-add" id="wlAddTab" title="Add watchlist">+ New list</button>`;
  }
  bar.innerHTML = html;

  bar.querySelectorAll(".wl-tab[data-tabidx]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("wl-tab-del")) return;
      const idx = parseInt(btn.dataset.tabidx);
      if (idx !== wlActiveIdx) { wlActiveIdx = idx; renderWlTabs(); loadWatchlist(); }
    });
  });

  bar.querySelectorAll(".wl-tab-name").forEach(span => {
    span.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const idx = parseInt(span.dataset.nameidx);
      const current = store.lists[idx].name;
      span.contentEditable = "true";
      span.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(span);
      const finishRename = () => {
        span.contentEditable = "false";
        const newName = span.textContent.trim().slice(0, 30) || current;
        const s = getWlStore();
        s.lists[idx].name = newName;
        saveWlStore(s);
        renderWlTabs();
      };
      span.addEventListener("blur", finishRename, { once: true });
      span.addEventListener("keydown", (ke) => { if (ke.key === "Enter") { ke.preventDefault(); span.blur(); } }, { once: true });
    });
  });

  bar.querySelectorAll(".wl-tab-del").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.delidx);
      const s = getWlStore();
      const tabName = s.lists[idx]?.name || "this tab";
      showWlDeleteConfirm(tabName, () => {
        delete wlCache[idx];
        const s2 = getWlStore();
        s2.lists.splice(idx, 1);
        if (wlActiveIdx >= s2.lists.length) wlActiveIdx = s2.lists.length - 1;
        saveWlStore(s2);
        renderWlTabs();
        loadWatchlist(true);
      });
    });
  });

  const addBtn = el("wlAddTab");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const s = getWlStore();
      if (s.lists.length >= WL_MAX_LISTS) return;
      const num = s.lists.length + 1;
      s.lists.push({ name: `Watchlist ${num}`, tickers: [] });
      saveWlStore(s);
      wlActiveIdx = s.lists.length - 1;
      renderWlTabs();
      loadWatchlist();
      const nameSpan = bar.querySelector(`.wl-tab-name[data-nameidx="${wlActiveIdx}"]`);
      if (nameSpan) nameSpan.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }
}

// Watchlist search + add
let watchlistSearchDebounce = null;
let watchlistSelectedTicker = "";

el("watchlistInput").addEventListener("input", () => {
  clearTimeout(watchlistSearchDebounce);
  const q = el("watchlistInput").value.trim();
  const dropdown = el("watchlistDropdown");
  if (q.length < 1) { dropdown.innerHTML = ""; dropdown.style.display = "none"; watchlistSelectedTicker = ""; return; }
  watchlistSearchDebounce = setTimeout(async () => {
    try {
      const currentQ = el("watchlistInput").value.trim();
      if (currentQ.length < 1) return;
      const res = await fetch(`/api/search?q=${encodeURIComponent(currentQ)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.results || !data.results.length) { dropdown.innerHTML = `<div class="wl-dd-empty">No results</div>`; dropdown.style.display = "block"; return; }
      dropdown.innerHTML = data.results.slice(0, 6).map(r => `
        <div class="wl-dd-item" data-symbol="${escapeHtml(r.symbol)}">
          <span class="wl-dd-symbol">${escapeHtml(r.symbol)}</span>
          <span class="wl-dd-name">${escapeHtml(r.name)}</span>
          <span class="wl-dd-exchange">${escapeHtml(r.exchange)}</span>
        </div>
      `).join("");
      dropdown.style.display = "block";
      dropdown.querySelectorAll(".wl-dd-item").forEach(item => {
        item.addEventListener("click", () => {
          watchlistSelectedTicker = item.dataset.symbol;
          el("watchlistInput").value = item.dataset.symbol;
          dropdown.style.display = "none";
        });
      });
    } catch {}
  }, 300);
});

el("watchlistAddBtn").addEventListener("click", () => {
  const input = el("watchlistInput");
  const val = watchlistSelectedTicker || input.value.trim().toUpperCase();
  if (val) {
    addToWatchlist(val);
    input.value = "";
    watchlistSelectedTicker = "";
    el("watchlistDropdown").style.display = "none";
  }
});
el("watchlistInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("watchlistAddBtn").click();
});

let wlSortKey = "ticker";
let wlSortAsc = true;
let wlData = [];
const wlCache = {};

async function loadWatchlist(force) {
  const tickers = getWatchlistTickers();
  el("wlCount").textContent = `${tickers.length} of ${WL_MAX_PER_LIST}`;
  const grid = el("watchlistGrid");
  const empty = el("watchlistEmpty");
  const loading = el("watchlistLoading");

  if (!tickers.length) {
    grid.innerHTML = "";
    wlData = [];
    delete wlCache[wlActiveIdx];
    empty.style.display = "block";
    return;
  }

  const cacheKey = wlActiveIdx;
  const cached = wlCache[cacheKey];
  if (!force && cached && cached.key === tickers.join(",")) {
    wlData = cached.data;
    empty.style.display = "none";
    renderWatchlistTable();
    return;
  }

  empty.style.display = "none";
  loading.style.display = "flex";

  try {
    const res = await fetch("/api/watchlist/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
    });
    if (!res.ok) throw new Error("Watchlist analyze failed");
    const data = await res.json();
    loading.style.display = "none";
    wlData = data.results || [];
    wlCache[cacheKey] = { key: tickers.join(","), data: wlData };
    renderWatchlistTable();
  } catch (err) {
    loading.style.display = "none";
    grid.innerHTML = `<div class="wl-table-error">Unable to load watchlist data</div>`;
  }
}

function sortWatchlist(key) {
  if (wlSortKey === key) {
    wlSortAsc = !wlSortAsc;
  } else {
    wlSortKey = key;
    wlSortAsc = true;
  }
  renderWatchlistTable();
}

function getWlSortVal(item, key) {
  const map = {
    ticker: item.ticker,
    stage: item.stage || 0,
    signal: item.signal === "BUY" ? 1 : item.signal === "HOLD" ? 2 : 3,
    price: item.lastClose || 0,
    yrReturn: item.yrReturn || 0,
    ema10: item.ema10 || 0,
    ema20: item.ema20 || 0,
    ema40: item.ema40 || 0,
  };
  return map[key] ?? 0;
}

function fmtEma(price, pct, sym) {
  const sign = pct >= 0 ? "+" : "";
  return `<span class="wl-ema-price">${sym}${fmt(price)}</span><span class="wl-ema-pct ${pct >= 0 ? "pos" : "neg"}">${sign}${pct.toFixed(1)}%</span>`;
}

function renderWatchlistTable() {
  const grid = el("watchlistGrid");
  const sorted = [...wlData].sort((a, b) => {
    let va = getWlSortVal(a, wlSortKey);
    let vb = getWlSortVal(b, wlSortKey);
    if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    if (va < vb) return wlSortAsc ? -1 : 1;
    if (va > vb) return wlSortAsc ? 1 : -1;
    return 0;
  });

  const arrow = (key) => wlSortKey === key ? (wlSortAsc ? " ▲" : " ▼") : "";
  const cols = [
    { key: "ticker", label: "Company" },
    { key: "price", label: "Price", num: true },
    { key: "yrReturn", label: "1 Yr", num: true },
    { key: "signal", label: "View", num: true },
    { key: "stage", label: "Stage" },
    { key: "ema10", label: "10W EMA", num: true },
    { key: "ema20", label: "20W EMA", num: true },
    { key: "ema40", label: "40W EMA", num: true },
  ];

  const headerHtml = cols.map(c =>
    `<th class="wl-th${c.num ? " num" : ""}${wlSortKey === c.key ? " wl-th-active" : ""}" data-sort="${c.key}">${c.label}${arrow(c.key)}</th>`
  ).join("") + `<th class="wl-th wl-th-actions"></th>`;

  const rowsHtml = sorted.map(item => {
    const sig = SIGNAL_META[item.signal] || SIGNAL_META.HOLD;
    const sym = item.currency === "INR" ? "₹" : "$";
    const yrStr = item.yrReturn != null ? `${item.yrReturn >= 0 ? "+" : ""}${Number(item.yrReturn).toFixed(1)}%` : "—";
    const displayTicker = item.ticker.replace(/\.(NS|BO)$/, "");
    const name = item.name && item.name !== item.ticker ? item.name : displayTicker;
    const sub = [displayTicker, item.exchange].filter(Boolean).join(" · ");
    return `
      <tr class="wl-row" data-ticker="${escapeHtml(item.ticker)}">
        <td class="wl-td wl-td-ticker"><a data-view="${escapeHtml(item.ticker)}" title="${escapeHtml(name)}">${escapeHtml(name)}</a><div class="wl-co-sub">${escapeHtml(sub)}</div></td>
        <td class="wl-td num">${sym}${fmt(item.lastClose)}</td>
        <td class="wl-td num ${item.yrReturn >= 0 ? "pos" : "neg"}">${yrStr}</td>
        <td class="wl-td num"><span class="wl-view ${sig.cls}">${sig.word}</span></td>
        <td class="wl-td"><span class="wl-stage-badge wl-stage-${item.stage || 1}">${ROMAN[item.stage] || "—"} · ${escapeHtml(item.stageLabel || "—")}</span></td>
        <td class="wl-td wl-td-ema num">${fmtEma(item.ema10 || 0, item.ema10Pct || 0, sym)}</td>
        <td class="wl-td wl-td-ema num">${fmtEma(item.ema20 || 0, item.ema20Pct || 0, sym)}</td>
        <td class="wl-td wl-td-ema num">${fmtEma(item.ema40 || 0, item.ema40Pct || 0, sym)}</td>
        <td class="wl-td wl-td-actions">
          <button class="wl-remove-btn" data-remove="${escapeHtml(item.ticker)}" title="Remove">✕</button>
        </td>
      </tr>`;
  }).join("");

  grid.innerHTML = `
    <div class="wl-table-wrap">
      <table class="wl-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;

  grid.querySelectorAll(".wl-th[data-sort]").forEach(th => {
    th.addEventListener("click", () => sortWatchlist(th.dataset.sort));
  });
  grid.querySelectorAll(".wl-td-ticker a[data-view]").forEach(link => {
    link.addEventListener("click", (e) => { e.preventDefault(); switchToDashboard(link.dataset.view); });
  });
  grid.querySelectorAll(".wl-remove-btn").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); removeFromWatchlist(btn.dataset.remove); });
  });
}

// ── Initialize App ────────────────────────────────────────────────────
renderMastDate();
loadTicker(state.ticker);
