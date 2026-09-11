# StockDash v2.0

Real-time stock analysis dashboard with AI-powered insights. One FastAPI service, one flat repo — serves both the API and the frontend directly, no build step, no subfolders.

**Data:** Yahoo Finance · **AI:** Gemini (with simulated fallback) · **Charts:** Chart.js

## Structure (flat — everything at repo root)

```
stockdash/
├── main.py              ← FastAPI: API routes + serves index.html/style.css/app.js
├── index.html
├── style.css
├── app.js
├── requirements.txt
└── .python-version      ← pins Python 3.11.9 on Render
```

## Local dev

```bash
pip install -r requirements.txt
export GEMINI_API_KEY="your-key-here"   # optional — falls back to simulated AI without it
uvicorn main:app --reload
```

Open `http://localhost:8000` — API and frontend both served from that one address.

## Deploy to Render

1. New **Web Service** → connect your GitHub repo
2. **Root Directory:** leave blank
3. **Build Command:** `pip install -r requirements.txt`
4. **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Environment variable: `GEMINI_API_KEY` (optional)

One service, one URL, done.

## Without Gemini

If `GEMINI_API_KEY` isn't set, the app falls back to a deterministic simulated AI — same signal every time for a given ticker.
