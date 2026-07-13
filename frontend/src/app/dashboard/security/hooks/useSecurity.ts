"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type {
  AuditSearchResponse, ConnectorRef, DependentsWarning, EffectivePermissionsResponse,
  MaskingPolicy, PermissionRecord, Role, RoleRecord, RowAccessPolicy, UserRolesResponse,
  UserSummary,
} from "../lib/types";

interface Toast {
  message: string;
  kind: "success" | "error";
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

function isConfirmRequired(body: unknown): body is DependentsWarning {
  return !!body && typeof body === "object" && (body as DependentsWarning).requires_confirm === true;
}

export function useSecurity() {
  const [role, setRole] = useState<Role | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);

  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);

  const [users, setUsers] = useState<UserSummary[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const [maskingPolicies, setMaskingPolicies] = useState<MaskingPolicy[]>([]);
  const [maskingLoading, setMaskingLoading] = useState(true);

  const [rowPolicies, setRowPolicies] = useState<RowAccessPolicy[]>([]);
  const [rowPoliciesLoading, setRowPoliciesLoading] = useState(true);

  const [connections, setConnections] = useState<ConnectorRef[]>([]);

  const [audit, setAudit] = useState<AuditSearchResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);
  const showError = useCallback((message: string) => setToast({ message, kind: "error" }), []);
  const showSuccess = useCallback((message: string) => setToast({ message, kind: "success" }), []);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    void (async () => {
      try {
        const me = await api.get<{ id: number; role: Role }>("/api/v1/auth/me");
        setRole(me.role);
        setCurrentUserId(me.id);
      } catch {
        setRole(null);
      }
    })();
  }, []);

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const data = await api.get<RoleRecord[]>("/api/v1/roles/");
      setRoles(data);
    } catch (err) {
      setRolesError(errorMessage(err, "Failed to load roles."));
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const fetchPermissions = useCallback(async () => {
    try {
      const data = await api.get<PermissionRecord[]>("/api/v1/roles/permissions");
      setPermissions(data);
    } catch (err) {
      showError(errorMessage(err, "Failed to load permission catalog."));
    }
  }, [showError]);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await api.get<UserSummary[]>("/api/v1/users/");
      setUsers(data);
    } catch (err) {
      showError(errorMessage(err, "Failed to load users."));
    } finally {
      setUsersLoading(false);
    }
  }, [showError]);

  const fetchMaskingPolicies = useCallback(async () => {
    setMaskingLoading(true);
    try {
      const data = await api.get<MaskingPolicy[]>("/api/v1/policies/masking");
      setMaskingPolicies(data);
    } catch (err) {
      showError(errorMessage(err, "Failed to load masking policies."));
    } finally {
      setMaskingLoading(false);
    }
  }, [showError]);

  const fetchRowPolicies = useCallback(async () => {
    setRowPoliciesLoading(true);
    try {
      const data = await api.get<RowAccessPolicy[]>("/api/v1/policies/row-access");
      setRowPolicies(data);
    } catch (err) {
      showError(errorMessage(err, "Failed to load row access filters."));
    } finally {
      setRowPoliciesLoading(false);
    }
  }, [showError]);

  const fetchConnections = useCallback(async () => {
    try {
      const data = await api.get<ConnectorRef[]>("/api/v1/connectors/");
      setConnections(data);
    } catch {
      setConnections([]);
    }
  }, []);

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await api.get<AuditSearchResponse>("/api/v1/audit/events?module=security&page_size=100");
      setAudit(data);
    } catch (err) {
      showError(errorMessage(err, "Failed to load security audit log."));
    } finally {
      setAuditLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void fetchRoles();
    void fetchPermissions();
    void fetchUsers();
    void fetchMaskingPolicies();
    void fetchRowPolicies();
    void fetchConnections();
    void fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Role CRUD ────────────────────────────────────────────────────────

  const createRole = useCallback(async (name: string, description: string) => {
    try {
      await api.post("/api/v1/roles/", { name, description: description || null });
      showSuccess(`Role "${name}" created.`);
      await fetchRoles();
    } catch (err) {
      showError(errorMessage(err, "Failed to create role."));
      throw err;
    }
  }, [fetchRoles, showError, showSuccess]);

  const updateRole = useCallback(async (roleId: number, patch: { name?: string; description?: string; is_active?: boolean }) => {
    try {
      await api.put(`/api/v1/roles/${roleId}`, patch);
      showSuccess("Role updated.");
      await fetchRoles();
    } catch (err) {
      showError(errorMessage(err, "Failed to update role."));
      throw err;
    }
  }, [fetchRoles, showError, showSuccess]);

  const deleteRole = useCallback(async (roleId: number, confirm = false): Promise<DependentsWarning | null> => {
    try {
      const result = await api.deleteWithResponse<DependentsWarning | { status: string }>(
        `/api/v1/roles/${roleId}${confirm ? "?confirm=true" : ""}`,
      );
      if (isConfirmRequired(result)) return result;
      showSuccess("Role deleted.");
      await fetchRoles();
      return null;
    } catch (err) {
      showError(errorMessage(err, "Failed to delete role."));
      throw err;
    }
  }, [fetchRoles, showError, showSuccess]);

  const getRolePermissionIds = useCallback(async (roleId: number): Promise<number[]> => {
    return api.get<number[]>(`/api/v1/roles/${roleId}/permissions`);
  }, []);

  const setRolePermissions = useCallback(async (roleId: number, permissionIds: number[]) => {
    try {
      await api.put(`/api/v1/roles/${roleId}/permissions`, { permission_ids: permissionIds });
      showSuccess("Permissions saved.");
      await fetchRoles();
    } catch (err) {
      showError(errorMessage(err, "Failed to save permissions."));
      throw err;
    }
  }, [fetchRoles, showError, showSuccess]);

  // ── User role assignment ────────────────────────────────────────────

  const getUserRoles = useCallback(async (userId: number): Promise<UserRolesResponse> => {
    return api.get<UserRolesResponse>(`/api/v1/users/${userId}/roles`);
  }, []);

  const assignUserRole = useCallback(async (userId: number, roleId: number) => {
    try {
      await api.post(`/api/v1/users/${userId}/roles`, { role_id: roleId });
      showSuccess("Role assigned.");
      await fetchUsers();
    } catch (err) {
      showError(errorMessage(err, "Failed to assign role."));
      throw err;
    }
  }, [fetchUsers, showError, showSuccess]);

  const revokeUserRole = useCallback(async (userId: number, roleId: number, confirm = false): Promise<DependentsWarning | null> => {
    try {
      const result = await api.deleteWithResponse<DependentsWarning | { roles: unknown[] }>(
        `/api/v1/users/${userId}/roles/${roleId}${confirm ? "?confirm=true" : ""}`,
      );
      if (isConfirmRequired(result)) return result;
      showSuccess("Role revoked.");
      await fetchUsers();
      return null;
    } catch (err) {
      showError(errorMessage(err, "Failed to revoke role."));
      throw err;
    }
  }, [fetchUsers, showError, showSuccess]);

  const getEffectivePermissions = useCallback(async (userId: number): Promise<EffectivePermissionsResponse> => {
    return api.get<EffectivePermissionsResponse>(`/api/v1/users/${userId}/effective-permissions`);
  }, []);

  // ── Masking policies ─────────────────────────────────────────────────

  const createMaskingPolicy = useCallback(async (payload: {
    connection_id: number; table_name: string; column_name: string;
    masking_type: string; exempt_roles: string[];
  }) => {
    try {
      await api.post("/api/v1/policies/masking", payload);
      showSuccess("Masking policy created.");
      await fetchMaskingPolicies();
    } catch (err) {
      showError(errorMessage(err, "Failed to create masking policy."));
      throw err;
    }
  }, [fetchMaskingPolicies, showError, showSuccess]);

  const deleteMaskingPolicy = useCallback(async (policyId: number) => {
    try {
      await api.delete(`/api/v1/policies/masking/${policyId}`);
      showSuccess("Masking policy deleted.");
      await fetchMaskingPolicies();
    } catch (err) {
      showError(errorMessage(err, "Failed to delete masking policy."));
      throw err;
    }
  }, [fetchMaskingPolicies, showError, showSuccess]);

  // ── Row access policies ──────────────────────────────────────────────

  const createRowPolicy = useCallback(async (payload: {
    connection_id: number; table_name: string;
    filter_conditions: Array<{ field: string; operator: string; value: unknown; logic?: string }>;
    applies_to_roles: string[];
  }) => {
    try {
      await api.post("/api/v1/policies/row-access", payload);
      showSuccess("Row access filter created.");
      await fetchRowPolicies();
    } catch (err) {
      showError(errorMessage(err, "Failed to create row access filter."));
      throw err;
    }
  }, [fetchRowPolicies, showError, showSuccess]);

  const deleteRowPolicy = useCallback(async (policyId: number) => {
    try {
      await api.delete(`/api/v1/policies/row-access/${policyId}`);
      showSuccess("Row access filter deleted.");
      await fetchRowPolicies();
    } catch (err) {
      showError(errorMessage(err, "Failed to delete row access filter."));
      throw err;
    }
  }, [fetchRowPolicies, showError, showSuccess]);

  return {
    role, currentUserId,
    roles, rolesLoading, rolesError, fetchRoles,
    permissions, fetchPermissions,
    users, usersLoading, fetchUsers,
    maskingPolicies, maskingLoading,
    rowPolicies, rowPoliciesLoading,
    connections,
    audit, auditLoading, fetchAudit,
    createRole, updateRole, deleteRole, getRolePermissionIds, setRolePermissions,
    getUserRoles, assignUserRole, revokeUserRole, getEffectivePermissions,
    createMaskingPolicy, deleteMaskingPolicy,
    createRowPolicy, deleteRowPolicy,
    toast, showError, showSuccess, clearToast,
  };
}
