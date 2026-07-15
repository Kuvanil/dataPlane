"use client";

/**
 * Login page — theme_redesign_tasks #3
 * --------------------------------------------------------------
 * Two-column layout at md+ (left: copy + Unsplash illustration;
 * right: form card). Single column on mobile. All zinc-* classes
 * swapped for semantic tokens defined in app/globals.css
 * (#theme_foundation). The mapper_tasks #5 flag-bearer comment
 * below MUST stay intact — it explains how the session-expired
 * banner is hydrated across a redirect.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/lib/theme";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@dataplane.ai");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionExpiredPending, setSessionExpiredPending] = useState<number | null>(null);
  const router = useRouter();

  // mapper_tasks #5 completeness fix: this flag is set by useMapping's 401
  // handler when the session expired with unsaved edits queued. The toast
  // shown at that moment can be lost if the page unloads before it paints;
  // this banner is the durable signal that survives the redirect. Read
  // once on mount and clear immediately so it doesn't reappear on a later
  // visit to /login.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("dp_session_expired_with_pending");
      if (raw) {
        const count = Number(raw);
        if (Number.isFinite(count) && count > 0) setSessionExpiredPending(count);
        localStorage.removeItem("dp_session_expired_with_pending");
      }
    } catch {
      // localStorage may be unavailable (private mode etc.) — no banner.
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? "Login failed");
        return;
      }
      const data = await res.json();
      localStorage.setItem("dp_token", data.access_token);
      router.push("/dashboard");
    } catch {
      setError("Unable to connect to server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background font-sans text-fg">
      {/* ─────────────────────────── Left column (md+) ─────────────────────────── */}
      <aside className="hidden md:flex md:w-1/2 relative overflow-hidden flex-col justify-between p-10 bg-gradient-to-br from-blue-600 via-indigo-700 to-violet-800 text-white">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-violet-400/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <Link href="/" className="text-2xl font-bold text-white">
            dataPlane
          </Link>
        </div>

        <div className="relative flex flex-col gap-6 max-w-md">
          <h2 className="text-3xl font-bold leading-tight">
            Intelligent data engineering, on autopilot.
          </h2>
          <p className="text-blue-100 leading-relaxed">
            Sign in to manage connectors, design visual pipelines, and let AI
            propose SQL transformations — all while PII stays inside your perimeter.
          </p>

          <div className="relative mt-2">
            <img
              src="https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1000&q=70"
              alt=""
              loading="lazy"
              className="rounded-2xl border border-white/20 shadow-2xl w-full h-auto"
            />
          </div>

          <div className="flex items-center gap-4 text-xs text-blue-100 mt-2">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> SOC 2 ready
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> Private inference
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> Audit trail
            </span>
          </div>
        </div>

        <p className="relative text-xs text-blue-200/70">
          © 2026 dataPlane. All rights reserved.
        </p>
      </aside>

      {/* ─────────────────────────── Right column (form) ─────────────────────────── */}
      <main className="flex-1 flex flex-col">
        {/* Top bar with back link + theme toggle */}
        <div className="flex items-center justify-between p-6">
          <Link
            href="/"
            className="text-xs text-fg-muted hover:text-fg transition-colors flex items-center gap-1"
          >
            ← Back to home
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex-1 flex items-center justify-center px-6 pb-12 relative">
          {/* Soft background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-accent-soft rounded-full blur-3xl -z-10 pointer-events-none" />

          <div className="w-full max-w-sm flex flex-col items-stretch">
            {/* Mobile-only brand mark */}
            <div className="md:hidden text-center mb-6">
              <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
                dataPlane
              </Link>
            </div>

            <div className="flex flex-col gap-1.5 mb-6">
              <h1 className="text-2xl font-bold text-fg">Welcome back</h1>
              <p className="text-sm text-fg-muted">
                Enter your credentials to continue.
              </p>
            </div>

            {sessionExpiredPending !== null && (
              <div className="w-full p-3 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2">
                <span className="text-base leading-none">⚠️</span>
                <span>
                  Your session expired with {sessionExpiredPending} unsaved change
                  {sessionExpiredPending === 1 ? "" : "s"}. Log back in and re-apply it.
                </span>
              </div>
            )}

            {error && (
              <div className="w-full p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-xs flex items-start gap-2">
                <span className="text-base leading-none">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="w-full flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-fg-muted">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="px-4 py-2.5 rounded-xl bg-surface-elevated border border-border text-sm focus:outline-none focus:border-accent transition-colors text-fg placeholder:text-fg-subtle"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-fg-muted">Password</label>
                  <a href="#" className="text-xs text-accent hover:underline">
                    Forgot?
                  </a>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="px-4 py-2.5 rounded-xl bg-surface-elevated border border-border text-sm focus:outline-none focus:border-accent transition-colors text-fg placeholder:text-fg-subtle"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 text-sm font-semibold text-accent-fg bg-accent rounded-xl hover:opacity-90 transition-all shadow-md flex items-center justify-center disabled:opacity-60"
              >
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <div className="mt-6 text-xs text-fg-muted text-center">
              Don&apos;t have an account?{" "}
              <a href="#" className="text-accent hover:underline">
                Request access
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
