// Response contract of GET /api/v1/dashboard/summary (dashboard_tasks #1).
// Mirrors backend/app/schemas/dashboard.py.

export type TimeRange = "24h" | "7d" | "30d";

export type TileStatus = "loaded" | "error" | "unavailable";

export interface KPITileData {
  label: string;
  value: number;
  subtitle?: string | null;
  trend?: "up" | "down" | "neutral" | null;
  trend_label?: string | null;
  icon?: string | null;
  link_url: string;
  module: string;
  status: TileStatus;
  error_message?: string | null;
}

export interface FeedItemData {
  id: number;
  event_type: string;
  actor: string;
  module: string;
  summary: string;
  status: string;
  created_at: string;
  link_url: string | null;
}

export interface DashboardSummary {
  kpis: KPITileData[];
  feed: FeedItemData[];
  range: string;
  generated_at: string;
}
