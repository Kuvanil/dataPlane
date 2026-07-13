export interface Connector {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  health_status?: string;
  last_test_error?: string | null;
}

export interface TestResponse {
  status: string;
  diagnostics?: { version?: string | null; latency_ms?: number | null };
  error?: { code: string; message: string } | null;
}

export interface SchemaColumn {
  name: string;
  type: string;
}

export interface SchemaData {
  id: number;
  name: string;
  schema: Record<string, SchemaColumn[]>;
}

export interface DependencyInfo {
  mappings: { id: number; name: string }[];
  pipelines: { id: number; name: string }[];
}

export interface AuditEvent {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}

export const HEALTH_META: Record<string, { label: string; dot: string; text: string }> = {
  healthy:  { label: "Healthy",    dot: "bg-emerald-400", text: "text-emerald-400" },
  degraded: { label: "Degraded",   dot: "bg-amber-400",   text: "text-amber-400" },
  down:     { label: "Down",       dot: "bg-rose-400",    text: "text-rose-400" },
  unknown:  { label: "Not tested", dot: "bg-zinc-500",    text: "text-zinc-400" },
};

export const TYPE_META: Record<string, { icon: string; color: string; bgColor: string }> = {
  sqlite:   { icon: "💾", color: "text-blue-400",   bgColor: "bg-blue-500/10 border-blue-500/20" },
  postgres: { icon: "🐘", color: "text-sky-400",    bgColor: "bg-sky-500/10 border-sky-500/20" },
  mysql:    { icon: "🐬", color: "text-orange-400", bgColor: "bg-orange-500/10 border-orange-500/20" },
  oracle:   { icon: "🏛️", color: "text-red-400",    bgColor: "bg-red-500/10 border-red-500/20" },
  jdbc:     { icon: "🔗", color: "text-violet-400", bgColor: "bg-violet-500/10 border-violet-500/20" },
};

export const VALID_TYPES = ["sqlite", "postgres", "mysql", "oracle", "jdbc"] as const;

export const CONFIG_TEMPLATES: Record<string, string> = {
  sqlite:   '{"path": "/tmp/my_database.db"}',
  postgres: '{"host": "localhost", "port": 5432, "dbname": "mydb", "user": "postgres", "password": "secret"}',
  mysql:    '{"host": "localhost", "port": 3306, "dbname": "mydb", "user": "root", "password": "secret"}',
  oracle:   '{"host": "localhost", "port": 1521, "service_name": "ORCL", "user": "system", "password": "secret"}',
  jdbc:     '{"url": "postgresql://user:pass@host:5432/dbname"}',
};