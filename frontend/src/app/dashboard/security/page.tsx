"use client";

import { useState, useEffect } from "react";

interface Item {
  column: string;
  classification: {
    label: string;
    level: string;
    policy: string;
    color: string;
    dama_metadata: {
      data_owner: string;
      data_steward: string;
      retention: string;
    };
  };
}

export default function SecurityPage() {
  const [classifications, setClassifications] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const fetchClassify = async () => {
    try {
      // Connect to the seeded ID 1 (CRM_Source_Analytics)
      const res = await fetch("http://localhost:8000/api/v1/schema/1/classify");
      if (res.ok) {
        const data = await res.json();
        setClassifications(data.classifications || {});
      }
    } catch (err) {
      console.error("Failed to fetch classification:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClassify();
  }, []);

  const colorMap: any = {
    red: "bg-red-500/10 text-red-500 border-red-500/20",
    amber: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    green: "bg-green-500/10 text-green-500 border-green-500/20",
  };

  return (
    <div className="p-8 flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 backdrop-blur-sm">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">Data Governance & PII Protection</h3>
          <p className="text-xs text-zinc-500">Classified assets mapped directly conforming with DAMA Metadata dimensions stewardship policies.</p>
        </div>
        <button className="px-4 py-2 text-sm font-semibold text-zinc-950 bg-white rounded-xl hover:bg-zinc-200 transition-all flex items-center gap-2">
          🛡️ Run Audit Scan
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-zinc-500 text-sm">Scanning classifications...</div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.keys(classifications).map((tableName) => (
            <div key={tableName} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden backdrop-blur-sm">
              <div className="p-4 bg-zinc-900/50 border-b border-zinc-800 flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-500">Table:</span>
                <span className="text-sm font-bold text-zinc-300 font-mono">{tableName}</span>
              </div>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/40">
                    <th className="p-3 font-semibold text-zinc-400">Column</th>
                    <th className="p-3 font-semibold text-zinc-400">Classification</th>
                    <th className="p-3 font-semibold text-zinc-400">Steward</th>
                    <th className="p-3 font-semibold text-zinc-400">Owner</th>
                    <th className="p-3 font-semibold text-zinc-400">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {classifications[tableName].map((c: Item, i: number) => {
                    const meta = c.classification.dama_metadata;
                    return (
                      <tr key={i} className="border-b border-zinc-800/60 hover:bg-zinc-800/10 transition-colors">
                        <td className="p-3 font-mono text-xs text-zinc-200">{c.column}</td>
                        <td className="p-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorMap[c.classification.color]}`}>
                            {c.classification.label}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-zinc-400">{meta?.data_steward || "-"}</td>
                        <td className="p-3 text-xs text-zinc-500">{meta?.data_owner || "-"}</td>
                        <td className="p-3 text-xs text-zinc-400 italic font-mono">{meta?.retention || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
