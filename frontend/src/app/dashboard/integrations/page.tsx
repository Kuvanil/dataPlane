"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface ExternalAction {
  action_type: string;
  description: string;
  risk: string;
  auto_capable: boolean;
}

interface IntegrationStatus {
  configured: boolean;
  portal_url: string;
  external_actions: ExternalAction[];
}

interface LinkedAccount {
  id: string | number | null;
  app_name: string | null;
  linked_account_owner_id: string | null;
  enabled: boolean | null;
}

interface NotificationSetting {
  event_key: string;
  enabled: boolean;
  updated_by?: string | null;
}

// Known notify-out event keys (aci_integration_tasks #5/#7) — presented even
// before a row exists so admins can discover what's configurable. Disabled
// by default: no blanket "notify everything".
const KNOWN_EVENT_KEYS = [
  { key: "agentic_dba:schema_design_create", label: "Schema design plan ready for review" },
  { key: "pipeline:run_failure", label: "Pipeline run failed" },
  { key: "pipeline:run_success", label: "Pipeline run succeeded" },
  { key: "pipeline:drift_impact", label: "Pipeline blocked by schema drift" },
];

const RISK_COLORS: Record<string, string> = {
  low: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  high: "text-red-300 bg-red-500/10 border-red-500/30",
};

export default function IntegrationsPage() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, acc, ns] = await Promise.all([
        api.get<IntegrationStatus>("/api/v1/integrations/status"),
        api.get<{ accounts: LinkedAccount[]; error: string | null }>(
          "/api/v1/integrations/linked-accounts"),
        api.get<{ settings: NotificationSetting[] }>(
          "/api/v1/integrations/notification-settings"),
      ]);
      setStatus(st);
      setAccounts(acc.accounts);
      setAccountsError(acc.error);
      const map: Record<string, boolean> = {};
      for (const s of ns.settings) map[s.event_key] = s.enabled;
      setSettings(map);
    } catch {
      setAccountsError("Could not load integration data — is the API running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (eventKey: string) => {
    const next = !settings[eventKey];
    setToggleError(null);
    try {
      await api.put(`/api/v1/integrations/notification-settings/${encodeURIComponent(eventKey)}`,
        { enabled: next });
      setSettings((p) => ({ ...p, [eventKey]: next }));
    } catch {
      setToggleError("Could not update the setting (admin role required).");
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-fg">Integrations</h2>
          <p className="text-sm text-fg0 mt-1">
            External tools connected through ACI.dev — notify-out and governed external actions.
          </p>
        </div>
        {status && (
          <a
            href={status.portal_url}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-violet-500 to-blue-600 text-white rounded-xl hover:opacity-90"
            data-testid="connect-app-link"
          >
            Connect a new app ↗
          </a>
        )}
      </div>

      {!loading && status && !status.configured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          The ACI integration isn&apos;t configured (ACI_API_KEY is unset). External actions and
          notify-out are disabled; everything else in dataPlane works normally.
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface-elevated">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-fg-muted">Linked accounts</h3>
          <p className="text-xs text-fg0">
            OAuth connections are managed in ACI&apos;s own dev portal — dataPlane only reads them.
          </p>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-fg0">Loading…</div>
        ) : accountsError ? (
          <div className="p-4 text-sm text-fg-subtle">{accountsError}</div>
        ) : accounts.length === 0 ? (
          <div className="p-4 text-sm text-fg0">
            No linked accounts yet — use “Connect a new app” to link one in the ACI portal.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-fg0 border-b border-border">
                <th className="px-4 py-2">App</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className="px-4 py-2 font-mono text-fg-muted">{a.app_name ?? "—"}</td>
                  <td className="px-4 py-2 text-fg-subtle">{a.linked_account_owner_id ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={a.enabled
                      ? "text-emerald-400" : "text-fg0"}>
                      {a.enabled ? "enabled" : "disabled"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface-elevated">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-fg-muted">Governed external actions</h3>
          <p className="text-xs text-fg0">
            From the same allow-list Autopilot uses — external side effects default to approval-only.
          </p>
        </div>
        <div className="p-4 flex flex-col gap-2">
          {(status?.external_actions ?? []).map((a) => (
            <div key={a.action_type} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-fg-muted">{a.action_type}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${RISK_COLORS[a.risk] ?? ""}`}>
                {a.risk} risk
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                a.auto_capable
                  ? "text-blue-300 bg-blue-500/10 border-blue-500/30"
                  : "text-fg-subtle bg-surface-overlay border-border-strong/40"}`}>
                {a.auto_capable ? "auto-capable (fixed destination)" : "approval required"}
              </span>
              <span className="text-xs text-fg0 truncate">{a.description}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-elevated">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-fg-muted">Notify-out</h3>
          <p className="text-xs text-fg0">
            Per-event opt-in (off by default) — messages link back to dataPlane&apos;s own approval UI.
          </p>
        </div>
        <div className="p-4 flex flex-col gap-2">
          {toggleError && <div className="text-xs text-red-300">{toggleError}</div>}
          {KNOWN_EVENT_KEYS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={settings[key] ?? false}
                onChange={() => toggle(key)}
                className="accent-violet-500"
              />
              <span className="text-fg-muted">{label}</span>
              <span className="font-mono text-[10px] text-fg-subtle">{key}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
