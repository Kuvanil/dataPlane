/**
 * Types for the Security Admin page (DP-SEC-001).
 * Mirrors backend/app/schemas/security.py field-for-field.
 */

export type Role = "admin" | "analyst" | "viewer";

export const MODULES = [
  "connectors", "pipelines", "mapper", "schema_intel", "query_studio",
  "askdata", "autopilot", "audit", "security", "viz",
] as const;
export type ModuleName = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "run", "publish", "admin"] as const;
export type ActionName = (typeof ACTIONS)[number];

export const MASKING_TYPES = ["redact", "hash", "truncate", "substitute", "nullify"] as const;
export type MaskingType = (typeof MASKING_TYPES)[number];

export const FILTER_OPERATORS = ["=", "!=", ">", "<", ">=", "<=", "in", "not in"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface RoleRecord {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  permission_count: number;
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface PermissionRecord {
  id: number;
  module: string;
  action: string;
}

export interface UserSummary {
  id: number;
  email: string;
  cached_role: string;
  is_active: boolean;
  roles: string[];
}

export interface UserRoleBadge {
  id: number;
  name: string;
}

export interface UserRolesResponse {
  user_id: number;
  email: string;
  roles: UserRoleBadge[];
}

export interface EffectivePermissionAction {
  granted: boolean;
  via_roles: string[];
}

export interface EffectivePermissionsResponse {
  user_id: number;
  email: string;
  roles: string[];
  modules: Record<string, Record<string, EffectivePermissionAction>>;
}

export interface AuthzCheckResponse {
  allowed: boolean;
  reason: string;
  module: string;
  action: string;
}

export interface MaskingPolicy {
  id: number;
  connection_id: number;
  table_name: string;
  column_name: string;
  masking_type: MaskingType;
  exempt_roles: string[];
  created_at: string;
  updated_at: string;
}

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string | number | (string | number)[];
  logic?: "AND" | "OR";
}

export interface RowAccessPolicy {
  id: number;
  connection_id: number;
  table_name: string;
  filter_conditions: FilterCondition[];
  applies_to_roles: string[];
  created_at: string;
  updated_at: string;
}

export interface ConnectorRef {
  id: number;
  name: string;
  type: string;
}

export interface DependentsWarning {
  warning: string;
  requires_confirm: true;
  assigned_user_ids?: number[];
}

export interface AuditEvent {
  id: number;
  event_type: string;
  actor: string;
  module: string | null;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  before_summary: Record<string, unknown> | null;
  after_summary: Record<string, unknown> | null;
  outcome: string;
  created_at: string;
}

export interface AuditSearchResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}
