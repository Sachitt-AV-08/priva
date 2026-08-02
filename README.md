# PRIVA — Personal Retail Intelligence via Agent

> Your iMessage-native AI shopping assistant. PRIVA reads the notes you already keep, finds the best buys inside your budget, pays with **Prava (Visa Intelligent Commerce)**, and chats with you over **Linq SMS** — while a mirror web app keeps the whole conversation on screen.

Built for the Agentic Commerce Hackathon. **2nd place, Agentic Hackathon (AgenticAI A1 Arena)** runner-up-grade polish; 127 tests passing.

---

## The demo in 30 seconds

1. Drop a quick note: *"need a usb-c hub for travel, under 300"*
2. PRIVA detects the buy intent instantly → texts you with a preference question
3. You answer → it runs a **deep SerpApi search**, filters by budget, ranks by quality
4. You pick → checkout via **Prava** (sandbox) → the transaction lands on your budget
5. The full SMS conversation is **mirrored live** on the web app (`priva_mirror` thread)

![PRIVA web app](priva-app/public/priva.png)

## What makes PRIVA an *agent*

- **Agentic flow**: notes → intent extraction → conversational offer loop (offer → prefs → results → consent → pay → track) — the agent drives the whole purchase, you just answer texts
- **Real SMS channel**: Linq webhook → verified HMAC signatures → intent routing → replies
- **Budget intelligence**: monthly caps, borrowed-into-next-month tracking, over-budget tagging, spend analysis, merchant/day breakdowns
- **Quality-first ranking**: budget-band spec matching, entry/premium token awareness, review log-scaling, merchant trust
- **Autonomous follow-ups**: reminders, price-drop watchlist alerts, note offers — all proactive

## Architecture

```
                 ┌──────────────────────────────────────────────┐
  iMessage/SMS ──►│  Linq Webhook ─► PRIVA Agent (FastAPI)       │
  (Linq sandbox) │      │  verify_webhook (HMAC)                 │
                 │      ▼                                        │
                 │  parse_intent ─► note offers / prefs          │
                 │      ▼                                        │
                 │  search_deep (SerpApi) ─► filter ─► rank      │
                 │      ▼                                        │
                 │  decide_best ─► consent ─► Prava checkout     │
                 │      ▼                                        │
                 │  transaction + budget + shipping tracking     │
                 └──────────────┬───────────────────────────────┘
                                │  REST API (CORS open)
                 ┌──────────────▼───────────────┐
  Browser ──────►│  PRIVA web app (React/TS)    │
  Electron ─────►│  worlds: commerce · notes ·   │
                 │  purchase-graph · tasks       │
                 └──────────────────────────────┘
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, uvicorn, httpx |
| Search | SerpApi (Google Shopping deep search) |
| Checkout | Prava / Visa Intelligent Commerce (sandbox) |
| Messaging | Linq (SMS sandbox, HMAC-verified webhooks) |
| Intelligence | Rule-based intent + budget-band spec matching; optional OpenAI gpt-4o-mini (`OPENAI_API_KEY`) |
| Frontend | TypeScript, React 18, Vite, @xyflow/react (purchase graph) |
| Shell | Electron 28 (desktop), PowerShell/Batch launchers |

## Repository layout

- `priva/` — FastAPI backend (server, agent, serpapi, prava, linq, notes, reminders, price watch, spending, voice) + 127 tests
- `priva-app/` — React/TypeScript web + Electron app (builds to a static site for GitHub Pages)

## Run it

### Backend

```bash
cd priva
pip install -r requirements.txt
cp .env.example .env        # fill in keys
python server.py            # → http://localhost:8766  (/health)
python -m pytest tests/     # 127 passing
```

### Web app

```bash
cd priva-app
npm install
npm run dev                 # → http://localhost:5173 (web-only mode)
npm run build               # static site → dist/
```

### Desktop app (Electron)

```bash
npm run electron:dev        # or: npm run package → portable .exe
```

### One-command local launch (Windows)

```powershell
.\start_priva.ps1           # backend + ngrok + app in one go
```

## Deploy

- **Backend**: Render free tier — click *New → Blueprint* and point at this repo (`render.yaml` included). Set env vars from `.env.example`. The server auto-picks Render's `$PORT`.
- **Frontend**: GitHub Pages — the `deploy-pages` workflow builds `priva-app` and publishes `dist/`. The app auto-probes the backend at runtime (env `VITE_API_BASE` → known endpoints → `localhost`), so one build works everywhere.

## Environment variables

| Var | Purpose |
|---|---|
| `LINQ_API_KEY` / `LINQ_SANDBOX_NUMBER` / `LINQ_WEBHOOK_SECRET` | Linq SMS channel + webhook HMAC |
| `LINQ_USER_ADDRESS` | Your iMessage address for proactive texts (offers, reminders, alerts) |
| `PRAVA_SECRET_KEY` / `PRAVA_PUBLISHABLE_KEY` | Prava sandbox checkout |
| `SERPAPI_KEY` | Google Shopping deep search |
| `NOTE_LLM` / `OPENAI_API_KEY` | Optional LLM-enhanced note analysis |
| `DEMO_MODE=1` | Choreographed demo mode (staged beats, no real SMS needed) |

## Tests

```
python -m pytest priva/tests/ -q   # 127 passed
```

Covers: budget tiers & caps, note intelligence, offer context, preferences, purchase advisor, reach/ranking, spending, transcript mirroring (SMS ⇄ web), voice clear.
