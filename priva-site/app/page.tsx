import DemoSection from "../components/DemoSection";
import { DOWNLOAD_URL, GITHUB_URL, WEB_APP_URL } from "../lib/constants";

const FEATURES = [
  {
    icon: "🧠",
    title: "An agent that closes the loop",
    desc: "Notes → buy intent → preference question → deep search → ranked picks → consent → checkout → tracking. PRIVA drives the whole purchase; you just answer texts.",
  },
  {
    icon: "💬",
    title: "Real SMS, real iMessage",
    desc: "Linq webhook with HMAC-verified signatures. PRIVA texts you offers, preference questions, and reminders on your actual phone — no app needed.",
  },
  {
    icon: "🎯",
    title: "Quality-first, budget-aware",
    desc: "Deep SerpApi search with budget-band spec matching, entry/premium token ranking, merchant trust, and a hard budget cap. No budget blowouts.",
  },
  {
    icon: "💳",
    title: "Checkout on Prava (Visa)",
    desc: "One-tap checkout sessions via Prava / Visa Intelligent Commerce sandbox, with budget-excess detection before you pay.",
  },
  {
    icon: "🛍️",
    title: "Proactive follow-ups",
    desc: "Price-drop watchlist alerts, reminders from natural-language times, and urgent-offer pacing when a note says ASAP.",
  },
  {
    icon: "📊",
    title: "Your spending, understood",
    desc: "Monthly caps, borrowed-into-next-month, spend by merchant and day — visualized in a live purchase graph.",
  },
];

const STEPS = [
  ["Type a note", "“need a usb-c hub for travel, under 300” — the kind of note you already keep."],
  ["Get texted", "PRIVA texts a preference question to your phone via Linq SMS."],
  ["Answer", "“black, 8-in-1” — preferences are extracted and remembered."],
  ["Pick a winner", "Deep search returns budget-capped, quality-ranked options with a best pick."],
  ["Pay & track", "Prava sandbox checkout, budget accounting, and shipping progress."],
];

export default function Page() {
  return (
    <main className="site">
      <nav className="nav">
        <div className="logo">
          <span className="logo-mark">P</span>
          <span>PRIVA</span>
        </div>
        <div className="nav-links">
          <a href="#demo">Live demo</a>
          <a href="#how">How it works</a>
          <a href="#install">Install</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a className="nav-cta" href="/login">Log in →</a>
        </div>
      </nav>

      <header className="hero">
        <p className="badge">Agentic Commerce Hackathon · 2nd place · Visa / Linq / SerpApi</p>
        <h1>
          Your notes, turned into
          <br />
          <span className="grad">your best buys.</span>
        </h1>
        <p className="hero-sub">
          PRIVA reads the notes you already keep, finds the best options inside your budget,
          pays with <b>Prava</b>, and texts you the whole time on <b>Linq SMS</b>.
        </p>
        <div className="hero-cta">
          <a className="btn primary" href="#demo">Try the live demo</a>
          <a className="btn" href={DOWNLOAD_URL}>Download installer</a>
          <a className="btn ghost" href={WEB_APP_URL} target="_blank" rel="noreferrer">Open full web app</a>
        </div>
      </header>

      <section id="demo" className="section">
        <h2>Live demo <span className="dim">— the notes part</span></h2>
        <DemoSection />
      </section>

      <section className="section">
        <h2>Why it&apos;s an <span className="grad">agent</span>, not a chatbot</h2>
        <div className="grid">
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <div className="card-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="section">
        <h2>How it works</h2>
        <div className="steps">
          {STEPS.map(([t, d], i) => (
            <div className="step" key={t}>
              <div className="step-num">{i + 1}</div>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="install" className="section install">
        <h2>Get PRIVA on your desktop</h2>
        <p>
          Windows portable installer — the full app: commerce chat, notes, purchase graph, tasks.
          No setup. Point it at your own backend or the live demo backend.
        </p>
        <div className="hero-cta center">
          <a className="btn primary big" href={DOWNLOAD_URL}>⬇ Download PRIVA 1.0.0 (.exe)</a>
        </div>
        <p className="dim small">
          Built with Electron · React · TypeScript · FastAPI — see the source on{" "}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        </p>
      </section>

      <footer className="footer">
        <p>
          PRIVA — Personal Retail Intelligence via Agent.
          Built with <b>Prava (Visa Intelligent Commerce)</b>, <b>Linq</b>, and <b>SerpApi</b>.
        </p>
        <p className="dim small">149 backend tests · multi-user web demo · phone + OTP login</p>
      </footer>
    </main>
  );
}
