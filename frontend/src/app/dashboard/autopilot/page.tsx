"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import ActionLog from "./components/ActionLog";
import ApprovalQueue from "./components/ApprovalQueue";
import PolicyPanel from "./components/PolicyPanel";
import RunConsole from "./components/RunConsole";
import type {
  ActionLogEntry,
  AutopilotPolicyEntry,
  Paginated,
  Recommendation,
  Role,
} from "./lib/types";

type Tab = "console" | "approvals" | "policy" | "actions";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "console", label: "Run console" },
  { key: "approvals", label: "Approvals" },
  { key: "policy", label: "Policy" },
  { key: "actions", label: "Action log" },
];

export default function AutopilotPage() {
  const [tab, setTab] = useState<Tab>("console");
  const [role, setRole] = useState<Role | null>(null);
  const [policies, setPolicies] = useState<AutopilotPolicyEntry[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [actions, setActions] = useState<ActionLogEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [banner, setBanner] = useState<{ kind: "info" | "error" | "success"; text: string } | null>(null);

  const showBanner = useCallback((kind: "info" | "error" | "success", text: string) => {
    setBanner({ kind, text });
    setTimeout(() => setBanner(null), 6000);
  }, []);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      showBanner("error", err instanceof ApiError ? err.message : fallback);
    },
    [showBanner],
  );

  useEffect(() => {
    api
      .get<{ role: Role }>("/api/v1/auth/me")
      .then((me) => setRole(me.role))
      .catch(() => setRole(null));
  }, []);

  const loadPolicies = useCallback(async () => {
    try {
      const r = await api.get<{ policies: AutopilotPolicyEntry[] }>(
        "/api/v1/autopilot/policy",
      );
      setPolicies(r.policies);
    } catch (err) {
      fail(err, "Failed to load policy.");
    }
  }, [fail]);

  const loadRecs = useCallback(
    async (status: string) => {
      try {
        const r = await api.get<Paginated<Recommendation>>(
          `/api/v1/autopilot/recommendations?status=${encodeURIComponent(status)}&limit=100`,
        );
        setRecs(r.items);
        if (status === "pending") {
          setPendingCount(r.total);
        } else {
          const p = await api.get<Paginated<Recommendation>>(
            "/api/v1/autopilot/recommendations?status=pending&limit=1",
          );
          setPendingCount(p.total);
        }
      } catch (err) {
        fail(err, "Failed to load recommendations.");
      }
    },
    [fail],
  );

  const loadActions = useCallback(async () => {
    try {
      const r = await api.get<Paginated<ActionLogEntry>>(
        "/api/v1/autopilot/actions?limit=100",
      );
      setActions(r.items);
    } catch (err) {
      fail(err, "Failed to load action log.");
    }
  }, [fail]);

  useEffect(() => {
    void loadPolicies();
    void loadRecs("pending");
    void loadActions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusFilter = (s: string) => {
    setStatusFilter(s);
    void loadRecs(s);
  };

  const handleSavePolicy = async (
    actionType: string,
    autonomy: AutopilotPolicyEntry["autonomy"],
    maxAutoPerHour: number,
  ) => {
    setSavingType(actionType);
    try {
      await api.put(`/api/v1/autopilot/policy/${actionType}`, {
        autonomy,
        max_auto_per_hour: maxAutoPerHour,
      });
      showBanner("success", `Policy for ${actionType} saved.`);
      await loadPolicies();
    } catch (err) {
      fail(err, "Failed to save policy.");
    } finally {
      setSavingType(null);
    }
  };

  const decide = async (id: number, verb: "approve" | "reject") => {
    setBusyId(id);
    try {
      await api.post(`/api/v1/autopilot/recommendations/${id}/${verb}`, {});
      showBanner(
        verb === "approve" ? "success" : "info",
        verb === "approve"
          ? `Recommendation #${id} approved — executing.`
          : `Recommendation #${id} rejected.`,
      );
      await Promise.all([loadRecs(statusFilter), loadActions()]);
    } catch (err) {
      fail(err, `Failed to ${verb} recommendation.`);
    } finally {
      setBusyId(null);
    }
  };

  const handleModify = async (id: number, payload: Record<string, unknown>) => {
    setBusyId(id);
    try {
      await api.post(`/api/v1/autopilot/recommendations/${id}/modify`, { payload });
      showBanner("success", `Recommendation #${id} payload updated.`);
      await loadRecs(statusFilter);
    } catch (err) {
      fail(err, "Failed to modify recommendation.");
    } finally {
      setBusyId(null);
    }
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const r = await api.post<{ created: number; refreshed: number; superseded: number }>(
        "/api/v1/autopilot/evaluate",
        {},
      );
      showBanner(
        "info",
        `Evaluated: ${r.created} new, ${r.refreshed} refreshed, ${r.superseded} superseded.`,
      );
      await loadRecs(statusFilter);
    } catch (err) {
      fail(err, "Evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  };

  const handleQueuedForApproval = (recId: number, alreadyPending: boolean) => {
    showBanner(
      "info",
      alreadyPending
        ? `An identical execute request is already pending approval (#${recId}).`
        : `Execute request queued for admin approval (#${recId}).`,
    );
    setTab("approvals");
    setStatusFilter("pending");
    void loadRecs("pending");
  };

  return (
    <div className="p-8 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">AI Autopilot</h3>
          <p className="text-xs text-zinc-500">
            Policy-governed recommendations with human-in-the-loop approval and
            full audit
          </p>
        </div>
        <nav className="flex items-center gap-1.5" aria-label="Autopilot sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                tab === t.key
                  ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
              }`}
            >
              {t.label}
              {t.key === "approvals" && pendingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-violet-500/25 text-violet-200">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {banner && (
        <div
          role="status"
          className={`px-4 py-2.5 rounded-xl border text-xs ${
            banner.kind === "error"
              ? "bg-red-500/10 border-red-500/20 text-red-300"
              : banner.kind === "success"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                : "bg-blue-500/10 border-blue-500/20 text-blue-300"
          }`}
        >
          {banner.text}
        </div>
      )}

      {tab === "console" && (
        <RunConsole onQueuedForApproval={handleQueuedForApproval} />
      )}
      {tab === "approvals" && (
        <ApprovalQueue
          items={recs}
          role={role}
          busyId={busyId}
          statusFilter={statusFilter}
          onStatusFilter={handleStatusFilter}
          onApprove={(id) => void decide(id, "approve")}
          onReject={(id) => void decide(id, "reject")}
          onModify={(id, payload) => void handleModify(id, payload)}
          onEvaluate={() => void handleEvaluate()}
          evaluating={evaluating}
        />
      )}
      {tab === "policy" && (
        <PolicyPanel
          policies={policies}
          role={role}
          savingType={savingType}
          onSave={(t, a, m) => void handleSavePolicy(t, a, m)}
        />
      )}
      {tab === "actions" && <ActionLog items={actions} />}
    </div>
  );
}
