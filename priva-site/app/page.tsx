import DemoSection from "../components/DemoSection";
import { DOWNLOAD_URL, GITHUB_URL, WEB_APP_URL } from "../lib/constants";

const FEATURES = [
  {
    icon: "🧠",
    title: "Your notes become offers",
    desc: "Save it like you always do: “usb-c hub for travel, under 300.” PRIVA texts you a preference question, then ranked picks inside your budget.",
  },
  {
    icon: "💬",
    title: "SMS on your real phone",
    desc: "No app required. PRIVA texts you through Linq on the same thread your phone already uses — the conversation mirrors to the web and desktop apps.",
  },
  {
    icon: "🎯",
    title: "Budget is a hard line",
    desc: "Deep SerpApi search with budget-band matching, merchant trust, and a strict cap. Nothing over budget ships without your explicit consent.",
  },
  {
    icon: "💳",
    title: "Pay in one tap",
    desc: "Prava (Visa Intelligent Commerce) sandbox checkout sessions with budget-excess detection before you pay.",
  },
  {
    icon: "🛍️",
    title: "It follows up",
    desc: "Price-drop watch alerts, reminders from natural-language times (“remind me Friday”), and urgent-offer pacing when you say ASAP.",
  },
  {
    icon: "📊",
    title: "Your money, tracked",
    desc: "Monthly caps, borrow-into-next-month, and spend by merchant — in a live purchase graph.",
  },
];

const STEPS = [
  ["Type a note", "“need a usb-c hub for travel, under 300” — the kind of note you already keep."],
  ["PRIVA texts you", "A preference question lands on your phone via Linq SMS."],
  ["You answer", "“black, 8-in-1” — preferences are extracted and remembered."],
  ["Pick a winner", "Deep search returns budget-capped, quality-ranked options with a best pick."],
  ["Pay & track", "Prava sandbox checkout, budget accounting, shipping progress."],
];

export default function Page() {
  return (
    <main className="site">
      <nav className="nav">
        <a className="logo" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/priva.png" alt="PRIVA" />
          <span>PRIVA</span>
        </a>
        <div className="nav-links">
          <a href="#demo">Live demo</a>
          <a href="#how">How it works</a>
          <a href="#install">Install</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a className="nav-cta" href="/login">Log in →</a>
        </div>
      </nav>

      <header className="hero">
        <h1>
          Where Notes
          <br />
          becomes <span className="gold">Purchase</span>
        </h1>
        <p className="hero-sub">
          PRIVA reads the notes you already keep, finds the best options inside your budget,
          pays with <b>Prava</b>, and texts you the whole way on <b>Linq SMS</b>.
        </p>
        <div className="hero-cta">
          <a className="btn primary" href="#demo">Try the live demo</a>
          <a className="btn" href={DOWNLOAD_URL}>Download installer</a>
          <a className="btn ghost" href={WEB_APP_URL} target="_blank" rel="noreferrer">Open the app</a>
        </div>
      </header>

      <section id="demo" className="section">
        <h2>Live demo <span className="dim">— the notes part</span></h2>
        <DemoSection />
      </section>

      <section className="section">
        <h2>An <span className="gold">agent</span>, not a chatbot</h2>
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
          Windows installer — the full app: chat, notes, purchase graph, tasks.
          No setup, no account required.
        </p>
        <div className="hero-cta center">
          <a className="btn primary big" href={DOWNLOAD_URL}>⬇ Download PRIVA 1.0.0 (.exe)</a>
        </div>
        <p className="dim small">
          Electron · React · TypeScript · FastAPI — source on{" "}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        </p>
      </section>

      <footer className="footer">
        <p>
          PRIVA — Personal Retail Intelligence via Agent.
          Built with <b>Prava (Visa Intelligent Commerce)</b>, <b>Linq</b>, and <b>SerpApi</b>.
        </p>
        <p className="dim small">151 backend tests · multi-user web demo · phone + OTP login</p>
      </footer>
    </main>
  );
}
