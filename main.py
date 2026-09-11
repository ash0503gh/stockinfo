import os
import json
import httpx
import asyncio
import email.utils
import yfinance as yf
from yahooquery import search
from datetime import datetime, timedelta, timezone
import xml.etree.ElementTree as ET
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="StockDash")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3.8-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

ALLOWED_EXCHANGES = {
    # India
    "NSI", "NSE", "BSE", "BOM",
    # US
    "NYQ", "NYSE", "NMS", "NASDAQ", "NGM", "NAS", "PCX", "ASE", "AMEX"
}

EXCHANGE_LABELS = {
    "NSI": "NSE", "BSE": "BSE", "BOM": "BSE",
    "NYQ": "NYSE", "NMS": "NASDAQ", "NGM": "NASDAQ", "NAS": "NASDAQ",
    "PCX": "NYSE", "ASE": "AMEX",
}


# ── Search ─────────────────────────────────────────────────────────────

@app.get("/api/search")
async def search_stocks(q: str = Query(..., min_length=1)):
    def _search():
        try:
            return search(q)
        except Exception:
            return {"quotes": []}

    data = await asyncio.to_thread(_search)
    results = []
    for q_item in data.get("quotes", []):
        excl = q_item.get("exchange", "")
        if q_item.get("quoteType") in ("EQUITY", "ETF") and excl in ALLOWED_EXCHANGES:
            results.append({
                "symbol": q_item.get("symbol", ""),
                "name": q_item.get("shortname") or q_item.get("longname", ""),
                "exchange": EXCHANGE_LABELS.get(excl, excl),
                "type": q_item.get("quoteType", ""),
            })
    return {"results": results}

# ── Chart ──────────────────────────────────────────────────────────────

@app.get("/api/chart/{ticker}")
async def get_chart(ticker: str, interval: str = "1wk", range: str = "1y"):
    def _get_history():
        tkr = yf.Ticker(ticker)
        try:
            currency = tkr.fast_info.get("currency", "USD")
        except Exception:
            currency = "USD"

        hist = tkr.history(period=range, interval=interval)
        return hist, currency

    try:
        hist, currency = await asyncio.to_thread(_get_history)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch chart: {str(e)}")

    if hist.empty:
        raise HTTPException(404, f"No chart data for {ticker}")

    history = []
    import pandas as pd
    for index, row in hist.iterrows():
        history.append({
            "date": index.strftime("%Y-%m-%d"),
            "open": round(row["Open"], 2) if pd.notna(row.get("Open")) else None,
            "close": round(row["Close"], 2),
            "volume": int(row["Volume"]) if "Volume" in row and pd.notna(row["Volume"]) else 0,
        })

    return {"ticker": ticker, "name": ticker, "currency": currency, "history": history}


# ── Stage Analysis (Weinstein-style, computed from real price data) ────
# No AI involved here — this is pure math over historical closes, and it
# becomes the authoritative source for signal/confidence downstream.

STAGE_LABELS = {
    1: "Basing",
    2: "Advancing",
    3: "Topping",
    4: "Declining",
}
STAGE_DESCRIPTIONS = {
    1: "Price is moving sideways near a flat 30-week average — no clear trend yet.",
    2: "Price is above a rising 30-week average — an established uptrend.",
    3: "Price is flattening out near the top of its range — momentum is fading.",
    4: "Price is below a falling 30-week average — an established downtrend.",
}


def _classify_stage(price_vs_ma_pct: float, ma_slope_pct: float):
    """Weinstein-style 4-stage classification from price/MA position and MA slope."""
    if price_vs_ma_pct > 0 and ma_slope_pct > 0.5:
        stage = 2
    elif price_vs_ma_pct < 0 and ma_slope_pct < -0.5:
        stage = 4
    elif price_vs_ma_pct > 0:
        stage = 3
    else:
        stage = 1
    return stage


def _signal_from_stage(stage: int, price_vs_ma_pct: float):
    if stage == 2:
        return "STRONG BUY" if price_vs_ma_pct > 10 else "BUY"
    if stage == 4:
        return "STRONG SELL" if price_vs_ma_pct < -10 else "SELL"
    return "HOLD"


def _confidence_from_stage(price_vs_ma_pct: float, ma_slope_pct: float, stage: int):
    # HOLD stages (1, 3) are inherently less certain than trending stages (2, 4).
    base = 45 if stage in (1, 3) else 50
    distance_component = min(abs(price_vs_ma_pct) * 1.5, 25)
    slope_component = min(abs(ma_slope_pct) * 3, 20)
    confidence = base + distance_component + slope_component
    return int(max(35, min(95, round(confidence))))


def compute_stage_data(ticker: str):
    tkr = yf.Ticker(ticker)
    hist = tkr.history(period="2y", interval="1wk")
    if hist.empty or len(hist) < 35:
        raise HTTPException(404, f"Not enough weekly history for {ticker} to compute stage")

    closes = hist["Close"].tolist()
    dates = [d.strftime("%Y-%m-%d") for d in hist.index]

    import pandas as pd
    ma_series = pd.Series(closes).rolling(window=30).mean()
    ma_list = [round(v, 2) if pd.notna(v) else None for v in ma_series.tolist()]

    last_close = closes[-1]
    last_ma = ma_series.iloc[-1]
    ma_5_ago = ma_series.iloc[-6] if len(ma_series) > 5 else ma_series.iloc[0]

    price_vs_ma_pct = round((last_close - last_ma) / last_ma * 100, 2)
    ma_slope_pct = round((last_ma - ma_5_ago) / ma_5_ago * 100, 2) if ma_5_ago else 0.0

    stage = _classify_stage(price_vs_ma_pct, ma_slope_pct)
    signal = _signal_from_stage(stage, price_vs_ma_pct)
    confidence = _confidence_from_stage(price_vs_ma_pct, ma_slope_pct, stage)

    return {
        "ticker": ticker,
        "dates": dates,
        "closes": [round(c, 2) for c in closes],
        "ma30": ma_list,
        "stage": stage,
        "stageLabel": STAGE_LABELS[stage],
        "stageDescription": STAGE_DESCRIPTIONS[stage],
        "priceVsMaPct": price_vs_ma_pct,
        "maSlopePct": ma_slope_pct,
        "signal": signal,
        "confidence": confidence,
    }


@app.get("/api/stage/{ticker}")
async def get_stage(ticker: str):
    try:
        data = await asyncio.to_thread(compute_stage_data, ticker)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Failed to compute stage: {str(e)}")
    return data


# ── News ───────────────────────────────────────────────────────────────

async def fetch_yahoo_news(ticker: str):
    def _get_news():
        return yf.Ticker(ticker).news

    try:
        news_items = await asyncio.to_thread(_get_news)
        cutoff_ts = (datetime.utcnow() - timedelta(days=90)).timestamp()

        parsed = []
        for item in news_items:
            pub_ts = item.get("providerPublishTime", 0)
            if pub_ts < cutoff_ts:
                continue

            dt = datetime.fromtimestamp(pub_ts, tz=timezone.utc) if pub_ts else datetime.now(timezone.utc)

            parsed.append({
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "publisher": item.get("publisher", ""),
                "date": dt
            })
        return parsed
    except Exception:
        return []


async def fetch_google_news(ticker: str):
    url = f"https://news.google.com/rss/search?q={ticker}+stock&hl=en"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, follow_redirects=True, timeout=10.0)
            if resp.status_code != 200:
                return []

            root = ET.fromstring(resp.text)
            parsed = []
            for item in root.findall(".//item"):
                title = item.findtext("title", "")
                link = item.findtext("link", "")
                pubDate_str = item.findtext("pubDate", "")
                source_elem = item.find("source")
                publisher = source_elem.text if source_elem is not None else ""

                dt = datetime.now(timezone.utc)
                if pubDate_str:
                    try:
                        parsed_tuple = email.utils.parsedate_tz(pubDate_str)
                        if parsed_tuple:
                            ts = email.utils.mktime_tz(parsed_tuple)
                            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                    except Exception:
                        pass

                parsed.append({
                    "title": title,
                    "link": link,
                    "publisher": publisher,
                    "date": dt
                })
            return parsed
    except Exception:
        return []


@app.get("/api/news/{ticker}")
async def get_news(ticker: str):
    y_news, g_news = await asyncio.gather(
        fetch_yahoo_news(ticker),
        fetch_google_news(ticker)
    )

    combined = y_news + g_news

    cutoff = datetime.now(timezone.utc) - timedelta(days=90)

    deduped = []
    seen = []
    for item in combined:
        if item["date"] < cutoff:
            continue

        title_lower = item["title"].lower()
        is_dup = any(title_lower in s or s in title_lower for s in seen)
        if not is_dup:
            seen.append(title_lower)
            deduped.append(item)

    TIER_1 = ["bloomberg", "reuters", "wsj", "wall street journal", "financial times", "cnbc", "economic times", "mint", "business standard", "moneycontrol", "yahoo finance"]

    def get_tier(pub: str) -> int:
        p = pub.lower()
        if not p: return 2
        for t in TIER_1:
            if t in p:
                return 1
        return 2

    deduped.sort(key=lambda x: (get_tier(x["publisher"]), -x["date"].timestamp()))
    deduped = deduped[:8]

    impact_keywords = [
        "earnings", "revenue", "profit", "loss", "merger", "acquisition",
        "buyback", "dividend", "surge", "plunge", "crash", "rally", "upgrade",
        "downgrade", "layoff", "restructur", "fda", "approval", "lawsuit",
        "regulation", "tariff", "ban", "recall", "bankrupt", "ipo", "split",
    ]

    articles = []
    for d in deduped[:20]:
        title = d["title"]
        combined_text = title.lower()
        is_impactful = any(kw in combined_text for kw in impact_keywords)

        articles.append({
            "title": title,
            "link": d["link"],
            "pubDate": d["date"].strftime("%a, %d %b %Y %H:%M:%S GMT"),
            "publisher": d["publisher"],
            "description": title,
            "isImpactful": is_impactful,
        })

    return {"articles": articles}


# ── Gemini AI analysis endpoint ────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    ticker: str
    currentPrice: float
    oneYearReturn: Optional[float] = None
    monthlyChange: Optional[float] = None
    avgVolume: Optional[float] = None
    newsHeadlines: list[str] = []
    currency: str = "USD"
    # Stage Analysis fields — computed server-side by /api/stage, passed
    # through by the frontend. When present, these LOCK the signal and
    # confidence Gemini must return; Gemini only writes the narrative.
    stage: Optional[int] = None
    stageLabel: Optional[str] = None
    priceVsMaPct: Optional[float] = None
    maSlopePct: Optional[float] = None
    computedSignal: Optional[str] = None
    computedConfidence: Optional[int] = None


@app.post("/api/analyze")
async def analyze_stock(req: AnalyzeRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(503, "Gemini API key not configured")

    news_block = "\n".join(f"- {h}" for h in req.newsHeadlines[:15]) or "No recent headlines."

    stage_block = ""
    if req.stage is not None:
        direction = "above" if (req.priceVsMaPct or 0) >= 0 else "below"
        slope_dir = "rising" if (req.maSlopePct or 0) >= 0 else "falling"
        stage_block = f"""
TECHNICAL STAGE ANALYSIS (Weinstein Stage Analysis, computed from real price data):
- Current stage: Stage {req.stage} ({req.stageLabel})
- Price is {abs(req.priceVsMaPct or 0)}% {direction} its 30-week moving average
- The moving average is {slope_dir} ({req.maSlopePct}% over the last 5 weeks)
- What the technical trend alone implies: {req.computedSignal} (confidence {req.computedConfidence})

This is a real, data-backed signal — weigh it seriously. But it is ONE input, not the final answer. If the news headlines or the financial numbers above (returns, volume, momentum) point clearly in a different direction — a bad earnings surprise, a major negative headline, deteriorating fundamentals despite a technical uptrend, or vice versa — you should adjust the signal and/or confidence away from what the technical trend alone implies. When you do diverge from the technical reading, say so explicitly in adviceDetail (e.g. "despite a technical uptrend, recent news on X changes the picture because...").
"""

    prompt = f"""You are a senior equity research analyst. Analyze the stock {req.ticker} and return ONLY valid JSON (no markdown, no backticks).

Current data:
- Price: {req.currency} {req.currentPrice}
- 1-Year Return: {req.oneYearReturn if req.oneYearReturn is not None else 'N/A'}%
- Monthly Change: {req.monthlyChange if req.monthlyChange is not None else 'N/A'}%
- Avg Monthly Volume: {req.avgVolume if req.avgVolume is not None else 'N/A'}
{stage_block}
Recent headlines:
{news_block}

Return this exact JSON schema:
{{
  "signal": "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL",
  "confidence": <number 0-100>,
  "forecastCurve": [<12 numbers: predicted monthly closing prices for the next 12 months>],
  "adviceHeadline": "<short bold verdict, 6-10 words>",
  "adviceDetail": "<2-3 sentence plain-English explanation for a retail investor>",
  "adviceAction": "<1 sentence concrete action step>",
  "factors": [
    {{"name": "<factor name>", "desc": "<1 sentence>", "type": "macro" | "sentiment" | "financial", "impact": <integer -10 to 10>}}
  ]
}}

Include 5-7 factors. Be realistic — use the headlines for sentiment and the numbers for financial context. The forecastCurve should start near the current price and reflect your signal direction."""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json"
        },
    }

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{GEMINI_URL}?key={GEMINI_API_KEY}", json=payload, timeout=30)

        if r.status_code == 404:
            raise HTTPException(502, f"Gemini Model not found. Check if {GEMINI_MODEL} is correct.")
        if r.status_code == 403 or r.status_code == 400:
            raise HTTPException(502, f"Gemini API key is invalid or lacks access. Code: {r.status_code}")
        if r.status_code != 200:
            raise HTTPException(502, f"Gemini API error: {r.status_code} - {r.text}")

        data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

        result = json.loads(text)

        # Defensive only — never overrides a legitimate Gemini decision.
        # Gemini is free to diverge from the technical stage reading (that's
        # the point); this just guards against a missing/invalid field in
        # its JSON so the UI doesn't break.
        VALID_SIGNALS = {"STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"}
        if result.get("signal") not in VALID_SIGNALS:
            result["signal"] = req.computedSignal or "HOLD"
        conf = result.get("confidence")
        if not isinstance(conf, (int, float)) or not (0 <= conf <= 100):
            result["confidence"] = req.computedConfidence if req.computedConfidence is not None else 50

        return result

    except json.JSONDecodeError:
        raise HTTPException(502, "Gemini returned invalid JSON")
    except (KeyError, IndexError):
        raise HTTPException(502, "Unexpected Gemini response format")
    except httpx.TimeoutException:
        raise HTTPException(504, "Gemini request timed out")


@app.get("/health")
async def health():
    return {"status": "ok", "gemini_configured": bool(GEMINI_API_KEY)}


# ── Serve the frontend ───────────────────────────────────────────────

@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/style.css")
async def serve_css():
    return FileResponse("style.css", media_type="text/css")

@app.get("/app.js")
async def serve_js():
    return FileResponse("app.js", media_type="application/javascript")
