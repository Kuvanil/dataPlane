"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@dataplane.ai");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === "admin@dataplane.ai" && password === "admin123") {
      router.push("/dashboard");
    } else {
      setError("Invalid credentials. Use admin@dataplane.ai / admin123");
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
            className="w-full mt-2 py-2.5 text-sm font-semibold text-zinc-950 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-xl hover:opacity-90 transition-all shadow-md flex items-center justify-center"
          >
            Sign In
          </button>
        </form>

        <div className="mt-6 text-xs text-zinc-500">
          Don't have an account? <a href="#" className="text-blue-400 hover:underline">Request access</a>
        </div>
      </div>
    </div>
  );
}
