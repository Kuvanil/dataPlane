"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSecurity } from "./hooks/useSecurity";
import { classNames } from "./lib/format";

import RoleList from "./components/RoleList";
import RolePermissionMatrix from "./components/RolePermissionMatrix";
import UserRoleAssignment from "./components/UserRoleAssignment";
import MaskingPolicyEditor from "./components/MaskingPolicyEditor";
import RowFilterEditor from "./components/RowFilterEditor";
import SecurityAuditLog from "./components/SecurityAuditLog";
import Toast from "./components/Toast";

const TABS = [
  { key: "roles", label: "Roles" },
  { key: "permissions", label: "Permissions" },
  { key: "users", label: "Users" },
  { key: "masking", label: "Masking" },
  { key: "row-filters", label: "Row Filters" },
  { key: "audit", label: "Audit" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function SecurityPage() {
  const router = useRouter();
  const s = useSecurity();
  const [activeTab, setActiveTab] = useState<TabKey>("roles");

  const isAdmin = s.role === "admin";

  return (
    <div className="p-8 flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center bg-surface-elevated p-5 rounded-2xl border border-border backdrop-blur-sm">
        <div>
          <h3 className="text-lg font-semibold text-fg-muted">Security Administration</h3>
          <p className="text-xs text-fg0">
            Roles, permissions, data-protection policies (masking + row-level access), and the security audit trail.
            {!isAdmin && " You're viewing in read-only mode — only admins can change roles or policies."}
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard/schema")}
          className="px-4 py-2 text-sm font-semibold text-fg-muted bg-surface-overlay rounded-xl hover:bg-surface-overlay transition-all flex items-center gap-2"
        >
          🔍 PII Classifications (Schema Intel) →
        </button>
      </div>

      <div className="flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={classNames(
              "px-4 py-2 text-sm transition-colors",
              activeTab === tab.key
                ? "text-fg border-b-2 border-blue-500 font-semibold"
                : "text-fg0 hover:text-fg-muted",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "roles" && (
          <RoleList
            role={s.role}
            roles={s.roles}
            loading={s.rolesLoading}
            error={s.rolesError}
            onCreate={s.createRole}
            onUpdate={s.updateRole}
            onDelete={s.deleteRole}
          />
        )}
        {activeTab === "permissions" && (
          <RolePermissionMatrix
            role={s.role}
            roles={s.roles}
            permissions={s.permissions}
            getRolePermissionIds={s.getRolePermissionIds}
            onSave={s.setRolePermissions}
          />
        )}
        {activeTab === "users" && (
          <UserRoleAssignment
            role={s.role}
            users={s.users}
            loading={s.usersLoading}
            roles={s.roles}
            onAssign={s.assignUserRole}
            onRevoke={s.revokeUserRole}
            getEffectivePermissions={s.getEffectivePermissions}
          />
        )}
        {activeTab === "masking" && (
          <MaskingPolicyEditor
            role={s.role}
            connections={s.connections}
            policies={s.maskingPolicies}
            loading={s.maskingLoading}
            roles={s.roles}
            onCreate={s.createMaskingPolicy}
            onDelete={s.deleteMaskingPolicy}
          />
        )}
        {activeTab === "row-filters" && (
          <RowFilterEditor
            role={s.role}
            connections={s.connections}
            policies={s.rowPolicies}
            loading={s.rowPoliciesLoading}
            roles={s.roles}
            onCreate={s.createRowPolicy}
            onDelete={s.deleteRowPolicy}
          />
        )}
        {activeTab === "audit" && (
          <SecurityAuditLog audit={s.audit} loading={s.auditLoading} onRefresh={s.fetchAudit} />
        )}
      </div>

      <Toast toast={s.toast} onDismiss={s.clearToast} />
    </div>
  );
}
