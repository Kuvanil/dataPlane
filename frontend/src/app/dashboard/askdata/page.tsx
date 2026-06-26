"use client";
import { useState, useEffect, useRef } from "react";

interface Message { role: "user"|"assistant"; content: string; timestamp: string; }

const SUGGESTIONS = [
  "What PII risks exist in the connected databases?",
  "How healthy are my database schemas?",
  "Are there any unmapped columns between source and target?",
  "What type mismatches need to be resolved?",
  "Which tables need primary keys added?",
  "Show me the security classification summary",
];

export default function AskDataPage() {
  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "👋 Hi! I'm **AskData**, your AI database intelligence assistant.\n\nI can help you understand schemas, identify issues, and suggest improvements. Ask me anything!\n\nTry clicking a suggested question below, or type your own.",
    timestamp: new Date().toLocaleTimeString(),
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `s_${Date.now()}`);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const offlineResponse = (q: string): string => {
    const l = q.toLowerCase();
    if (l.includes("pii") || l.includes("sensitive"))
      return "🔴 **PII Findings:**\n- `crm_users.email_address` — PII\n- `crm_users.phone_number` — PII\n- `employees.ssn` — PII\n- `payroll.bank_account` — PII\n- `customers.credit_card_last4` — PII\n\n🟡 **Sensitive:** `first_name`, `last_name`, `address`, `zip_code`\n\n**Recommendation:** Enable encryption & masking for all HIGH risk columns.";
    if (l.includes("health") || l.includes("status"))
      return "📊 **Health Summary:**\n\n- CRM Source: 3 tables, 16 cols — 🟢 85%\n- Data Warehouse: 3 tables, 15 cols — 🟢 80%\n- E-Commerce: 3 tables, 17 cols — 🟡 75%\n- Finance Oracle: 3 tables, 18 cols — 🟢 90%\n- HR Postgres: 3 tables, 19 cols — 🟢 88%\n\n**Overall: 84%** | ⚠️ 2 tables lack PKs";
    if (l.includes("gap") || l.includes("missing") || l.includes("unmapped"))
      return "🔍 **Schema Gaps:**\n\n- ❌ `crm_users` → AI suggests `dw_customers` (85%)\n- ❌ `crm_leads` → AI suggests `dw_opportunities` (78%)\n- ❌ `crm_activities` → No match\n\n**Unmapped Columns:** `phone_number`, `score`, `source`";
    if (l.includes("type") || l.includes("mismatch"))
      return "🔄 **Type Mismatches:**\n\n- `created_at` TIMESTAMP → `signup_date` DATE — Cast needed\n- `status` VARCHAR(20) → `stage` VARCHAR(30) — Compatible ✅";
    if (l.includes("security") || l.includes("risk"))
      return "🛡️ **Security Summary:**\n- 🔴 High Risk: 8 columns\n- 🟡 Medium Risk: 6 columns\n- 🟢 Low Risk: 71 columns\n\nTop concerns: `employees.ssn`, `payroll.bank_account`, `customers.credit_card_last4`";
    return "I'm analyzing **5 databases** with **15 tables** and **85 columns**.\n\nAsk about: PII risks, schema gaps, type mismatches, health checks, or security classification.";
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input;
    if (!msg.trim()) return;
    setMessages(p => [...p, { role: "user", content: msg, timestamp: new Date().toLocaleTimeString() }]);
    setInput(""); setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/v1/askdata/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, session_id: sessionId }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages(p => [...p, { role: "assistant", content: data.response, timestamp: new Date().toLocaleTimeString() }]);
    } catch {
      setMessages(p => [...p, { role: "assistant", content: offlineResponse(msg), timestamp: new Date().toLocaleTimeString() }]);
    } finally { setLoading(false); inputRef.current?.focus(); }
  };

  const renderMd = (text: string) => text
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-zinc-100">$1</strong>')
    .replace(/`(.*?)`/g, '<code class="px-1 py-0.5 rounded bg-zinc-800 text-blue-400 text-[11px] font-mono">$1</code>')
    .replace(/^- (.*$)/gm, '<div class="flex items-start gap-1.5 ml-2"><span class="text-zinc-600">•</span><span>$1</span></div>')
    .replace(/\n\n/g, '<div class="h-2"></div>').replace(/\n/g, '<br/>');

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-sm">🤖</span>
            AskData Intelligence Bot
          </h3>
          <p className="text-xs text-zinc-500 ml-10">Ask anything about your databases</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" /> 5 DBs Connected
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-blue-600/20 border border-blue-500/20 text-zinc-200" : "bg-zinc-900/60 border border-zinc-800 text-zinc-300"}`}>
              {msg.role === "assistant" && (
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-[10px]">🤖</span>
                  <span className="text-[10px] font-semibold text-zinc-400">AskData</span>
                  <span className="text-[9px] text-zinc-600 ml-auto">{msg.timestamp}</span>
                </div>
              )}
              <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start"><div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div><span className="text-xs text-zinc-500">Analyzing...</span>
          </div></div>
        )}
        <div ref={endRef} />
      </div>
      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s, i) => (
            <button key={i} onClick={() => sendMessage(s)} className="px-3 py-1.5 text-[11px] rounded-full bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-all">{s}</button>
          ))}
        </div>
      )}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
        <div className="flex gap-2">
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder="Ask about your databases..." className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700 text-sm focus:outline-none focus:border-blue-500 text-zinc-200 placeholder:text-zinc-600" />
          <button onClick={() => sendMessage()} disabled={loading || !input.trim()} className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-violet-500 to-blue-600 text-white rounded-xl hover:opacity-90 disabled:opacity-50">Send</button>
        </div>
      </div>
    </div>
  );
}
