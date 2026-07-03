/**
 * TypeScript types matching the backend Pydantic schemas in
 * backend/app/schemas/mapping.py. Keep these in sync — the backend is
 * the source of truth.
 */

export type Role = "admin" | "analyst" | "viewer";

export interface SourceRef {
  table: string;
  column: string;
  type?: string | null;
  nullable?: boolean | null;
}

export interface TargetRef {
  table: string;
  column: string;
  type?: string | null;
  nullable?: boolean | null;
  primary_key?: boolean | null;
}

export type TransformationKind =
  | "direct"
  | "cast"
  | "concat"
  | "substring"
  | "coalesce"
  | "upper"
  | "lower"
  | "trim"
  | "default"
  | "null_if"
  | "lookup";

export type TransformationPayload =
  | { kind: "direct" }
  | { kind: "cast"; from: string; to: string }
  | {
      kind: "concat";
      parts: Array<
        | { kind: "literal"; value: string }
        | { kind: "source" }
      >;
    }
  | { kind: "substring"; source_index: number; start: number; length: number }
  | { kind: "coalesce"; fallback_kind: "literal"; fallback_value: string }
  | { kind: "upper" }
  | { kind: "lower" }
  | { kind: "trim" }
  | { kind: "default"; value_kind: "literal"; value: string }
  | { kind: "null_if"; equals: string }
  | {
      kind: "lookup";
      table: string;
      key_column: string;
      value_column: string;
      default?: string | null;
    };

export type EdgeOrigin = "manual" | "ai_accepted" | "english_parsed";

export interface EdgeAudit {
  created_by?: string;
  created_at?: string;
  updated_by?: string;
  updated_at?: string;
}

export interface FieldMapping {
  id: number;
  mapping_id: number;
  target: TargetRef;
  sources: SourceRef[];
  transformation: TransformationPayload;
  origin: EdgeOrigin;
  ai_confidence?: number | null;
  audit: EdgeAudit;
  created_at: string;
  updated_at: string;
}

export type MappingStatus = "draft" | "published";

export interface Mapping {
  id: number;
  name: string;
  source_id: number | null;
  target_id: number | null;
  status: MappingStatus;
  current_version_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  edges: FieldMapping[];
}

export type SuggestionStatus = "pending" | "accepted" | "rejected";

export interface AISuggestion {
  id: number;
  mapping_id: number;
  target_table: string;
  target_column: string;
  target_type: string | null;
  source_table: string;
  source_column: string;
  source_type: string | null;
  confidence: number;
  reason: string | null;
  status: SuggestionStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export type IssueVerdict = "ok" | "lossy_warning" | "blocking";

export interface ValidationIssue {
  edge_id: number | null;
  suggestion_id: number | null;
  verdict: IssueVerdict;
  message: string;
}

export interface ValidationResponse {
  mapping_id: number;
  ok_count: number;
  warning_count: number;
  blocking_count: number;
  issues: ValidationIssue[];
}

export interface PublishResponse {
  mapping_id: number;
  version_number: number;
  version_id: number;
  status: string;
  published_at: string;
  published_by: string;
}

export interface ConnectorRef {
  id: number;
  name: string;
  type: string;
}

/** Body for PUT /mappings/{id}/edges/{eid}/transformation */
export interface EdgeTransformationUpdate {
  transformation: TransformationPayload;
}

/** Body for POST /mappings/{id}/suggestions/{sid}/accept */
export interface SuggestionAcceptRequest {
  transformation?: TransformationPayload;
}

/**
 * Paginated list envelope matching the backend's MappingListResponse /
 * SuggestionListResponse shape (backend/app/schemas/mapping.py).
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ExportArtifact {
  mapping_id: number;
  name: string;
  version: number;
  status: "published";
  published_at: string | null;
  published_by: string | null;
  source: { connection_id: number | null; name: string | null; type: string | null };
  target: { connection_id: number | null; name: string | null; type: string | null };
  field_mappings: Array<{
    id: number;
    origin: EdgeOrigin;
    ai_confidence: number | null;
    target: TargetRef;
    sources: SourceRef[];
    transformation: TransformationPayload;
    audit: EdgeAudit;
  }>;
  schema_snapshot: { source?: unknown; target?: unknown };
}
