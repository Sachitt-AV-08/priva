# PRIVA — Personal Retail Intelligence via Agent

> Your iMessage-native AI shopping assistant. PRIVA reads the notes you already keep, finds the best buys inside your budget, pays with **Prava (Visa Intelligent Commerce)**, and chats with you over **Linq SMS** — while a mirror web app keeps the whole conversation on screen.

<div align="center">

[![Live demo](https://img.shields.io/badge/Live%20demo-github.io-brightgreen)](https://sachitt-av-08.github.io/priva/)
[![Latest release](https://img.shields.io/github/v/release/Sachitt-AV-08/priva)](https://github.com/Sachitt-AV-08/priva/releases)
[![Tests](https://img.shields.io/badge/tests-165%20passed-green)](https://github.com/Sachitt-AV-08/priva)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

Built for the **Agentic Commerce Hackathon**. 165 tests passing.

---

## The demo in 30 seconds

1. Drop a quick note: *"need a usb-c hub for travel, under 300"*
2. PRIVA detects the buy intent instantly → texts you with a preference question
3. You answer → it runs a **deep SerpApi search**, filters by budget, ranks by quality
4. You pick → checkout via **Prava** (sandbox) → the transaction lands on your budget
5. The full SMS conversation is **mirrored live** on the web app and desktop app

![PRIVA web app](priva-app/public/priva.png)

Try the live web demo: **https://sachitt-av-08.github.io/priva/** · Download the installer from the [latest release](https://github.com/Sachitt-AV-08/priva/releases/latest).

---

## What makes PRIVA an *agent*

- **Agentic flow**: notes → intent extraction → conversational offer loop (offer → prefs → results → consent → pay → track) — the agent drives the whole purchase, you just answer texts
- **Real SMS channel**: Linq webhook → verified HMAC signatures → intent routing → replies
- **Budget intelligence**: monthly caps, borrowed-into-next-month tracking, over-budget tagging, spend analysis, merchant/day breakdowns — **scoped per user**, so one user's spending never leaks into another's budget
- **Quality-first ranking**: budget-band spec matching, entry/premium token awareness, review log-scaling, merchant trust
- **Autonomous follow-ups**: reminders, price-drop watchlist alerts, note offers — all proactive
- **Honest agent trace**: the desktop app shows real pipeline stages (intent → search → rank → pay → checkout → deliver) with truthful labels — no fake "shopping intent detected" on empty notes

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
| Intelligence | Rule-based intent + budget-band spec matching; LLM via **NVIDIA NIM** (`deepseek-v4-flash`) or OpenAI (`OPENAI_API_KEY`) |
| Web | Next.js 14 static export (GitHub Pages) — login, dashboard, shop, admin console |
| Desktop | Electron 28 + React 18 + Vite + Tailwind |

## Repository layout

- Backend at repo root — `server.py`, `agent.py`, `users.py`, `serpapi_client.py`, `prava_client.py`, `linq_client.py`, `notes_store.py`, `reminder_service.py`, `price_watch.py`, `spending.py` + 165 tests in `tests/`
- `priva-site/` — Next.js web app (landing, OTP login, dashboard with live SMS mirror chat, shop, checkout, owner admin console)
- `priva-app/` — Electron desktop app (OTP login, chat world mirroring the same SMS thread, commerce, notes, purchase graph)

## Multi-user demo

- Sign up with **phone + name + OTP** (demo mode returns the code inline; real mode texts it via Linq).
- Every user gets a **per-user SMS mirror thread** (`priva_mirror_<uid>`): the same Linq conversation appears simultaneously on their phone, in the web app chat, and in the desktop app chat.
- The owner (phone set in `PRIVA_ADMIN_ADDRESS`) gets an **admin console** — all users, their live transcripts, and the agent activity feed.
- State is stored per user: notes, reminders, watchlist, transactions, purchases. The SMS-only flow (`user_id="local"`) still works unchanged for a single-owner setup.
- QR deep-link flow: the desktop app logs in and the web app accepts `/app?u=<user_id>` (demo mode only) so a judge's phone is in instantly.

## Run it

### Backend

```bash
pip install -r requirements.txt
cp .env.example .env        # fill in keys
python server.py            # → http://localhost:8766  (/health)
python -m pytest tests/     # 165 passing
```

### Web app

```bash
cd priva-site
npm install
npm run dev                 # → http://localhost:3000
npm run build               # static site → out/ (deploys to GitHub Pages)
```

### Desktop app (Electron)

```bash
cd priva-app
npm run electron:dev        # or: npm run package → portable .exe
```

### One-command local launch (Windows)

```powershell
.\start_priva.ps1           # backend + ngrok + app in one go
```

## Deploy

- **Backend**: Render free tier — click *New → Blueprint* and point at this repo (`render.yaml` included). Set env vars from `.env.example` (owner phone in `PRIVA_ADMIN_ADDRESS`). The server auto-picks Render's `$PORT`.
- **Frontend**: GitHub Pages — the `deploy-pages` workflow builds `priva-site` (Next.js static export) and publishes `out/`. The web app auto-probes the backend at runtime (env `NEXT_PUBLIC_PRIVA_API` → known endpoints → `localhost`), so one build works everywhere.
- **Installer**: `PRIVA-Setup-<version>.exe` is attached to each [GitHub release](https://github.com/Sachitt-AV-08/priva/releases) (signed with a code-signing cert + DigiCert timestamp).

## Environment variables

| Var | Purpose |
|---|---|
| `LINQ_API_KEY` / `LINQ_SANDBOX_NUMBER` / `LINQ_WEBHOOK_SECRET` | Linq SMS channel + webhook HMAC |
| `LINQ_USER_ADDRESS` | Your iMessage address for proactive texts (offers, reminders, alerts) |
| `PRAVA_SECRET_KEY` / `PRAVA_PUBLISHABLE_KEY` | Prava sandbox checkout |
| `SERPAPI_KEY` | Google Shopping deep search |
| `NOTE_LLM` / `LLM_MODEL` | OpenAI-compatible LLM endpoint + model (e.g. NVIDIA NIM `https://integrate.api.nvidia.com` / `deepseek-ai/deepseek-v4-flash`) |
| `OPENAI_API_KEY` | Fallback LLM key (used by `NOTE_LLM`/`LLM_MODEL` unless pointing elsewhere) |
| `DEMO_MODE=1` | Choreographed demo mode (staged beats, inline OTP codes, no real SMS needed) |
| `SIMULATE_PAYMENT=0` | `0` (default) = real Prava sandbox — payment finalizes only when the user completes it. `1` = auto-complete ~5s after session creation for a hands-free judge demo |
| `PRIVA_ADMIN_ADDRESS` | Phone (digits + country code) of the owner — becomes admin (owner console) |

## Tests

```
python -m pytest tests/ -q   # 165 passed
```

Covers: budget tiers & caps (incl. per-user scoping + payment simulation flag), note intelligence, offer context, preferences, purchase advisor, reach/ranking, spending, transcript mirroring (SMS ⇄ web), auth (OTP/token/admin), multi-user scoping, voice clear, and shipping (paid-only progression).
