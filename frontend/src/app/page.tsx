"use client";

/**
 * Landing page — theme_redesign_tasks #2
 * --------------------------------------------------------------
 * Sections (top → bottom):
 *   1. Navbar (logo + nav + ThemeToggle + auth CTAs)
 *   2. Hero (headline, value-prop, dual CTA, hero illustration)
 *   3. Logo cloud (social proof)
 *   4. Features grid (6 capabilities, 2-col on lg)
 *   5. How it works (3-step process)
 *   6. Solutions (3 cards with Unsplash thumbnails)
 *   7. CTA banner (gradient)
 *   8. Footer (4-column link groups)
 *
 * All zinc-* / text-zinc-* / border-zinc-* classes swapped for
 * semantic tokens defined in app/globals.css (#theme_foundation).
 * Status accents (blue/emerald/red/amber) kept as-is — they
 * carry semantic meaning and read correctly in both themes.
 */

import Link from "next/link";
import { ThemeToggle } from "@/lib/theme";

const FEATURES = [
  {
    icon: "🧠",
    title: "Schema Intelligence",
    desc: "Compare source and target schemas side-by-side with AI-assisted semantic matching that surfaces hidden type drift and naming inconsistencies.",
  },
  {
    icon: "⚡",
    title: "Visual Pipeline Studio",
    desc: "Drag-and-drop transformation nodes on a low-code canvas — preview outputs, validate against samples, and ship pipelines without writing boilerplate.",
  },
  {
    icon: "🤖",
    title: "AI Autopilot",
    desc: "Propose, simulate, and refine SQL transformations on private local inference — no data ever leaves your environment.",
  },
  {
    icon: "🛡️",
    title: "PII Anonymization",
    desc: "Automatic masking, tokenization, and column-level policies enforce information tags across every read path.",
  },
  {
    icon: "🔌",
    title: "Universal Connectors",
    desc: "Cloud warehouses, on-prem databases, JDBC endpoints, and NoSQL stores — one secure integration layer for every source.",
  },
  {
    icon: "📊",
    title: "Audit Trail & Lineage",
    desc: "Versioned timeline, dependency maps, and compliance-ready logs make every transformation traceable end-to-end.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Connect your sources",
    desc: "Plug in Postgres, Snowflake, MySQL, Oracle, MongoDB, or any JDBC endpoint. dataPlane probes each one and surfaces live health before you write a single transformation.",
  },
  {
    n: "02",
    title: "Map & model your data",
    desc: "Drag tables onto the visual canvas. AI suggests column matches, flags drift, and proposes type conversions you can accept, edit, or reject per column.",
  },
  {
    n: "03",
    title: "Run with confidence",
    desc: "Schedule, trigger, or stream. Every run is recorded, every output is diffed, every change is reversible — and PII never leaves your perimeter.",
  },
];

const SOLUTIONS = [
  {
    title: "Regulated Industries",
    blurb: "Banks, insurers, and healthcare teams run AI-assisted data pipelines without sending a single row to a public model.",
    image:
      "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=70",
    accent: "from-blue-500/20 to-indigo-500/20",
  },
  {
    title: "Data Modernization",
    blurb: "Move from legacy warehouses to modern lakehouse architectures with schema-aware migrations and full lineage.",
    image:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=70",
    accent: "from-emerald-500/20 to-teal-500/20",
  },
  {
    title: "Self-Service Analytics",
    blurb: "Empower analysts with a governed semantic layer — ask questions in plain English and trust the answers.",
    image:
      "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1200&q=70",
    accent: "from-violet-500/20 to-purple-500/20",
  },
];

// Inline SVG logo placeholders — zero asset weight, always render.
const LOGOS = [
  // Stylized geometric marks (no real brands)
  { name: "Aurora", svg: <svg viewBox="0 0 100 24" className="h-5 w-auto"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg> },
  { name: "Helix", svg: <svg viewBox="0 0 100 24" className="h-5 w-auto"><path d="M4 4 Q 12 12 20 4 T 36 4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M4 20 Q 12 12 20 20 T 36 20" fill="none" stroke="currentColor" strokeWidth="2" /></svg> },
  { name: "Nimbus", svg: <svg viewBox="0 0 100 24" className="h-5 w-auto"><path d="M4 18 L 16 6 L 24 14 L 36 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg> },
  { name: "Quanta", svg: <svg viewBox="0 0 100 24" className="h-5 w-auto"><rect x="4" y="4" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="14" y="14" width="6" height="6" fill="currentColor" /></svg> },
  { name: "Vertex", svg: <svg viewBox="0 0 100 24" className="h-5 w-auto"><path d="M4 20 L 20 4 L 36 20 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg> },
  { name: "Lumen", svg: <svg viewBox="0 0 100 24" className="h-5 w-auto"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><line x1="18" y1="18" x2="24" y2="24" stroke="currentColor" strokeWidth="2" /></svg> },
];

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: ["Features", "Solutions", "Integrations", "Changelog", "Roadmap"],
  },
  {
    title: "Solutions",
    links: ["Financial Services", "Healthcare", "Public Sector", "Retail", "Manufacturing"],
  },
  {
    title: "Resources",
    links: ["Documentation", "API Reference", "Tutorials", "Blog", "Status"],
  },
  {
    title: "Company",
    links: ["About", "Customers", "Security", "Careers", "Contact"],
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background font-sans text-fg">
      {/* ─────────────────────────── Navbar ─────────────────────────── */}
      <header className="px-6 py-4 flex justify-between items-center border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
            dataPlane
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-fg-muted">
          <a href="#features" className="hover:text-fg transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-fg transition-colors">How it works</a>
          <a href="#solutions" className="hover:text-fg transition-colors">Solutions</a>
          <a href="#" className="hover:text-fg transition-colors">Docs</a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden sm:inline text-sm font-medium text-fg-muted hover:text-fg transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-semibold text-accent-fg bg-accent rounded-full hover:opacity-90 transition-all shadow-md"
          >
            Launch App
          </Link>
        </div>
      </header>

      {/* ─────────────────────────── Hero ─────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-blue-500/15 to-indigo-500/15 rounded-full blur-3xl -z-10 pointer-events-none" />

        <div className="max-w-6xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28 grid md:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col items-start text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-blue-500 dark:text-blue-400 bg-blue-500/10 rounded-full border border-blue-500/20 mb-6">
              ✨ AI-First Agentic DBA Platform
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 text-fg">
              Intelligent Data Engineering <br />
              <span className="bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
                On Autopilot
              </span>
            </h1>
            <p className="text-lg text-fg-muted max-w-xl mb-8 leading-7">
              Map schemas visually, design transformations on a low-code canvas,
              and let AI propose the SQL — all while PII stays inside your perimeter.
              Built for regulated teams that can't send data to public models.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/login"
                className="px-6 py-3 text-base font-semibold text-accent-fg bg-accent rounded-xl hover:opacity-90 transition-all shadow-lg flex items-center justify-center"
              >
                Get Started for Free
              </Link>
              <a
                href="#features"
                className="px-6 py-3 text-base font-semibold text-fg border border-border rounded-xl hover:bg-surface-elevated hover:border-border-strong transition-all flex items-center justify-center"
              >
                View Capabilities
              </a>
            </div>
            <p className="mt-6 text-xs text-fg-subtle">
              No credit card required · Runs on your infrastructure · SOC 2 ready
            </p>
          </div>

          {/* Hero illustration — Unsplash dashboard photo */}
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 rounded-3xl blur-2xl -z-10" />
            <img
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=70"
              alt="Data analytics dashboard on a screen"
              loading="eager"
              className="rounded-2xl border border-border shadow-2xl w-full h-auto"
            />
            <div className="absolute -bottom-6 -left-6 hidden sm:flex items-center gap-3 p-3 rounded-xl bg-surface-elevated border border-border shadow-lg backdrop-blur-sm">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <div className="text-xs">
                <div className="font-semibold text-fg">Live sync</div>
                <div className="text-fg-subtle">3 sources · 14M rows / hr</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Logo cloud ─────────────────────────── */}
      <section className="border-y border-border bg-surface/40">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <p className="text-center text-xs uppercase tracking-widest text-fg-subtle mb-6">
            Trusted by data teams at regulated organizations
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-6 items-center text-fg-subtle">
            {LOGOS.map((l) => (
              <div key={l.name} className="flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity" title={l.name}>
                {l.svg}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Features grid ─────────────────────────── */}
      <section id="features" className="px-6 py-20 md:py-28">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-indigo-500 dark:text-indigo-400 bg-indigo-500/10 rounded-full border border-indigo-500/20 mb-4">
              Capabilities
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-fg">
              Enterprise-grade tools for data modernization
            </h2>
            <p className="text-fg-muted mt-3 max-w-2xl mx-auto">
              Every feature is designed for teams that need governance, audit trails,
              and the ability to keep sensitive data on private infrastructure.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group p-6 rounded-2xl bg-surface-elevated border border-border flex flex-col gap-3 hover:border-border-strong hover:-translate-y-0.5 transition-all"
              >
                <div className="text-3xl">{f.icon}</div>
                <h3 className="font-semibold text-fg group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
                  {f.title}
                </h3>
                <p className="text-sm text-fg-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── How it works ─────────────────────────── */}
      <section id="how-it-works" className="px-6 py-20 md:py-28 bg-surface/40 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-full border border-emerald-500/20 mb-4">
              How it works
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-fg">
              Three steps from raw source to trustworthy output
            </h2>
            <p className="text-fg-muted mt-3 max-w-2xl mx-auto">
              Connect, model, and run — with guardrails at every stage so nothing
              ships without a human review.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="relative p-6 rounded-2xl bg-surface-elevated border border-border flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 text-white flex items-center justify-center text-sm font-bold">
                    {s.n}
                  </div>
                  <h3 className="font-semibold text-fg">{s.title}</h3>
                </div>
                <p className="text-sm text-fg-muted leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Solutions ─────────────────────────── */}
      <section id="solutions" className="px-6 py-20 md:py-28">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-violet-500 dark:text-violet-400 bg-violet-500/10 rounded-full border border-violet-500/20 mb-4">
              Solutions
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-fg">
              Built for the way regulated teams actually work
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {SOLUTIONS.map((s) => (
              <article
                key={s.title}
                className="group overflow-hidden rounded-2xl bg-surface-elevated border border-border hover:border-border-strong transition-all"
              >
                <div className={`relative h-44 overflow-hidden bg-gradient-to-br ${s.accent}`}>
                  <img
                    src={s.image}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-80 group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-6 flex flex-col gap-2">
                  <h3 className="font-semibold text-fg">{s.title}</h3>
                  <p className="text-sm text-fg-muted leading-relaxed">{s.blurb}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── CTA banner ─────────────────────────── */}
      <section className="px-6 py-20 md:py-28">
        <div className="max-w-5xl mx-auto rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 p-10 md:p-16 text-center relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-violet-400/20 rounded-full blur-3xl pointer-events-none" />
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 relative">
            Ship trustworthy data pipelines this week
          </h2>
          <p className="text-blue-100 max-w-2xl mx-auto mb-8 relative">
            Spin up a workspace, connect your first source, and watch dataPlane
            surface the schema drift your team has been debugging for months.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center relative">
            <Link
              href="/login"
              className="px-6 py-3 text-base font-semibold text-blue-700 bg-white rounded-xl hover:bg-blue-50 transition-all shadow-lg"
            >
              Start free
            </Link>
            <a
              href="#"
              className="px-6 py-3 text-base font-semibold text-white border border-white/30 rounded-xl hover:bg-white/10 transition-all"
            >
              Talk to sales
            </a>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Footer ─────────────────────────── */}
      <footer className="border-t border-border bg-surface/40">
        <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-1 flex flex-col gap-3">
            <span className="text-xl font-bold bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
              dataPlane
            </span>
            <p className="text-xs text-fg-subtle leading-relaxed">
              AI-first data engineering for regulated teams.
              Built for secure enterprise operations.
            </p>
          </div>
          {FOOTER_GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-2">
              <h4 className="text-xs uppercase tracking-widest text-fg-subtle font-semibold">
                {g.title}
              </h4>
              {g.links.map((link) => (
                <a
                  key={link}
                  href="#"
                  className="text-sm text-fg-muted hover:text-fg transition-colors"
                >
                  {link}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-border">
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-fg-subtle">
            <span>© 2026 dataPlane. All rights reserved.</span>
            <div className="flex items-center gap-4">
              <a href="#" className="hover:text-fg transition-colors">Privacy</a>
              <a href="#" className="hover:text-fg transition-colors">Terms</a>
              <a href="#" className="hover:text-fg transition-colors">Security</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
