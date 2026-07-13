"use client";
import { useEffect, useMemo, useState } from "react";
import type {
  DependentsWarning, EffectivePermissionsResponse, Role, RoleRecord, UserSummary,
} from "../lib/types";
import { actionColor, roleColor } from "../lib/format";
import ConfirmDialog from "./ConfirmDialog";

interface UserRoleAssignmentProps {
  role: Role | null;
  users: UserSummary[];
  loading: boolean;
  roles: RoleRecord[];
  onAssign: (userId: number, roleId: number) => Promise<void>;
  onRevoke: (userId: number, roleId: number, confirm?: boolean) => Promise<DependentsWarning | null>;
  getEffectivePermissions: (userId: number) => Promise<EffectivePermissionsResponse>;
}

export default function UserRoleAssignment({
  role, users, loading, roles, onAssign, onRevoke, getEffectivePermissions,
}: UserRoleAssignmentProps) {
  const canManage = role === "admin";
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [addRoleId, setAddRoleId] = useState<number | "">("");
  const [preview, setPreview] = useState<EffectivePermissionsResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<{ roleId: number; roleName: string; warning?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const filteredUsers = useMemo(
    () => users.filter((u) => u.email.toLowerCase().includes(search.toLowerCase())),
    [users, search],
  );

  useEffect(() => {
    if (selectedUserId === null && filteredUsers.length > 0) {
      setSelectedUserId(filteredUsers[0].id);
    }
  }, [filteredUsers, selectedUserId]);

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  useEffect(() => {
    if (selectedUserId === null) return;
    setPreviewLoading(true);
    getEffectivePermissions(selectedUserId)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [selectedUserId, getEffectivePermissions]);

  const refreshPreview = async () => {
    if (selectedUserId === null) return;
    const data = await getEffectivePermissions(selectedUserId);
    setPreview(data);
  };

  const assignableRoles = roles.filter(
    (r) => r.is_active && !selectedUser?.roles.includes(r.name),
  );

  const handleAssign = async () => {
    if (selectedUserId === null || addRoleId === "") return;
    setBusy(true);
    try {
      await onAssign(selectedUserId, Number(addRoleId));
      setAddRoleId("");
      await refreshPreview();
    } catch {
      // toast shown by hook
    } finally {
      setBusy(false);
    }
  };

  const requestRevoke = async (roleName: string) => {
    if (selectedUserId === null) return;
    const roleRec = roles.find((r) => r.name === roleName);
    if (!roleRec) return;
    setBusy(true);
    try {
      const result = await onRevoke(selectedUserId, roleRec.id, false);
      if (result) {
        setPendingRevoke({ roleId: roleRec.id, roleName, warning: result.warning });
      } else {
        await refreshPreview();
      }
    } catch {
      // toast shown by hook
    } finally {
      setBusy(false);
    }
  };

  const confirmRevoke = async () => {
    if (selectedUserId === null || !pendingRevoke) return;
    setBusy(true);
    try {
      await onRevoke(selectedUserId, pendingRevoke.roleId, true);
      setPendingRevoke(null);
      await refreshPreview();
    } catch {
      // toast shown by hook
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="h-64 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />;
  }

  if (users.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-zinc-500 rounded-xl border border-zinc-800 bg-zinc-900/30">
        No users found.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <div className="flex flex-col gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by email..."
          className="px-3 py-2 text-sm rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200"
        />
        <div className="flex flex-col gap-1 max-h-[480px] overflow-y-auto">
          {filteredUsers.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUserId(u.id)}
              className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                selectedUserId === u.id
                  ? "border-blue-500/40 bg-blue-500/10 text-zinc-100"
                  : "border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:bg-zinc-800/40"
              }`}
            >
              <div className="font-medium truncate">{u.email}</div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {u.roles.length === 0 ? (
                  <span className="text-[10px] text-zinc-600">no roles</span>
                ) : (
                  u.roles.map((rn) => (
                    <span key={rn} className={`text-[10px] px-1.5 py-0.5 rounded border ${roleColor(rn)}`}>{rn}</span>
                  ))
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {!selectedUser ? (
          <div className="p-6 text-center text-sm text-zinc-500 rounded-xl border border-zinc-800 bg-zinc-900/30">
            Select a user to manage roles.
          </div>
        ) : (
          <>
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">{selectedUser.email}</p>
                  <p className="text-xs text-zinc-500">cached role (used by legacy checks): {selectedUser.cached_role}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {selectedUser.roles.map((rn) => (
                  <span key={rn} className={`text-xs px-2 py-1 rounded-full border flex items-center gap-2 ${roleColor(rn)}`}>
                    {rn}
                    {canManage && (
                      <button onClick={() => requestRevoke(rn)} className="hover:text-white" aria-label={`Remove ${rn} role`}>
                        ✕
                      </button>
                    )}
                  </span>
                ))}
                {selectedUser.roles.length === 0 && <span className="text-xs text-zinc-600">No roles assigned</span>}
              </div>
              {canManage && (
                <div className="flex gap-2 mt-3">
                  <select
                    value={addRoleId}
                    onChange={(e) => setAddRoleId(e.target.value ? Number(e.target.value) : "")}
                    className="px-3 py-1.5 text-sm rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200"
                  >
                    <option value="">Add role...</option>
                    {assignableRoles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAssign}
                    disabled={addRoleId === "" || busy}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-40"
                  >
                    Assign
                  </button>
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold text-zinc-300 mb-2">Effective permissions</h4>
              {previewLoading ? (
                <div className="h-40 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />
              ) : preview ? (
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full text-left border-collapse text-xs min-w-[560px]">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/60">
                        <th className="p-2 font-semibold text-zinc-400">Module</th>
                        <th className="p-2 font-semibold text-zinc-400">Granted actions</th>
                        <th className="p-2 font-semibold text-zinc-400">Via role(s)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(preview.modules).map(([module, actions]) => {
                        const granted = Object.entries(actions).filter(([, v]) => v.granted);
                        const viaRoles = new Set(granted.flatMap(([, v]) => v.via_roles));
                        return (
                          <tr key={module} className="border-b border-zinc-800/60">
                            <td className="p-2 font-mono text-zinc-300">{module}</td>
                            <td className="p-2">
                              {granted.length === 0 ? (
                                <span className="text-zinc-600">denied (no grants)</span>
                              ) : (
                                granted.map(([action]) => (
                                  <span key={action} className={`mr-2 ${actionColor(action)}`}>{action}</span>
                                ))
                              )}
                            </td>
                            <td className="p-2 text-zinc-500">{[...viaRoles].join(", ") || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">Unable to load effective permissions.</p>
              )}
            </div>
          </>
        )}
      </div>

      {pendingRevoke && (
        <ConfirmDialog
          title={`Remove "${pendingRevoke.roleName}" role?`}
          message={pendingRevoke.warning || `Remove the "${pendingRevoke.roleName}" role from ${selectedUser?.email}?`}
          confirmLabel="Remove anyway"
          busy={busy}
          onConfirm={confirmRevoke}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </div>
  );
}
