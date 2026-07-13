export interface Tenant {
  id: number;
  name: string;
  slug: string;
  status: "active" | "suspended";
  created_at: string;
  resource_counts?: {
    connections: number;
    mappings: number;
    pipelines: number;
    users: number;
  };
  resource_limits?: {
    max_connections: number | null;
    max_mappings: number | null;
    max_pipelines: number | null;
  };
}

export interface TenantUser {
  id: number;
  name: string;
  email: string;
  role: string;
  last_active: string | null;
  status: "active" | "inactive";
}

export interface TenantResource {
  id: number;
  name: string;
  type: "connection" | "mapping" | "pipeline";
  status: string;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  module: string;
}