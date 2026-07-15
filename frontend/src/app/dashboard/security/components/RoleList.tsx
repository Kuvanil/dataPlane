"use client";
import { useState } from "react";
import type { DependentsWarning, Role, RoleRecord } from "../lib/types";
import { formatTimestamp } from "../lib/format";
import ConfirmDialog from "./ConfirmDialog";

interface RoleListProps {
  role: Role | null;
  roles: RoleRecord[];
  loading: boolean;
  error: string | null;
  onCreate: (name: string, description: string) => Promise<void>;
  onUpdate: (roleId: number, patch: { name?: string; description?: string; is_active?: boolean }) => Promise<void>;
  onDelete: (roleId: number, confirm?: boolean) => Promise<DependentsWarning | null>;
}

const BUILT_IN = new Set(["admin", "analyst", "viewer"]);

export default function RoleList({ role, roles, loading, error, onCreate, onUpdate, onDelete }: RoleListProps) {
  const canManage = role === "admin";
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string; warning?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const startCreate = () => {
    setCreating(true);
    setNewName("");
    setNewDescription("");
  };

  const submitCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await onCreate(newName.trim(), newDescription.trim());
      setCreating(false);
    } catch {
      // toast shown by hook
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: RoleRecord) => {
    setEditingId(r.id);
    setEditDescription(r.description ?? "");
  };

  const submitEdit = async (roleId: number) => {
    setBusy(true);
    try {
      await onUpdate(roleId, { description: editDescription.trim() || undefined });
      setEditingId(null);
    } catch {
      // toast shown by hook
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (r: RoleRecord) => {
    await onUpdate(r.id, { is_active: !r.is_active });
  };

  const requestDelete = async (r: RoleRecord) => {
    setBusy(true);
    try {
      const result = await onDelete(r.id, false);
      if (result) {
        setPendingDelete({ id: r.id, name: r.name, warning: result.warning });
      }
    } catch {
      // toast shown by hook
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await onDelete(pendingDelete.id, true);
      setPendingDelete(null);
    } catch {
      // toast shown by hook
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-surface-elevated border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-fg0">
          {roles.length} role{roles.length === 1 ? "" : "s"} — admin/analyst/viewer are built-in and cannot be renamed, deactivated, or deleted.
        </p>
        {canManage && !creating && (
          <button
            onClick={startCreate}
            className="px-3 py-1.5 text-xs font-semibold text-fg bg-white rounded-lg hover:bg-surface"
          >
            + New Role
          </button>
        )}
      </div>

      {creating && (
        <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 flex flex-col gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Role name (e.g. auditor)"
            className="px-3 py-2 text-sm rounded-lg bg-background border border-border-strong text-fg-muted"
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="px-3 py-2 text-sm rounded-lg bg-background border border-border-strong text-fg-muted"
          />
          <div className="flex gap-2">
            <button
              onClick={submitCreate}
              disabled={busy || !newName.trim()}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 text-xs font-semibold text-fg-subtle bg-surface-overlay hover:bg-surface-overlay rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {roles.length === 0 && !creating && (
        <div className="p-6 text-center text-sm text-fg0 rounded-xl border border-border bg-surface-elevated">
          No roles defined — create your first role.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {roles.map((r) => (
          <div
            key={r.id}
            className="p-4 rounded-xl border border-border bg-surface-elevated flex items-center justify-between gap-4"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg-muted">{r.name}</span>
                {BUILT_IN.has(r.name) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-border-strong text-fg0">built-in</span>
                )}
                {!r.is_active && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400">inactive</span>
                )}
              </div>
              {editingId === r.id ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    autoFocus
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="px-2 py-1 text-xs rounded bg-background border border-border-strong text-fg-muted flex-1"
                  />
                  <button onClick={() => submitEdit(r.id)} className="text-xs text-blue-400 hover:text-blue-300">Save</button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-fg0 hover:text-fg-subtle">Cancel</button>
                </div>
              ) : (
                <p className="text-xs text-fg0 mt-0.5">{r.description || "—"}</p>
              )}
              <p className="text-[10px] text-fg-subtle mt-1">
                {r.permission_count} permission(s) · {r.user_count} user(s) · updated {formatTimestamp(r.updated_at)}
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2 shrink-0">
                {editingId !== r.id && (
                  <button onClick={() => startEdit(r)} className="text-xs text-fg-subtle hover:text-fg-muted">Edit</button>
                )}
                {!BUILT_IN.has(r.name) && (
                  <>
                    <button onClick={() => toggleActive(r)} className="text-xs text-fg-subtle hover:text-fg-muted">
                      {r.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button onClick={() => requestDelete(r)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete role "${pendingDelete.name}"?`}
          message={pendingDelete.warning || `Are you sure you want to delete "${pendingDelete.name}"?`}
          confirmLabel="Delete anyway"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
