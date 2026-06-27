"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface MappingRule {
  source_column?: string; source_table?: string; target_column?: string; target_table?: string;
  transform?: string; confidence?: number; action?: string; column?: string; type?: string;
}
interface ColumnNode { id: string; table: string; column: string; type: string; primary_key: boolean; y: number; }

export default function SchemaMapperPage() {
  const [sourceNodes, setSourceNodes] = useState<ColumnNode[]>([]);
  const [targetNodes, setTargetNodes] = useState<ColumnNode[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [englishInput, setEnglishInput] = useState("");
  const [generatedSQL, setGeneratedSQL] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [parseLoading, setParseLoading] = useState(false);
  const [sourceName, setSourceName] = useState("Source");
  const [targetName, setTargetName] = useState("Target");
  const [activeTab, setActiveTab] = useState<"visual"|"english"|"sql">("visual");

  useEffect(() => { fetchVisualData(); }, []);

  const fetchVisualData = async () => {
    try {
      setLoading(true);
      const res = await fetch("${api.base}/api/v1/mapper/visual-data", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: 1, target_id: 2 }),
      });
      if (res.ok) {
        const d = await res.json();
        setSourceNodes(d.source_nodes || []); setTargetNodes(d.target_nodes || []);
        setEdges(d.edges || []); setSourceName(d.source_name || "Source"); setTargetName(d.target_name || "Target");
      } else throw new Error();
    } catch {
      // Fallback demo data
      setSourceNodes([
        { id: "s1", table: "crm_users", column: "id", type: "INTEGER", primary_key: true, y: 0 },
        { id: "s2", table: "crm_users", column: "first_name", type: "TEXT", primary_key: false, y: 40 },
        { id: "s3", table: "crm_users", column: "email_address", type: "TEXT", primary_key: false, y: 80 },
        { id: "s4", table: "crm_users", column: "phone_number", type: "TEXT", primary_key: false, y: 120 },
        { id: "s5", table: "crm_users", column: "created_at", type: "TIMESTAMP", primary_key: false, y: 160 },
      ]);
      setTargetNodes([
        { id: "t1", table: "dw_customers", column: "customer_id", type: "INTEGER", primary_key: true, y: 0 },
        { id: "t2", table: "dw_customers", column: "given_name", type: "TEXT", primary_key: false, y: 40 },
        { id: "t3", table: "dw_customers", column: "contact_email", type: "TEXT", primary_key: false, y: 80 },
        { id: "t4", table: "dw_customers", column: "contact_phone", type: "TEXT", primary_key: false, y: 120 },
        { id: "t5", table: "dw_customers", column: "signup_date", type: "DATE", primary_key: false, y: 160 },
      ]);
      setEdges([
        { source: "s3", target: "t3", confidence: 85, ai_suggested: true },
      ]);
      setSourceName("CRM_Source_Analytics"); setTargetName("Data_Warehouse_Target");
    } finally { setLoading(false); }
  };

  const parseEnglish = async () => {
    if (!englishInput.trim()) return;
    setParseLoading(true);
    try {
      const res = await fetch("${api.base}/api/v1/mapper/parse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: englishInput, source_id: 1, target_id: 2 }),
      });
      if (res.ok) { const d = await res.json(); setRules(d.rules || []); }
      else throw new Error();
    } catch {
      // Offline parse
      const lines = englishInput.toLowerCase().split("\n").filter(l => l.trim());
      const parsed: MappingRule[] = [];
      for (const line of lines) {
        const m = line.match(/map\s+(\w+)\s+(?:to|->|→)\s+(\w+)/);
        if (m) parsed.push({ source_column: m[1], source_table: "crm_users", target_column: m[2], target_table: "dw_customers", transform: "direct", confidence: 90 });
        const a = line.match(/add\s+(?:column\s+)?(\w+)\s+(?:as|type)\s+(\w+)/);
        if (a) parsed.push({ action: "add_column", column: a[1], type: a[2].toUpperCase(), transform: "add", confidence: 90 });
      }
      setRules(parsed.length ? parsed : [{ source_column: "?", target_column: "?", transform: "Could not parse", confidence: 0 }]);
    } finally { setParseLoading(false); }
  };

  const generateSQL = async () => {
    const allRules = [...rules, ...edges.filter(e => !e.ai_suggested).map(e => {
      const sn = sourceNodes.find(n => n.id === e.source);
      const tn = targetNodes.find(n => n.id === e.target);
      return { source_column: sn?.column, source_table: sn?.table, target_column: tn?.column, target_table: tn?.table, transform: "direct" };
    })];
    try {
      const res = await fetch("${api.base}/api/v1/mapper/generate-sql", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: allRules, target_db_type: "sqlite" }),
      });
      if (res.ok) { setGeneratedSQL(await res.json()); setActiveTab("sql"); }
      else throw new Error();
    } catch {
      setGeneratedSQL({ ddl: [], dml: allRules.map(r => `-- Map ${r.source_table}.${r.source_column} → ${r.target_table}.${r.target_column}`), warnings: [], total_statements: allRules.length });
      setActiveTab("sql");
    }
  };

  const addManualEdge = (sourceId: string, targetId: string) => {
    if (!edges.find(e => e.source === sourceId && e.target === targetId)) {
      setEdges(p => [...p, { source: sourceId, target: targetId, confidence: 100, ai_suggested: false }]);
    }
  };

  const [dragSource, setDragSource] = useState<string|null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-sm flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Schema Mapper</h3>
          <p className="text-xs text-zinc-500">Visual drag-and-drop or plain English schema mapping</p>
        </div>
        <div className="flex items-center gap-2">
          {(["visual","english","sql"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === t ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
              {t === "visual" ? "🗺️ Visual" : t === "english" ? "✍️ English" : "📝 SQL Preview"}
            </button>
          ))}
          <button onClick={generateSQL} className="px-4 py-1.5 text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg hover:opacity-90 ml-2">⚡ Generate SQL</button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Visual Mode */}
          {activeTab === "visual" && (
            <div className="p-6 flex gap-8 justify-center">
              {/* Source Panel */}
              <div className="w-80">
                <div className="text-xs font-semibold text-blue-400 mb-3 flex items-center gap-2">📤 {sourceName}</div>
                <div className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                  {sourceNodes.map(n => (
                    <div key={n.id}
                      draggable onDragStart={() => setDragSource(n.id)}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-grab hover:bg-zinc-800/40 transition-all border ${edges.find(e => e.source === n.id) ? "border-emerald-500/30 bg-emerald-500/5" : "border-transparent"}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {n.primary_key && <span className="text-amber-400 text-[9px]">🔑</span>}
                        <span className="font-mono text-zinc-200">{n.column}</span>
                      </span>
                      <span className="text-zinc-600 font-mono">{n.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mapping Lines */}
              <div className="w-32 flex flex-col items-center justify-center gap-2 relative">
                <div className="text-[10px] text-zinc-500 font-semibold">MAPPINGS</div>
                <svg className="w-full" style={{ height: Math.max(sourceNodes.length, targetNodes.length) * 44 + 20 }}>
                  {edges.map((e, i) => {
                    const si = sourceNodes.findIndex(n => n.id === e.source);
                    const ti = targetNodes.findIndex(n => n.id === e.target);
                    if (si < 0 || ti < 0) return null;
                    const sy = si * 44 + 22; const ty = ti * 44 + 22;
                    return (
                      <g key={i}>
                        <line x1="0" y1={sy} x2="128" y2={ty} stroke={e.ai_suggested ? "#8b5cf6" : "#22c55e"} strokeWidth="2" strokeDasharray={e.ai_suggested ? "5,3" : "0"} opacity="0.7" />
                        <text x="64" y={(sy+ty)/2 - 4} textAnchor="middle" fill="#a1a1aa" fontSize="9">{e.confidence}%</text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Target Panel */}
              <div className="w-80">
                <div className="text-xs font-semibold text-indigo-400 mb-3 flex items-center gap-2">📥 {targetName}</div>
                <div className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                  {targetNodes.map(n => (
                    <div key={n.id}
                      onDragOver={ev => ev.preventDefault()}
                      onDrop={() => { if (dragSource) { addManualEdge(dragSource, n.id); setDragSource(null); } }}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs transition-all border ${edges.find(e => e.target === n.id) ? "border-emerald-500/30 bg-emerald-500/5" : "border-transparent hover:border-indigo-500/30"}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {n.primary_key && <span className="text-amber-400 text-[9px]">🔑</span>}
                        <span className="font-mono text-zinc-200">{n.column}</span>
                      </span>
                      <span className="text-zinc-600 font-mono">{n.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* English Mode */}
          {activeTab === "english" && (
            <div className="p-6 max-w-3xl mx-auto flex flex-col gap-4">
              <div className="rounded-xl bg-zinc-900/40 border border-zinc-800 p-5">
                <label className="text-xs font-semibold text-zinc-400 mb-2 block">Describe your mappings in plain English:</label>
                <textarea value={englishInput} onChange={e => setEnglishInput(e.target.value)} rows={6} placeholder={"Map email_address to contact_email\nMap first_name to given_name\nMap created_at to signup_date\nAdd column loyalty_tier as VARCHAR(20)"} className="w-full px-4 py-3 rounded-lg bg-zinc-800/50 border border-zinc-700 text-sm font-mono focus:outline-none focus:border-blue-500 text-zinc-200 placeholder:text-zinc-600 resize-none" />
                <button onClick={parseEnglish} disabled={parseLoading} className="mt-3 px-5 py-2 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                  {parseLoading ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Parsing...</> : "🧠 Parse Instructions"}
                </button>
              </div>
              {rules.length > 0 && (
                <div className="rounded-xl bg-zinc-900/40 border border-zinc-800 overflow-hidden">
                  <div className="p-3 border-b border-zinc-800 text-sm font-semibold text-zinc-200">Parsed Rules ({rules.length})</div>
                  <div className="divide-y divide-zinc-800/50">
                    {rules.map((r, i) => (
                      <div key={i} className="p-3 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          {r.action === "add_column" ? (
                            <><span className="text-emerald-400">➕ ADD</span><span className="font-mono text-zinc-200">{r.column} {r.type}</span></>
                          ) : (
                            <><span className="font-mono text-blue-400">{r.source_table}.{r.source_column}</span><span className="text-zinc-500">→</span><span className="font-mono text-indigo-400">{r.target_table}.{r.target_column}</span></>
                          )}
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${(r.confidence||0) >= 85 ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-400"}`}>{r.confidence}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SQL Preview Mode */}
          {activeTab === "sql" && generatedSQL && (
            <div className="p-6 max-w-3xl mx-auto flex flex-col gap-4">
              {generatedSQL.warnings?.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-400 text-xs">
                  {generatedSQL.warnings.map((w: string, i: number) => <div key={i}>⚠️ {w}</div>)}
                </div>
              )}
              {generatedSQL.ddl?.length > 0 && (
                <div className="rounded-xl bg-zinc-900/40 border border-zinc-800 overflow-hidden">
                  <div className="p-3 border-b border-zinc-800 text-sm font-semibold text-zinc-200">DDL Statements</div>
                  <pre className="p-4 text-xs font-mono text-emerald-400 whitespace-pre-wrap">{generatedSQL.ddl.join("\n\n")}</pre>
                </div>
              )}
              {generatedSQL.dml?.length > 0 && (
                <div className="rounded-xl bg-zinc-900/40 border border-zinc-800 overflow-hidden">
                  <div className="p-3 border-b border-zinc-800 text-sm font-semibold text-zinc-200">DML Statements</div>
                  <pre className="p-4 text-xs font-mono text-blue-400 whitespace-pre-wrap">{generatedSQL.dml.join("\n\n")}</pre>
                </div>
              )}
              <button className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl hover:opacity-90 self-end flex items-center gap-2">▶️ Apply Migrations</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
