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
import pandas as pd

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

        # Weekly/monthly bars from yfinance are labeled by the START of
        # their period (e.g. Monday for a weekly bar). A small 5d
        # daily-granularity fetch gets the true most-recent trading day
        # and its exact close, independent of the chart's interval.
        try:
            daily = tkr.history(period="5d", interval="1d")
        except Exception:
            daily = None

        return hist, currency, daily

    try:
        hist, currency, daily = await asyncio.to_thread(_get_history)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch chart: {str(e)}")

    if hist.empty:
        raise HTTPException(404, f"No chart data for {ticker}")

    history = []
    for index, row in hist.iterrows():
        history.append({
            "date": index.strftime("%Y-%m-%d"),
            "open": round(row["Open"], 2) if pd.notna(row.get("Open")) else None,
            "close": round(row["Close"], 2),
            "volume": int(row["Volume"]) if "Volume" in row and pd.notna(row["Volume"]) else 0,
        })

    last_close = None
    last_close_date = None
    if daily is not None and not daily.empty:
        last_close = round(float(daily["Close"].iloc[-1]), 2)
        last_close_date = daily.index[-1].strftime("%Y-%m-%d")
    elif history:
        last_close = history[-1]["close"]
        last_close_date = history[-1]["date"]

    closes = [h["close"] for h in history]
    high_52 = round(max(closes), 2) if closes else last_close
    low_52 = round(min(closes), 2) if closes else last_close

    return {
        "ticker": ticker,
        "name": ticker,
        "currency": currency,
        "history": history,
        "lastClose": last_close,
        "lastCloseDate": last_close_date,
        "high52": high_52,
        "low52": low_52,
    }


# ── Stage Analysis (Weinstein-style, computed from real price data) ────

STAGE_LABELS = {
    1: "Basing",
    2: "Advancing",
    3: "Topping",
    4: "Declining",
}
STAGE_DESCRIPTIONS = {
    1: "Price is moving sideways near a flat 30-week average — no clear trend yet (Accumulation).",
    2: "Price is above a rising 30-week average — an established uptrend (Markup phase).",
    3: "Price is flattening out near the top of its range — momentum is fading (Distribution).",
    4: "Price is below a falling 30-week average — an established downtrend (Markdown phase).",
}


def _classify_stage(price_vs_ma_pct: float, ma_slope_pct: float) -> int:
    """Weinstein-style 4-stage classification from price/MA position and MA slope."""
    if price_vs_ma_pct > 0 and ma_slope_pct > 0.5:
        return 2
    elif price_vs_ma_pct < 0 and ma_slope_pct < -0.5:
        return 4
    elif price_vs_ma_pct > 0:
        return 3
    else:
        return 1


def _signal_from_stage(stage: int, price_vs_ma_pct: float) -> str:
    if stage == 2:
        return "STRONG BUY" if price_vs_ma_pct > 10 else "BUY"
    if stage == 4:
        return "STRONG SELL" if price_vs_ma_pct < -10 else "SELL"
    return "HOLD"


def _confidence_from_stage(price_vs_ma_pct: float, ma_slope_pct: float, stage: int) -> int:
    base = 45 if stage in (1, 3) else 50
    distance_component = min(abs(price_vs_ma_pct) * 1.5, 25)
    slope_component = min(abs(ma_slope_pct) * 3, 20)
    confidence = base + distance_component + slope_component
    return int(max(35, min(95, round(confidence))))


def _ema_alignment_adjustment(price_vs_ma_pct: float, ma_slope_pct: float,
                               price_vs_ema_pct: float, ema_slope_pct: float) -> int:
    """
    Compares 30-week SMA reading against 52-week (yearly) EMA reading.
    Agreement on position & slope adds confidence; disagreement subtracts.
    """
    position_agree = (price_vs_ma_pct >= 0) == (price_vs_ema_pct >= 0)
    slope_agree = (ma_slope_pct >= 0) == (ema_slope_pct >= 0)
    score = (1 if position_agree else -1) + (1 if slope_agree else -1)
    return score * 5


def compute_stage_data(ticker: str):
    tkr = yf.Ticker(ticker)
    hist = tkr.history(period="3y", interval="1wk")
    if hist.empty or len(hist) < 35:
        raise HTTPException(404, f"Not enough weekly history for {ticker} to compute stage")

    closes = hist["Close"].tolist()
    dates = [d.strftime("%Y-%m-%d") for d in hist.index]

    close_series = pd.Series(closes)
    ma_series = close_series.rolling(window=30).mean()
    ema_series = close_series.ewm(span=52, adjust=False).mean()

    ma_list = [round(v, 2) if pd.notna(v) else None for v in ma_series.tolist()]
    ema_list = [round(v, 2) for v in ema_series.tolist()]

    last_close = round(closes[-1], 2)
    last_ma = ma_series.iloc[-1]
    ma_5_ago = ma_series.iloc[-6] if len(ma_series) > 5 else ma_series.iloc[0]
    last_ema = ema_series.iloc[-1]
    ema_5_ago = ema_series.iloc[-6] if len(ema_series) > 5 else ema_series.iloc[0]

    price_vs_ma_pct = round((last_close - last_ma) / last_ma * 100, 2)
    ma_slope_pct = round((last_ma - ma_5_ago) / ma_5_ago * 100, 2) if ma_5_ago else 0.0
    price_vs_ema_pct = round((last_close - last_ema) / last_ema * 100, 2)
    ema_slope_pct = round((last_ema - ema_5_ago) / ema_5_ago * 100, 2) if ema_5_ago else 0.0

    stage = _classify_stage(price_vs_ma_pct, ma_slope_pct)
    signal = _signal_from_stage(stage, price_vs_ma_pct)
    base_confidence = _confidence_from_stage(price_vs_ma_pct, ma_slope_pct, stage)
    ema_adjustment = _ema_alignment_adjustment(price_vs_ma_pct, ma_slope_pct, price_vs_ema_pct, ema_slope_pct)
    confidence = int(max(35, min(95, round(base_confidence + ema_adjustment))))

    # 52-Week Range
    recent_52 = closes[-52:] if len(closes) >= 52 else closes
    high_52 = round(max(recent_52), 2)
    low_52 = round(min(recent_52), 2)

    # Key Support & Resistance (actionable for retail investors)
    recent_10 = closes[-10:]
    recent_26 = closes[-26:]
    support_candidates = [round(v, 2) for v in [min(recent_10), last_ma, min(recent_26)] if v < last_close * 0.99]
    support = max(support_candidates) if support_candidates else round(last_close * 0.95, 2)

    resistance_candidates = [round(v, 2) for v in [max(recent_10), max(recent_26), high_52] if v > last_close * 1.01]
    resistance = min(resistance_candidates) if resistance_candidates else round(last_close * 1.08, 2)

    upside_pct = round((resistance - last_close) / last_close * 100, 1)
    downside_pct = round((last_close - support) / last_close * 100, 1)
    rr_ratio = round(upside_pct / max(0.5, downside_pct), 1)

    display_points = min(len(dates), 104)
    slice_from = len(dates) - display_points

    return {
        "ticker": ticker,
        "dates": dates[slice_from:],
        "closes": [round(c, 2) for c in closes[slice_from:]],
        "ma30": ma_list[slice_from:],
        "ema52": ema_list[slice_from:],
        "stage": stage,
        "stageLabel": STAGE_LABELS[stage],
        "stageDescription": STAGE_DESCRIPTIONS[stage],
        "priceVsMaPct": price_vs_ma_pct,
        "maSlopePct": ma_slope_pct,
        "priceVsEmaPct": price_vs_ema_pct,
        "emaSlopePct": ema_slope_pct,
        "emaAgreement": ema_adjustment > 0,
        "signal": signal,
        "confidence": confidence,
        "high52": high_52,
        "low52": low_52,
        "support": support,
        "resistance": resistance,
        "upsidePct": upside_pct,
        "downsidePct": downside_pct,
        "riskReward": rr_ratio,
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
                        parsed_tuple = email.utils.parsedate_to_datetime(pubDate_str)
                        if parsed_tuple:
                            dt = parsed_tuple
                    except Exception:
                        pass

                clean_title = title
                if " - " in clean_title:
                    parts = clean_title.rsplit(" - ", 1)
                    if not publisher:
                        publisher = parts[1].strip()
                    clean_title = parts[0].strip()

                parsed.append({
                    "title": clean_title,
                    "link": link,
                    "publisher": publisher,
                    "date": dt
                })
            return parsed
    except Exception:
        return []

@app.get("/api/news/{ticker}")
async def get_news(ticker: str):
    yahoo_task = fetch_yahoo_news(ticker)
    google_task = fetch_google_news(ticker)

    results = await asyncio.gather(yahoo_task, google_task, return_exceptions=True)

    yahoo_articles = results[0] if isinstance(results[0], list) else []
    google_articles = results[1] if isinstance(results[1], list) else []

    all_articles = yahoo_articles + google_articles

    # Deduplicate by normalized title
    seen_titles = set()
    deduped = []
    for art in all_articles:
        norm = "".join(c.lower() for c in art["title"] if c.isalnum())
        if not norm:
            continue
        is_dup = any(norm in s or s in norm for s in seen_titles)
        if not is_dup:
            seen_titles.add(norm)
            deduped.append(art)

    tier_1_sources = {
        "reuters", "bloomberg", "the economic times", "livemint", "cnbc",
        "financial times", "the wall street journal", "wsj", "marketwatch",
        "forbes", "barron's", "business standard", "moneycontrol", "ndtv profit"
    }

    def get_tier(pub: str) -> int:
        p = pub.lower()
        if any(t in p for t in tier_1_sources):
            return 1
        return 2

    deduped.sort(key=lambda x: (get_tier(x["publisher"]), -x["date"].timestamp()))

    impact_keywords = ["surge", "plunge", "earnings", "profit", "loss", "acquisition", "fda", "merger", "dividend", "revenue", "multibagger"]

    final_articles = []
    for a in deduped[:8]:
        title_lower = a["title"].lower()
        is_impactful = any(kw in title_lower for kw in impact_keywords)
        final_articles.append({
            "title": a["title"],
            "link": a["link"],
            "publisher": a["publisher"],
            "pubDate": a["date"].strftime("%Y-%m-%d"),
            "isImpactful": is_impactful
        })

    return {"articles": final_articles}


# ── Gemini AI analysis endpoint ────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    ticker: str
    currentPrice: float
    oneYearReturn: Optional[float] = None
    monthlyChange: Optional[float] = None
    avgVolume: Optional[float] = None
    newsHeadlines: list[str] = []
    currency: str = "USD"
    stage: Optional[int] = None
    stageLabel: Optional[str] = None
    priceVsMaPct: Optional[float] = None
    computedSignal: Optional[str] = None
    computedConfidence: Optional[int] = None


@app.post("/api/analyze")
async def analyze_stock(req: AnalyzeRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(503, "Gemini API key not configured")

    news_block = "\n".join(f"- {h}" for h in req.newsHeadlines[:15]) or "No recent headlines."

    stage_context = ""
    if req.stage and req.stageLabel:
        stage_context = f"\nTechnical Stage Context:\n- Stan Weinstein Cycle: Stage {req.stage} ({req.stageLabel})\n- Price vs 30-Week Moving Average: {req.priceVsMaPct}%\n- Base Computed Signal: {req.computedSignal} ({req.computedConfidence}% confidence)\n"

    prompt = f"""You are a senior equity research analyst. Analyze the stock {req.ticker} and return ONLY valid JSON (no markdown, no backticks).

Current data:
- Price: {req.currency} {req.currentPrice}
- 1-Year Return: {req.oneYearReturn if req.oneYearReturn is not None else 'N/A'}%
- Monthly Change: {req.monthlyChange if req.monthlyChange is not None else 'N/A'}%
- Avg Monthly Volume: {req.avgVolume if req.avgVolume is not None else 'N/A'}{stage_context}
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

Include 5-7 factors. Be realistic — use headlines for sentiment and the numbers for financial/stage context. The forecastCurve should start near the current price and reflect your signal direction."""

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
        if r.status_code in (400, 403):
            raise HTTPException(502, f"Gemini API key is invalid or lacks access. Code: {r.status_code}")
        if r.status_code != 200:
            raise HTTPException(502, f"Gemini API error: {r.status_code} - {r.text}")

        data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        result = json.loads(text)

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
