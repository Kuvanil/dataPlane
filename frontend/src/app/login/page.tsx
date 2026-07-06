"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 font-sans text-zinc-50 px-4 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-3xl -z-10" />
      
      <div className="w-full max-w-md p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-md flex flex-col items-center">
        <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent mb-2">
          dataPlane
        </Link>
        <p className="text-xs text-zinc-500 mb-8">Welcome back. Enter your credentials to continue.</p>

        {sessionExpiredPending !== null && (
          <div className="w-full p-3 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
            ⚠️ Your session expired with {sessionExpiredPending} unsaved change
            {sessionExpiredPending === 1 ? "" : "s"}. Log back in and re-apply it.
          </div>
        )}

        {error && (
          <div className="w-full p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs flex items-center gap-2">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-800 text-sm focus:outline-none focus:border-blue-500 transition-all text-zinc-200"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium text-zinc-400">Password</label>
              <a href="#" className="text-xs text-blue-400 hover:underline">Forgot?</a>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-800 text-sm focus:outline-none focus:border-blue-500 transition-all text-zinc-200"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 text-sm font-semibold text-zinc-950 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-xl hover:opacity-90 transition-all shadow-md flex items-center justify-center disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="mt-6 text-xs text-zinc-500">
          Don't have an account? <a href="#" className="text-blue-400 hover:underline">Request access</a>
        </div>
      </div>
    </div>
  );
}
