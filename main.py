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
from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, Score

app = FastAPI(title="StockDash")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3.8-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

TYPESAFE_API_KEY = os.getenv("TYPESAFE_API_KEY", "")

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
async def get_chart(ticker: str, interval: str = "1d", range: str = "1y"):
    def _get_history():
        tkr = yf.Ticker(ticker)
        try:
            currency = tkr.fast_info.get("currency", "USD")
        except Exception:
            currency = "USD"

        # Reliable 52W high and low from fast_info (independent of requested timeframe)
        high_52 = None
        low_52 = None
        try:
            high_52 = round(float(tkr.fast_info.get("yearHigh")), 2) if tkr.fast_info.get("yearHigh") else None
            low_52 = round(float(tkr.fast_info.get("yearLow")), 2) if tkr.fast_info.get("yearLow") else None
        except Exception:
            pass

        # Fetch chart series and clean missing/zero values
        hist = tkr.history(period=range, interval=interval)
        if not hist.empty:
            hist = hist.dropna(subset=["Close"])
            hist = hist[hist["Close"] > 0]

        # Recent daily probe to ensure we have the exact latest trading close
        try:
            daily = tkr.history(period="5d", interval="1d")
            if not daily.empty:
                daily = daily.dropna(subset=["Close"])
                daily = daily[daily["Close"] > 0]
        except Exception:
            daily = None

        return hist, currency, daily, high_52, low_52

    try:
        hist, currency, daily, high_52, low_52 = await asyncio.to_thread(_get_history)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch chart: {str(e)}")

    if hist.empty:
        raise HTTPException(404, f"No chart data for {ticker}")

    history = []
    for index, row in hist.iterrows():
        c = round(float(row["Close"]), 2)
        if pd.isna(c) or c <= 0:
            continue
        history.append({
            "date": index.strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 2) if pd.notna(row.get("Open")) and row["Open"] > 0 else c,
            "close": c,
            "volume": int(row["Volume"]) if "Volume" in row and pd.notna(row["Volume"]) else 0,
        })

    if not history:
        raise HTTPException(404, f"No valid price data for {ticker}")

    last_close = None
    last_close_date = None
    if daily is not None and not daily.empty:
        last_close = round(float(daily["Close"].iloc[-1]), 2)
        last_close_date = daily.index[-1].strftime("%Y-%m-%d")
        # Ensure the final point in history aligns with the true last close and date
        history[-1]["close"] = last_close
        history[-1]["date"] = last_close_date
    elif history:
        last_close = history[-1]["close"]
        last_close_date = history[-1]["date"]

    start_close = history[0]["close"] if history else last_close
    start_date = history[0]["date"] if history else last_close_date

    period_change_pct = None
    if start_close and last_close and start_close > 0:
        period_change_pct = round(((last_close - start_close) / start_close) * 100, 2)

    # Fallback for 52W high/low if fast_info wasn't available
    if high_52 is None or low_52 is None:
        closes = [h["close"] for h in history]
        if high_52 is None:
            high_52 = round(max(closes), 2) if closes else last_close
        if low_52 is None:
            low_52 = round(min(closes), 2) if closes else last_close

    return {
        "ticker": ticker,
        "name": ticker,
        "currency": currency,
        "history": history,
        "lastClose": last_close,
        "lastCloseDate": last_close_date,
        "startClose": start_close,
        "startDate": start_date,
        "periodChangePct": period_change_pct,
        "high52": high_52,
        "low52": low_52,
    }


# ── Stage Analysis (Weinstein-style, computed from real price data) ────

STAGE_LABELS = {
    1: "Bottoming",
    2: "Uptrend",
    3: "Peak",
    4: "Downtrend",
}
STAGE_DESCRIPTIONS = {
    1: "Price is moving sideways and forming a floor — buyers and sellers are balanced, waiting for a breakout.",
    2: "Price is in a steady uptrend above its long-term average — buyers are firmly in control.",
    3: "Price is flattening out near its highs — upward momentum is slowing as investors lock in profits.",
    4: "Price is in a persistent downtrend below its long-term average — sellers are in control with high risk.",
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
        return "BUY"
    if stage == 4:
        return "SELL"
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
    if not hist.empty:
        hist = hist.dropna(subset=["Close"])
        hist = hist[hist["Close"] > 0]
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

    top_articles = deduped[:8]

    impact_keywords = ["surge", "plunge", "earnings", "profit", "loss", "acquisition", "fda", "merger", "dividend", "revenue", "multibagger"]

    final_articles = []
    for a in top_articles:
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


# ── Jev (TypeSafe) + Gemini Hybrid Analysis ────────────────────────────

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
    maSlopePct: Optional[float] = None
    emaAgreement: Optional[bool] = None
    peerTickers: list[str] = []
    computedSignal: Optional[str] = None
    computedConfidence: Optional[int] = None


def _fetch_peer_summary(ticker: str) -> dict:
    """Fetch basic price and stage info for a peer ticker via yfinance."""
    tkr = yf.Ticker(ticker)
    hist = tkr.history(period="2y", interval="1wk")
    if not hist.empty:
        hist = hist.dropna(subset=["Close"])
        hist = hist[hist["Close"] > 0]
    if hist.empty or len(hist) < 10:
        return None
    try:
        currency = tkr.fast_info.get("currency", "USD")
    except Exception:
        currency = "USD"
    closes = hist["Close"].tolist()
    last_close = round(closes[-1], 2)
    close_series = pd.Series(closes)
    window = min(30, len(closes) - 1)
    ma_series = close_series.rolling(window=window).mean()
    if pd.isna(ma_series.iloc[-1]):
        return {"ticker": ticker, "price": last_close, "currency": currency, "stage": 1, "stageLabel": "Bottoming", "priceVsMaPct": 0.0, "maSlopePct": 0.0}
    last_ma = ma_series.iloc[-1]
    ma_5_ago = ma_series.iloc[-6] if len(ma_series) > 5 else ma_series.iloc[0]
    price_vs_ma = round((last_close - last_ma) / last_ma * 100, 2)
    ma_slope = round((last_ma - ma_5_ago) / ma_5_ago * 100, 2) if ma_5_ago else 0.0
    stage = _classify_stage(price_vs_ma, ma_slope)
    return {
        "ticker": ticker,
        "price": last_close,
        "currency": currency,
        "stage": stage,
        "stageLabel": STAGE_LABELS[stage],
        "priceVsMaPct": price_vs_ma,
        "maSlopePct": ma_slope,
    }


async def _jev_analyze(req: AnalyzeRequest) -> dict:
    """Unified Jev call: signal, factors, per-headline scoring, per-peer ranking."""
    headlines = req.newsHeadlines[:8]
    peer_tickers = (req.peerTickers or [])[:4]

    # Fetch peer data in parallel
    peer_data = []
    if peer_tickers:
        async def _get_peer(t):
            try:
                return await asyncio.to_thread(_fetch_peer_summary, t)
            except Exception:
                return None
        peer_results = await asyncio.gather(*[_get_peer(t) for t in peer_tickers])
        peer_data = [p for p in peer_results if p is not None]

    # Build unified state
    headlines_block = "\n".join(f"[{i}] {h}" for i, h in enumerate(headlines)) or "No recent headlines."
    peer_block = ""
    if peer_data:
        peer_lines = [
            f"[{i}] {p['ticker']}: {p['currency']} {p['price']}, Stage {p['stage']} ({p['stageLabel']}), Price vs MA: {p['priceVsMaPct']}%"
            for i, p in enumerate(peer_data)
        ]
        peer_block = "\nPeer Stocks:\n" + "\n".join(peer_lines)

    state_text = (
        f"Stock: {req.ticker}\n"
        f"Price: {req.currency} {req.currentPrice}\n"
        f"1-Year Return: {req.oneYearReturn}%\n"
        f"Monthly Change: {req.monthlyChange}%\n"
        f"Avg Monthly Volume: {req.avgVolume}\n"
        f"Weinstein Stage: {req.stage} ({req.stageLabel})\n"
        f"Price vs 30-Week MA: {req.priceVsMaPct}%\n"
        f"MA Slope (5-week): {req.maSlopePct}%\n"
        f"EMA Agreement: {req.emaAgreement}\n"
        f"Recent Headlines:\n{headlines_block}"
        f"{peer_block}"
    )

    # Build questions dict — core questions
    questions = {
        "signal": Choice(
            instructions="What trading signal is appropriate for this stock right now?",
            criteria={
                "BUY": "Stock trending up or bottoming with favorable risk/reward",
                "HOLD": "Mixed signals, neither clearly bullish nor bearish",
                "SELL": "Stock weakening, declining trend, unfavorable outlook",
            },
        ),
        "news_sentiment": Score(
            instructions="Overall sentiment of the recent news headlines for this stock",
            criteria=[
                "Very negative — headlines about losses, lawsuits, downgrades, or crises",
                "Somewhat negative — cautious or mildly bearish headlines",
                "Neutral — routine or mixed headlines",
                "Somewhat positive — growth signals, upgrades, or positive developments",
                "Very positive — strong earnings, breakthroughs, or major wins",
            ],
        ),
        "trend_strength": Score(
            instructions="How strong is the current price trend based on the technical data?",
            criteria=[
                "Very weak trend — price far below falling averages",
                "Weak trend — price below averages or averages flattening",
                "No clear trend — sideways movement",
                "Moderate trend — price above rising averages",
                "Strong trend — price well above steeply rising averages",
            ],
        ),
        "risk_level": Score(
            instructions="How risky is it to buy this stock right now?",
            criteria=[
                "Low risk — strong uptrend, good support levels",
                "Moderate risk — some uncertainty but reasonable outlook",
                "High risk — weak trend, high volatility, or bearish signals",
            ],
        ),
        "news_is_material": Noul(
            instructions="Do the recent headlines contain news that could significantly move this stock's price?",
        ),
        "momentum_bullish": Noul(
            instructions="Is the stock's price momentum currently bullish based on the technical data?",
        ),
        "earnings_in_headlines": Noul(
            instructions="Do any headlines mention earnings, revenue, profit, or financial results?",
        ),
    }

    # Per-headline questions (up to 8 headlines x 2 = 16 questions)
    for i in range(len(headlines)):
        questions[f"headline_impact_{i}"] = Noul(
            instructions=f"Could headline [{i}] significantly move the stock's price?",
        )
        questions[f"headline_sentiment_{i}"] = Score(
            instructions=f"Sentiment of headline [{i}] for investors",
            criteria=[
                "Very negative",
                "Somewhat negative",
                "Neutral",
                "Somewhat positive",
                "Very positive",
            ],
        )

    # Per-peer questions (up to 4 peers x 2 = 8 questions)
    for i, p in enumerate(peer_data):
        questions[f"peer_signal_{i}"] = Choice(
            instructions=f"What trading signal is appropriate for peer stock [{i}] ({p['ticker']})?",
            criteria={
                "BUY": "Uptrend or bottoming",
                "HOLD": "Mixed signals",
                "SELL": "Weakening",
            },
        )
        questions[f"peer_momentum_{i}"] = Noul(
            instructions=f"Is peer stock [{i}] ({p['ticker']})'s momentum currently bullish?",
        )

    async with AsyncTypeSafeClient() as client:
        response = await client.system_one(state=state_text, questions=questions)

    # Extract core results
    signal_answer = response.choices["signal"]
    news_score = response.scores["news_sentiment"]
    trend_score = response.scores["trend_strength"]
    risk_score = response.scores["risk_level"]
    news_material = response.nouls["news_is_material"]
    momentum = response.nouls["momentum_bullish"]
    earnings = response.nouls["earnings_in_headlines"]

    # Confidence: start from Jev's raw confidence, adjust for EMA/SMA slope agreement
    signal = signal_answer.choice
    confidence = round(signal_answer.confidence * 100)
    bullish = signal == "BUY"
    bearish = signal == "SELL"
    if (bullish or bearish) and req.emaAgreement is not None:
        if req.emaAgreement:
            # EMA and SMA slopes agree with each other — check if they agree with signal
            sma_positive = (req.maSlopePct or 0) > 0
            if sma_positive == bullish:
                confidence += 5
            else:
                confidence -= 5
        # If emaAgreement is False, slopes disagree with each other — no adjustment
    confidence = max(35, min(95, confidence))

    # Build factors
    news_impact = round((news_score.score - 3) * 3.3)
    trend_impact = round((trend_score.score - 3) * 3.3)
    risk_impact = round((risk_score.score - 2) * -5)
    momentum_impact = round((momentum.noul - 0.5) * 10)

    factors = [
        {
            "name": "Price Trend Strength",
            "desc": f"Technical trend rated {trend_score.score:.1f}/5 — {'strong upward momentum' if trend_score.score > 3.5 else 'weak or flat momentum' if trend_score.score < 2.5 else 'moderate momentum'}.",
            "type": "financial",
            "impact": max(-10, min(10, trend_impact)),
        },
        {
            "name": "News Sentiment",
            "desc": f"Recent headlines rated {news_score.score:.1f}/5 sentiment — {'positive coverage' if news_score.score > 3.5 else 'negative coverage' if news_score.score < 2.5 else 'mixed coverage'}.",
            "type": "sentiment",
            "impact": max(-10, min(10, news_impact)),
        },
        {
            "name": "Buying Momentum",
            "desc": f"{'Bullish' if momentum.noul > 0.6 else 'Bearish' if momentum.noul < 0.4 else 'Neutral'} momentum ({momentum.noul:.0%} probability bullish).",
            "type": "financial",
            "impact": max(-10, min(10, momentum_impact)),
        },
        {
            "name": "Risk Assessment",
            "desc": f"Risk level rated {risk_score.score:.1f}/3 — {'low risk entry' if risk_score.score < 1.5 else 'high risk, proceed with caution' if risk_score.score > 2.3 else 'moderate risk'}.",
            "type": "macro",
            "impact": max(-10, min(10, risk_impact)),
        },
        {
            "name": "Market Cycle Position",
            "desc": f"Stage {req.stage} ({req.stageLabel}) — price is {abs(req.priceVsMaPct or 0):.1f}% {'above' if (req.priceVsMaPct or 0) >= 0 else 'below'} its 30-week average.",
            "type": "macro",
            "impact": max(-10, min(10, round((req.priceVsMaPct or 0) / 2))),
        },
    ]

    if news_material.noul > 0.6:
        factors.append({
            "name": "Breaking Developments",
            "desc": f"Material news detected ({news_material.noul:.0%} confidence) that could move the stock price.",
            "type": "sentiment",
            "impact": news_impact,
        })

    if earnings.noul > 0.5:
        factors.append({
            "name": "Earnings News",
            "desc": "Recent headlines mention financial results, which often drive short-term price moves.",
            "type": "financial",
            "impact": news_impact,
        })

    # Per-headline scoring results
    news_scoring = []
    for i in range(len(headlines)):
        impact_noul = response.nouls[f"headline_impact_{i}"].noul
        sentiment_val = response.scores[f"headline_sentiment_{i}"].score
        news_scoring.append({
            "sentimentScore": round(sentiment_val, 2),
            "impactConfidence": round(impact_noul, 2),
        })

    # Per-peer ranking results
    peer_ranking = []
    for i, p in enumerate(peer_data):
        peer_sig_answer = response.choices[f"peer_signal_{i}"]
        peer_mom = response.nouls[f"peer_momentum_{i}"].noul
        peer_conf = round(peer_sig_answer.confidence * 100)
        peer_ranking.append({
            "ticker": p["ticker"],
            "signal": peer_sig_answer.choice,
            "momentum": round(peer_mom, 2),
            "confidence": max(35, min(95, peer_conf)),
        })
    signal_weight = {"BUY": 3, "HOLD": 2, "SELL": 1}
    peer_ranking.sort(key=lambda x: (signal_weight.get(x["signal"], 3), x["confidence"]), reverse=True)
    for rank_idx, pr in enumerate(peer_ranking, 1):
        pr["rank"] = rank_idx

    return {
        "signal": signal,
        "confidence": confidence,
        "factors": factors,
        "jevPowered": True,
        "newsScoring": news_scoring,
        "peerRanking": peer_ranking,
    }


@app.post("/api/analyze")
async def analyze_stock(req: AnalyzeRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(503, "Gemini API key not configured")

    # Run Gemini (verdict) and Jev (peer/news) in parallel
    gemini_task = _legacy_gemini_analyze(req)

    jev_extras = {}
    if TYPESAFE_API_KEY:
        async def _get_jev():
            try:
                return await _jev_analyze(req)
            except Exception:
                return {}
        jev_task = _get_jev()
        gemini_result, jev_result = await asyncio.gather(gemini_task, jev_task)
        jev_extras = jev_result
    else:
        gemini_result = await gemini_task

    # Gemini drives the verdict (signal, confidence, headline, detail, action, factors, forecast)
    result = gemini_result
    result["jevPowered"] = bool(jev_extras)

    # Add Jev's peer ranking and news scoring on top
    result["newsScoring"] = jev_extras.get("newsScoring", [])
    result["peerRanking"] = jev_extras.get("peerRanking", [])

    return result


async def _legacy_gemini_analyze(req: AnalyzeRequest):
    """Original Gemini-only analysis as fallback when Jev is unavailable."""
    news_block = "\n".join(f"- {h}" for h in req.newsHeadlines[:15]) or "No recent headlines."

    stage_context = ""
    if req.stage and req.stageLabel:
        stage_context = f"\nTechnical Stage Context:\n- Stan Weinstein Cycle: Stage {req.stage} ({req.stageLabel})\n- Price vs 30-Week Moving Average: {req.priceVsMaPct}%\n- Base Computed Signal: {req.computedSignal} ({req.computedConfidence}% confidence)\n"

    prompt = f"""You are a helpful, clear financial advisor explaining stock analysis to everyday retail investors and beginners. Analyze the stock {req.ticker} and return ONLY valid JSON (no markdown, no backticks).

Current data:
- Price: {req.currency} {req.currentPrice}
- 1-Year Return: {req.oneYearReturn if req.oneYearReturn is not None else 'N/A'}%
- Monthly Change: {req.monthlyChange if req.monthlyChange is not None else 'N/A'}%
- Avg Monthly Volume: {req.avgVolume if req.avgVolume is not None else 'N/A'}{stage_context}
Recent headlines:
{news_block}

CRITICAL BEGINNER-FRIENDLY TONE & VOCABULARY RULES:
- Write in simple, clear, conversational English that anyone without a finance background can easily understand.
- DO NOT use confusing Wall Street jargon or technical trader terms.
- adviceHeadline: 6-10 words, bold and clear.
- adviceDetail: 2-3 simple, friendly sentences.
- adviceAction: 1 actionable, practical sentence.

Return this exact JSON schema:
{{
  "signal": "BUY" | "HOLD" | "SELL",
  "confidence": <number 0-100>,
  "forecastCurve": [<12 numbers: predicted monthly closing prices for the next 12 months>],
  "adviceHeadline": "<short bold verdict>",
  "adviceDetail": "<2-3 simple sentences>",
  "adviceAction": "<1 simple, actionable sentence>",
  "factors": [
    {{"name": "<factor name>", "desc": "<1 clear sentence>", "type": "macro" | "sentiment" | "financial", "impact": <integer -10 to 10>}}
  ]
}}

Include 5-7 factors. The forecastCurve should start near the current price and reflect your signal direction."""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{GEMINI_URL}?key={GEMINI_API_KEY}", json=payload, timeout=30)

        if r.status_code != 200:
            raise HTTPException(502, f"Gemini API error: {r.status_code}")

        data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        result = json.loads(text)

        VALID_SIGNALS = {"BUY", "HOLD", "SELL"}
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


# ── Fundamentals ──────────────────────────────────────────────────────

@app.get("/api/fundamentals/{ticker}")
async def get_fundamentals(ticker: str):
    def _fetch():
        tkr = yf.Ticker(ticker)
        keys = ["marketCap", "trailingPE", "forwardPE", "dividendYield",
                "revenueGrowth", "profitMargins", "sector", "industry"]
        result = {k: None for k in keys}
        try:
            info = tkr.info
            if info and isinstance(info, dict):
                for k in keys:
                    val = info.get(k)
                    if val is not None:
                        result[k] = val
        except Exception:
            pass
        if result["marketCap"] is None:
            try:
                result["marketCap"] = tkr.fast_info.get("marketCap")
            except Exception:
                pass
        return result

    try:
        data = await asyncio.to_thread(_fetch)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch fundamentals: {str(e)}")
    return data


# ── Watchlist Analyze ─────────────────────────────────────────────────

def _fetch_ticker_summary(ticker: str) -> dict:
    """Fetch basic price, return, and stage data for a watchlist ticker."""
    tkr = yf.Ticker(ticker)
    hist = tkr.history(period="1y", interval="1wk")
    if not hist.empty:
        hist = hist.dropna(subset=["Close"])
        hist = hist[hist["Close"] > 0]
    if hist.empty or len(hist) < 5:
        return None
    try:
        currency = tkr.fast_info.get("currency", "USD")
    except Exception:
        currency = "USD"
    closes = hist["Close"].tolist()
    last_close = round(closes[-1], 2)
    first_close = closes[0]
    yr_return = round((last_close - first_close) / first_close * 100, 2) if first_close > 0 else 0.0
    close_series = pd.Series(closes)
    window = min(30, len(closes) - 1)
    ma_series = close_series.rolling(window=window).mean()
    if pd.isna(ma_series.iloc[-1]):
        stage = 1
        price_vs_ma = 0.0
        ma_slope = 0.0
    else:
        last_ma = ma_series.iloc[-1]
        ma_5_ago = ma_series.iloc[-6] if len(ma_series) > 5 else ma_series.iloc[0]
        price_vs_ma = round((last_close - last_ma) / last_ma * 100, 2)
        ma_slope = round((last_ma - ma_5_ago) / ma_5_ago * 100, 2) if ma_5_ago else 0.0
        stage = _classify_stage(price_vs_ma, ma_slope)
    signal = _signal_from_stage(stage, price_vs_ma)
    monthly_change_pct = 0.0
    if len(closes) >= 5:
        month_ago = closes[-5] if len(closes) >= 5 else closes[0]
        monthly_change_pct = round((last_close - month_ago) / month_ago * 100, 2) if month_ago else 0.0
    return {
        "ticker": ticker,
        "lastClose": last_close,
        "currency": currency,
        "yrReturn": yr_return,
        "monthlyChangePct": monthly_change_pct,
        "stage": stage,
        "stageLabel": STAGE_LABELS[stage],
        "signal": signal,
    }


class WatchlistRequest(BaseModel):
    tickers: list[str]


@app.post("/api/watchlist/analyze")
async def analyze_watchlist(req: WatchlistRequest):
    tickers = req.tickers
    if len(tickers) > 10:
        tickers = tickers[:10]

    # Fetch basic data for all tickers in parallel
    async def _get_summary(t):
        try:
            return await asyncio.to_thread(_fetch_ticker_summary, t)
        except Exception:
            return None

    summaries = await asyncio.gather(*[_get_summary(t) for t in tickers])
    valid = [s for s in summaries if s is not None]

    if not valid:
        return {"results": []}

    # One Jev call for all tickers if API key is set
    if TYPESAFE_API_KEY and valid:
        try:
            state_lines = [
                f"[{i}] {s['ticker']}: {s['currency']} {s['lastClose']}, 1Y Return: {s['yrReturn']}%, Stage {s['stage']} ({s['stageLabel']})"
                for i, s in enumerate(valid)
            ]
            state_text = "Watchlist stocks:\n" + "\n".join(state_lines)

            questions = {}
            for i, s in enumerate(valid):
                questions[f"signal_{i}"] = Choice(
                    instructions=f"What trading signal is appropriate for stock [{i}] ({s['ticker']})?",
                    criteria={
                        "BUY": "Uptrend or bottoming",
                        "HOLD": "Mixed signals",
                        "SELL": "Weakening",
                    },
                )
                questions[f"momentum_{i}"] = Noul(
                    instructions=f"Is stock [{i}] ({s['ticker']})'s momentum currently bullish?",
                )

            async with AsyncTypeSafeClient() as client:
                response = await client.system_one(state=state_text, questions=questions)

            results = []
            for i, s in enumerate(valid):
                sig = response.choices[f"signal_{i}"]
                mom = response.nouls[f"momentum_{i}"]
                results.append({
                    **s,
                    "signal": sig.choice,
                    "confidence": max(35, min(95, round(sig.confidence * 100))),
                    "momentum": round(mom.noul, 2),
                })
            return {"results": results}
        except Exception:
            pass

    # Fallback without Jev
    results = []
    for s in valid:
        results.append({**s, "confidence": 50, "momentum": 0.5})
    return {"results": results}


@app.get("/health")
async def health():
    return {"status": "ok", "gemini_configured": bool(GEMINI_API_KEY), "jev_configured": bool(TYPESAFE_API_KEY)}


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
