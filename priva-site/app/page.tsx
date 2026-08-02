import {
  ArrowRight,
  Bell,
  CreditCard,
  Globe,
  MessageSquare,
  Monitor,
  NotebookPen,
  Share2,
  Smartphone,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import LandingDemo from "../components/LandingDemo";
import Logo from "../components/Logo";
import { DOWNLOAD_URL, GITHUB_URL } from "../lib/constants";

const PLATFORMS = [
  { icon: Monitor, title: "Desktop", copy: "A focused workspace for notes, chat, tasks, and orders." },
  { icon: Globe, title: "Web", copy: "Your full PRIVA account, available from any modern browser." },
  { icon: Smartphone, title: "SMS", copy: "Real replies and purchase updates in the thread already on your phone." },
];

const FEATURES = [
  { icon: NotebookPen, title: "Notes become shopping", copy: "PRIVA reads buy intent in notes you already keep." },
  { icon: MessageSquare, title: "Chats on real SMS", copy: "Replies over Linq; same thread on phone, web, desktop." },
  { icon: Wallet, title: "Budget cap", copy: "Three-tier budget guard; borrow from next month only when you approve." },
  { icon: CreditCard, title: "One-tap pay via Prava", copy: "Visa Intelligent Commerce, secured through one considered handoff." },
  { icon: Bell, title: "Smart follow-ups", copy: "Reminders, price-drop alerts, delivery pings." },
  { icon: Share2, title: "Purchase graph", copy: "Your spending mapped in a live graph." },
];

const STEPS = ["Thought", "Note", "AI", "Products", "Checkout", "Delivered"];

export default function LandingPage() {
  return (
    <main className="landing">
      <div className="landing-nav-wrap">
        <nav className="landing-container landing-nav" aria-label="Main navigation">
          <Logo />
          <div className="landing-links">
            <a href="#features">Features</a>
            <a href="#demo">Demo</a>
            <a href={DOWNLOAD_URL}>Install</a>
            <Link className="btn btn-primary btn-sm" href="/login">Log in</Link>
          </div>
        </nav>
      </div>

      <header className="landing-container hero">
        <div className="hero-copy">
          <p className="hero-tag">PRIVA</p>
          <h1 className="hero-title">
            <span>Where Notes</span>
            <span>Become <span className="gold-text">Purchases.</span></span>
          </h1>
          <p className="hero-sub">Write naturally. Discover intelligently. Purchase confidently.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" href="/login">Try the live demo</Link>
            <a className="btn btn-ghost btn-lg" href={DOWNLOAD_URL}>Install PRIVA v1.1.1</a>
            <Link className="hero-open-link" href="/app">Open app <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
        </div>
        <div className="demo-shell" id="demo">
          <LandingDemo />
        </div>
      </header>

      <div className="trust-strip">
        <div className="landing-container trust-row" aria-label="Technology partners">
          {[
            "OpenAI",
            "Prava",
            "Linq",
            "SerpAPI",
            "SQLite",
            "Electron",
          ].map((partner, index) => (
            <span key={partner}>{partner}{index < 5 && <span className="trust-dot" aria-hidden="true">&middot;</span>}</span>
          ))}
        </div>
      </div>

      <section className="landing-container landing-section">
        <div className="landing-section-head">
          <div>
            <p className="section-eyebrow">Cross-platform</p>
            <h2>Your account, wherever the thought begins.</h2>
          </div>
        </div>
        <div className="platform-grid">
          {PLATFORMS.map(({ icon: Icon, title, copy }) => (
            <article className="platform-card" key={title}>
              <Icon size={23} strokeWidth={1.5} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
        <p className="platform-statement">One account. Everywhere. Your notes, chat and orders follow you.</p>
      </section>

      <section className="landing-section" id="features">
        <div className="landing-container">
          <div className="landing-section-head">
            <div>
              <p className="section-eyebrow">Features</p>
              <h2>A purchase assistant that starts by listening.</h2>
            </div>
            <p>PRIVA works inside the habits you already have, then adds judgment where commerce becomes noisy.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map(({ icon: Icon, title, copy }) => (
              <article className="feature-item" key={title}>
                <Icon className="feature-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-container landing-section">
        <div className="landing-section-head">
          <div>
            <p className="section-eyebrow">Why PRIVA</p>
            <h2>From passing thought to delivered order.</h2>
          </div>
          <p>No new vocabulary. No complicated workflow. Just a note, understood and carried through.</p>
        </div>
        <div className="why-timeline">
          {STEPS.map((step, index) => (
            <div className="why-step" key={step}>
              <span className="why-number">{String(index + 1).padStart(2, "0")}</span>
              <h3>{step}</h3>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-container landing-section">
        <div className="landing-section-head">
          <div>
            <p className="section-eyebrow">One continuous thread</p>
            <h2>Write here. Reply there. Lose nothing.</h2>
          </div>
          <p>The same note and conversation remain intact across the desktop workspace and your phone.</p>
        </div>
        <div className="mockup-stage" aria-label="PRIVA on laptop and phone">
          <div className="laptop">
            <div className="laptop-screen">
              <div className="mock-note">
                <div className="mock-note-side">
                  <span className="mock-side-label">Notes</span>
                  <span className="mock-side-note on">Summer list</span>
                  <span className="mock-side-note">Home office</span>
                  <span className="mock-side-note">Travel</span>
                </div>
                <div className="mock-note-main">
                  <h3>Summer list</h3>
                  <p>need white shoes under 5000</p>
                  <div className="mock-intents">
                    <span>Shoes</span><span>White</span><span>under $5000</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="laptop-base" />
          </div>
          <div className="phone-frame">
            <div className="phone-screen">
              <div className="phone-bubble">PRIVA found three white shoes within your budget. Do you prefer leather or canvas?</div>
              <div className="phone-bubble out">Leather, minimal branding.</div>
              <div className="phone-bubble">Understood. I ranked the cleanest options first.</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container footer-row">
          <span>&copy; 2026 PRIVA</span>
          <div className="footer-links">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://devfolio.co" target="_blank" rel="noreferrer">Devfolio</a>
            <a href="https://www.linkedin.com" target="_blank" rel="noreferrer">LinkedIn</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
