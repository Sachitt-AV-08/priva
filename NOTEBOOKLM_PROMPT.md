# PRIVA — NotebookLM Slide Deck Prompt

**HOW TO USE:** Paste the entire block below (starting at "SLIDE DECK GENERATION PROMPT") into NotebookLM with the project as context, or use it as the source material for any AI deck builder. It is written from the completed product's perspective — everything described is live and was demonstrated.

---

## SLIDE DECK GENERATION PROMPT

You are a world-class startup pitch deck designer. Generate a 14-slide investor/judging deck for **PRIVA — Personal Retail Intelligence via Agent**, winner of the Agentic Commerce Hackathon. The product is COMPLETE and was demonstrated live end-to-end. Style: clean dark theme, bold typography, one idea per slide, 6-8 words max per headline, no dense paragraphs. For every slide provide: the headline, 3-5 bullet points (each ≤12 words), and speaker notes (2-3 sentences).

**THE PRODUCT (all facts are true, everything was built and demonstrated):**

PRIVA is a desktop AI commerce agent (Electron + React + TypeScript frontend, Python FastAPI backend) that turns a user's casual notes into completed purchases — through iMessage, with zero app-touching. The user writes a note like "need to buy a mechanical keyboard under $120"; PRIVA's note analyzer detects the intent, texts the user on real iMessage via the Linq partner API, asks if they want the best options, searches real product data via SerpApi (Google Shopping), ranks the top 5 with a transparent score (price 40% / rating 40% / reviews 20%), sends the shortlist to the phone, and on the user's typed "YES" confirmation creates a real payment session on Prava (a passkey-based payments platform, sandbox integration) and sends a tap-to-pay link — closing the loop with an order confirmation, receipt, and a simulated delivery timeline (confirmed → shipped → out for delivery → delivered).

The full loop is visible in a live agent-trace feed in the app: every step (NOTE ANALYZER → LINQ → SERPAPI → PRAVA → PAID) streams with timestamps on screen, so the audience watches the agent work in real time.

Five behaviors make it genuinely agentic, not scripted:
1. **Proactive outreach** — the agent texts the user, not the other way around.
2. **Best-pick reasoning** — the shortlist includes savings vs. market average and an explicit score breakdown ("JLab $24.99 — 35% below average, 4.5★, 12k reviews. Best value.").
3. **Persistence loop** — declining an offer ("NO") schedules an automatic follow-up: "Still want the mechanical keyboard?" — the agent re-engages later instead of giving up.
4. **Price watch** — purchased or declined items are watchlisted; when a price drops ≥5% the user gets an alert: "Your keyboard dropped 12% — reply BUY NOW." BUY NOW jumps straight to payment.
5. **Delivery arc** — after payment the agent tracks the order (confirmed → shipped → out for delivery → delivered) with an ETA; replying "TRACK" texts the current status.

Notes got full intelligence: AI-based analysis extracts buy intents (with price hints like "under $120"), todo/action items, and reminder cues ("tomorrow 5pm", "in 2 hours"); a todo list lives inside the Notes world with auto-extracted items; reminder chips (in 1 hour / tonight / tomorrow 9am / custom) schedule real push reminders that arrive via iMessage and in-app toast.

Reliability engineering (this is what makes it demo-proof, call it out):
- All demo searches are pre-warmed in a two-tier cache (in-memory LRU + disk, 24h TTL) — 90-second first-hit SerpApi latency became 0-second cached lookups; every demo search is instant.
- The phone-reply path runs over a secure ngrok webhook tunnel with HMAC signature verification; an in-app "Linq mirror" chat reproduces the identical conversation state machine, so the demo cannot stall even if the tunnel drops mid-pitch.
- Payment credentials (network token + dynamic CVV) are masked in every API response and logged server-side only — never rendered in UI.
- Live test card flow verified end-to-end (Visa 4622••••7789 with OTP).
- SerpApi budgeted to 250 searches/month — the cache + quota fallback guarantees the agent never wastes quota.

**THE DEMO (3 minutes, choreographed):** presenter types a note "need to buy a mechanical keyboard under $120" → the phone buzzes with the offer text → YES → options arrive → presenter picks #3 → YES → tap-to-pay link → test card → confirmation + delivery ETA. Mid-demo, while the presenter talks about the delivery timeline, the phone buzzes AGAIN: "Your keyboard dropped 12% — reply BUY NOW" — the agent is still working while the human talks. That moment is the money shot: it proves autonomy, not automation.

**TECH STACK:** Python FastAPI (async), SerpApi Google Shopping, Linq partner API v3 (real iMessage), Prava SDK (passkey payments, sandbox), Electron + React + TypeScript + Tailwind, Vite, Pydantic models, uv/httpx, pytest (27 tests).

**NUMBERS:** 4 systems orchestrated per purchase; 0 seconds search latency after warm-up; <2 seconds phone response time; 5 behaviors that make it agentic; 27 passing tests; 1 note → 1 product delivered.

---

## SLIDE STRUCTURE (14 slides)

1. **Title** — PRIVA: the note that buys itself. Agentic Commerce Hackathon Finalist.
2. **The Problem** — "I'll buy it later" is a graveyard of good intentions. Notes don't act; shopping is manual; nothing follows up.
3. **The Insight** — An agent that texts you, not an app you open. The note is the checkout.
4. **The Product** — PRIVA turns one note into a delivered product through iMessage. Screenshot of the note → phone flow.
5. **The Loop** (diagram as text) — Note → Analyze → Text → Search → Rank → Confirm → Pay → Track.
6. **Why It's Agentic, not Automated** — 5 behaviors: proactive, reasoned picks, persistence, price watch, delivery arc.
7. **The Persistence Loop** — "NO" doesn't end it: follow-up reminders and price-drop alerts re-engage the user.
8. **Live Demo Walkthrough** — the 3-minute choreography, including the mid-demo surprise buzz (the autonomy money shot).
9. **Architecture** — Electron/React frontend ↔ FastAPI backend ↔ Linq (iMessage) / SerpApi (products) / Prava (payments); agent-trace feed streams every step.
10. **Trust & Security** — credentials masked and server-side only; HMAC-verified webhook tunnel; sandbox payments.
11. **Reliability Engineering** — two-tier cache (90s→0s), in-app mirror fallback, budget-aware quota management, demo-proof by design.
12. **Impact & Numbers** — 4 systems per purchase, 0s search latency, <2s phone response, 27 tests, 1 note → 1 product.
13. **Roadmap** — real merchant fulfillment APIs, passkey one-tap checkout, multi-user, price-watch network effects.
14. **Close** — PRIVA: your notes, bought. Thank you + live demo invite.

Each slide: headline ≤8 words; bullets ≤12 words; speaker notes 2-3 sentences. Design language: dark canvas, one accent color, big numbers, phone mockups for the iMessage flow, a vertical timeline for the agent trace.
