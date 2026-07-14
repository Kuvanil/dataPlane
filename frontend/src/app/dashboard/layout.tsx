"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

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
    { id: "security", label: "Security", icon: "🛡️", href: "/dashboard/security" },
    { id: "audit", label: "Audit Trail", icon: "📋", href: "/dashboard/audit" },
  ];

  return (
    <div className="flex h-screen w-full bg-zinc-950 font-sans text-zinc-50 overflow-hidden">
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900/50 flex flex-col">
        <div className="p-6 border-zinc-800 border-b">
          <Link href="/dashboard" className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">dataPlane</Link>
          <p className="text-xs text-zinc-400 mt-1">AI-First Data Engineering</p>
        </div>
        <nav className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.id} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent"}`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
                {item.id === "query-workspace" && <span className="ml-auto w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-zinc-800 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-zinc-400 px-2 py-1">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span>Admin Session</span>
          </div>
          <button onClick={() => { localStorage.removeItem("dp_token"); router.push("/"); }} className="w-full py-2 hover:bg-zinc-800 rounded-xl text-xs text-zinc-400 font-medium border border-transparent hover:border-zinc-700 transition-all flex items-center justify-center gap-2">🚪 Log Out</button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-y-auto">
        <header className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/20 backdrop-blur-md sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-semibold capitalize">{menuItems.find(m => m.href === pathname)?.label || "Page"}</h2>
            <p className="text-xs text-zinc-400">Overview & Management</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/20">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" /> 5 DBs Connected
            </span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
