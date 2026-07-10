/**
 * TS types for the Semantic / Metrics Layer editor (Task #7).
 *
 * Mirrors the backend Pydantic schemas in
 * backend/app/schemas/semantic.py. Kept lean — the editor only needs
 * fields it actually renders, not the full DB shape.
 */

export interface MetricCatalogEntry {
  id: number;
  name: string;
  version_number: number;
  status: "draft" | "published" | "archived";
  description?: string | null;
  certified: boolean;
  owner?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  published_by?: string | null;
  aggregation?: string | null;
}

export interface MetricDefinitionDraft {
  entity: string;
  measure: string;
  aggregation: string;
  time_grain: string;
  time_column: string;
  description: string;
  certified: boolean;
}

export interface MetricLineageEntry {
  id: number;
  catalog_column_id: number | null;
  role: string;
}

export interface MetricDefinitionView extends MetricCatalogEntry {
  definition: {
    entity?: string;
    measure?: string;
    aggregation?: string;
    time_grain?: string;
    time_column?: string;
    [k: string]: unknown;
  } | null;
  lineage?: MetricLineageEntry[];
}
