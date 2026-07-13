"use client";
import { useEffect, useMemo, useState } from "react";
import { ACTIONS, MODULES, type PermissionRecord, type Role, type RoleRecord } from "../lib/types";
import { actionColor, classNames } from "../lib/format";

interface RolePermissionMatrixProps {
  role: Role | null;
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  getRolePermissionIds: (roleId: number) => Promise<number[]>;
  onSave: (roleId: number, permissionIds: number[]) => Promise<void>;
}

export default function RolePermissionMatrix({
  role, roles, permissions, getRolePermissionIds, onSave,
}: RolePermissionMatrixProps) {
  const canManage = role === "admin";
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [grantedIds, setGrantedIds] = useState<Set<number>>(new Set());
  const [originalIds, setOriginalIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeRoles = useMemo(() => roles.filter((r) => r.is_active), [roles]);

  useEffect(() => {
    if (selectedRoleId === null && activeRoles.length > 0) {
      setSelectedRoleId(activeRoles[0].id);
    }
  }, [activeRoles, selectedRoleId]);

  useEffect(() => {
    if (selectedRoleId === null) return;
    setLoading(true);
    getRolePermissionIds(selectedRoleId)
      .then((ids) => {
        setGrantedIds(new Set(ids));
        setOriginalIds(new Set(ids));
      })
      .finally(() => setLoading(false));
  }, [selectedRoleId, getRolePermissionIds]);

  const permByCell = useMemo(() => {
    const map = new Map<string, PermissionRecord>();
    for (const p of permissions) map.set(`${p.module}:${p.action}`, p);
    return map;
  }, [permissions]);

  const toggle = (permId: number) => {
    if (!canManage) return;
    setGrantedIds((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  };

  const toggleRow = (module: string, grant: boolean) => {
    if (!canManage) return;
    setGrantedIds((prev) => {
      const next = new Set(prev);
      for (const action of ACTIONS) {
        const perm = permByCell.get(`${module}:${action}`);
        if (!perm) continue;
        if (grant) next.add(perm.id);
        else next.delete(perm.id);
      }
      return next;
    });
  };

  const dirty = grantedIds.size !== originalIds.size || [...grantedIds].some((id) => !originalIds.has(id));

  const save = async () => {
    if (selectedRoleId === null) return;
    setSaving(true);
    try {
      await onSave(selectedRoleId, [...grantedIds]);
      setOriginalIds(new Set(grantedIds));
    } catch {
      // toast shown by hook
    } finally {
      setSaving(false);
    }
  };

  const discard = () => setGrantedIds(new Set(originalIds));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-500">Role:</label>
        <select
          value={selectedRoleId ?? ""}
          onChange={(e) => {
            if (dirty && !window.confirm("You have unsaved permission changes. Discard them?")) return;
            setSelectedRoleId(Number(e.target.value));
          }}
          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200"
        >
          {activeRoles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        {dirty && (
          <span className="text-xs text-amber-400">● unsaved changes</span>
        )}
        {canManage && (
          <div className="ml-auto flex gap-2">
            <button
              onClick={discard}
              disabled={!dirty || saving}
              className="px-3 py-1.5 text-xs font-semibold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded-lg disabled:opacity-40"
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-64 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left border-collapse text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/60">
                <th className="p-3 font-semibold text-zinc-400">Module</th>
                {ACTIONS.map((a) => (
                  <th key={a} className={classNames("p-3 font-semibold text-center capitalize", actionColor(a))}>
                    {a}
                  </th>
                ))}
                {canManage && <th className="p-3" />}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((module) => (
                <tr key={module} className="border-b border-zinc-800/60 hover:bg-zinc-800/10">
                  <td className="p-3 font-mono text-xs text-zinc-300">{module}</td>
                  {ACTIONS.map((action) => {
                    const perm = permByCell.get(`${module}:${action}`);
                    const checked = perm ? grantedIds.has(perm.id) : false;
                    return (
                      <td key={action} className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canManage || !perm}
                          onChange={() => perm && toggle(perm.id)}
                          className="w-4 h-4 accent-blue-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                    );
                  })}
                  {canManage && (
                    <td className="p-3 text-center whitespace-nowrap">
                      <button onClick={() => toggleRow(module, true)} className="text-[10px] text-blue-400 hover:text-blue-300 mr-2">all</button>
                      <button onClick={() => toggleRow(module, false)} className="text-[10px] text-zinc-500 hover:text-zinc-400">none</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canManage && (
        <p className="text-xs text-zinc-500">Only admins can change role permissions. You can view the matrix as read-only.</p>
      )}
    </div>
  );
}
