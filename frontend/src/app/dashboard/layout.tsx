"use client";

/**
 * Dashboard chrome — theme_redesign_tasks #4
 * --------------------------------------------------------------
 * Sidebar + sticky header for every /dashboard/* route.
 * All zinc-* classes swapped for semantic tokens from globals.css.
 * Status accents (blue / emerald) kept — they already carry
 * semantic meaning (info / success) and read in both themes.
 * ThemeToggle added to the header so admins can flip the theme
 * without leaving their work.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "@/lib/theme";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: "📊", href: "/dashboard" },
    { id: "connectors", label: "Connectors", icon: "🔌", href: "/dashboard/connectors" },
    { id: "visualize", label: "Visualize", icon: "🌐", href: "/dashboard/visualize" },
    { id: "topology", label: "Schema Topology", icon: "🕸️", href: "/dashboard/visualize/topology" },
    { id: "schema", label: "Schema Intel", icon: "🧠", href: "/dashboard/schema" },
    { id: "schema-mapper", label: "Schema Mapper", icon: "🗺️", href: "/dashboard/schema-mapper" },
    { id: "semantic", label: "Semantic / Metrics", icon: "📐", href: "/dashboard/semantic" },
    { id: "query-workspace", label: "Query Workspace", icon: "💬", href: "/dashboard/query-workspace" },
    { id: "pipelines", label: "Pipelines", icon: "🔗", href: "/dashboard/pipelines" },
    { id: "autopilot", label: "AI Autopilot", icon: "⚙️", href: "/dashboard/autopilot" },
    { id: "integrations", label: "Integrations", icon: "🧩", href: "/dashboard/integrations" },
    { id: "security", label: "Security", icon: "🛡️", href: "/dashboard/security" },
    { id: "audit", label: "Audit Trail", icon: "📋", href: "/dashboard/audit" },
  ];

  return (
    <div className="flex h-screen w-full bg-background font-sans text-fg overflow-hidden">
      {/* ─────────────────────────── Sidebar ─────────────────────────── */}
      <aside className="w-64 border-r border-border bg-surface-elevated flex flex-col">
        <div className="p-6 border-b border-border">
          <Link href="/dashboard" className="text-xl font-bold bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
            dataPlane
          </Link>
          <p className="text-xs text-fg-muted mt-1">AI-First Data Engineering</p>
        </div>
        <nav className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border " +
                  (isActive
                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                    : "text-fg-muted hover:bg-surface-overlay hover:text-fg border-transparent")
                }
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
                {item.id === "query-workspace" && (
                  <span className="ml-auto w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-fg-muted px-2 py-1">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span>Admin Session</span>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem("dp_token");
              router.push("/");
            }}
            className="w-full py-2 hover:bg-surface-overlay rounded-xl text-xs text-fg-muted font-medium border border-transparent hover:border-border-strong transition-all flex items-center justify-center gap-2"
          >
            🚪 Log Out
          </button>
        </div>
      </aside>

      {/* ─────────────────────────── Main column ─────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        <header className="p-4 border-b border-border flex justify-between items-center bg-surface-overlay backdrop-blur-md sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-semibold capitalize text-fg">
              {menuItems.find((m) => m.href === pathname)?.label || "Page"}
            </h2>
            <p className="text-xs text-fg-muted">Overview &amp; Management</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-2 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/30">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              5 DBs Connected
            </span>
            <ThemeToggle />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
