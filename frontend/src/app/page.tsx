"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 font-sans text-zinc-50 overflow-hidden">
      {/* Navbar */}
      <header className="px-6 py-4 flex justify-between items-center border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
            dataPlane
          </h1>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
          <a href="#features" className="hover:text-zinc-200 transition-colors">Features</a>
          <a href="#solutions" className="hover:text-zinc-200 transition-colors">Solutions</a>
          <a href="#pricing" className="hover:text-zinc-200 transition-colors">Enterprise</a>
          <a href="https://nextjs.org/docs" className="hover:text-zinc-200 transition-colors">Docs</a>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">
            Log in
          </Link>
          <Link href="/login" className="px-4 py-2 text-sm font-semibold text-zinc-950 bg-white rounded-full hover:bg-zinc-200 transition-all shadow-md">
            Launch App
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative flex-1 flex flex-col items-center justify-center text-center px-6 pt-24 pb-16">
        {/* Glow effect */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-r from-blue-500/20 to-indigo-500/20 rounded-full blur-3xl -z-10" />
        
        <div className="max-w-4xl flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-blue-400 bg-blue-500/10 rounded-full border border-blue-500/20 mb-6">
            ✨ AI-First Agentic DBA Platform
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 text-zinc-100">
            Intelligent Data Engineering <br />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-500 bg-clip-text text-transparent">
              On Autopilot
            </span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-xl mb-8 leading-7">
            Intelligently map schemas, design visual transformations, and enable AI Autopilot data pipelines safely in regulated environments.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/login" className="px-6 py-3 text-base font-semibold text-zinc-950 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-xl hover:opacity-90 transition-all shadow-lg flex items-center justify-center">
              Get Started for Free
            </Link>
            <a href="#features" className="px-6 py-3 text-base font-semibold text-zinc-300 border border-zinc-800 rounded-xl hover:bg-zinc-900/50 hover:border-zinc-700 transition-all flex items-center justify-center">
              View Capabilities
            </a>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="p-12 md:p-24 bg-zinc-900/30 border-t border-zinc-900">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-zinc-100">Core Capabilities</h2>
            <p className="text-zinc-500 mt-2">Enterprise-grade tools for database modernization.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: "🧠", title: "Schema Intelligence", desc: "Compare source and target schemas with AI-assisted semantic matching." },
              { icon: "⚡", title: "Visual Pipeline Studio", desc: "Drag-and-drop low code transformation node canvas builder." },
              { icon: "🤖", title: "AI Autopilot", desc: "SLM mode proposed SQL setups simulations on private local inference." },
              { icon: "🛡️", title: "PII Anonymization", desc: "Automatic masking and tokenization enforcing information tags." },
              { icon: "🔌", title: "Universal Connectors", desc: "CloudWAREHOUSE cloud to on-prem JDBC NoSQL secure integration gateways." },
              { icon: "📊", title: "Audit Trail & Lineage", desc: "Versioned timeline tracker trace maps compliance audit ready logging dashboards." },
            ].map((feat, i) => (
              <div key={i} className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-sm flex flex-col gap-3 group hover:border-zinc-700 transition-all">
                <div className="text-3xl">{feat.icon}</div>
                <h3 className="font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors">{feat.title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="p-6 border-t border-zinc-900 text-center text-xs text-zinc-600">
        © 2026 dataPlane. All rights reserved. Built for secure enterprise operations.
      </footer>
    </div>
  );
}
