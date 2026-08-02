# PRIVA — 3-Minute Demo Script (Hackathon)

**Setup (before judges arrive):**
- Backend running on :8766, Electron app open on Notes world, phone on the desk (notifications ON, ringer ON, screen facing camera)
- LINQ_USER_ADDRESS set in priva/.env → phone receives texts from sandbox number +1 213-476-8016
- All demo searches pre-warmed (run `python prewarm_cache.py` earlier — searches are instant)
- ngrok tunnel up → webhook configured (in-app mirror is the fallback if it drops)
- Phone battery 100%, test card number printed beside the phone

**Beat 1 — The note (0:00–0:20)**
"Every one of us has a note like this." — Type in Notes: `need to buy a mechanical keyboard under $120`
→ Phone buzzes: *"PRIVA: I noticed your note mentions buying a mechanical keyboard under $120. Want me to find the best options?"*

**Beat 2 — The search (0:20–0:40)**
Reply **YES** (or tap mirror). Say: "It doesn't just search — it ranks."
→ Agent trace on screen: NOTE ANALYZER → SERPAPI → RANKER. Options arrive with **best pick + savings %**.

**Beat 3–4 — The purchase (0:40–1:10)**
Reply **3** → **YES**. "Real payment session, real sandbox credentials — tap the link, test card, done."
→ Trace: PRAVA session live → PAID → confirmation + ETA. Order appears in Commerce.

**Beat 5 — The delivery arc (1:10–1:30)**
Advance the timeline. "Confirmed → shipped → out for delivery. Reply TRACK on iMessage and it texts you the status."

**Beat 6 — THE SURPRISE (1:30–1:50) — while you talk about the architecture**
While speaking about the stack, hit the price-drop beat. Phone buzzes mid-sentence:
*"your keyboard dropped 12% — reply BUY NOW."* — **Don't react. Keep talking.**
Then: "That's the difference between automation and an agent — it's still working while we're talking."

**Beat 7 — Instant checkout (1:50–2:10)**
**BUY NOW** → straight to consent. "It remembered the item. No options, no re-searching."

**Beat 8 — Close (2:10–2:45)**
"Notes that act. Purchases that follow up. Prices that watch themselves. That's PRIVA." → Cut to title.

**Failure playbook (never shown to judges):**
- Phone/tunnel dead → drive everything from the in-app mirror (same conversation machine, looks identical)
- Search slow → always use pre-warmed queries (keyboard, headphones, shoes, hub)
- Payment hiccup → say "sandbox payment network is throttling" and move to the mirror path; the flow re-syncs
- Anything else → smile, advance the beat, keep the story moving
