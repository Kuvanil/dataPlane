/**
 * Types for the Pipeline Management page (Pipelines_tasks Task #7).
 * Mirrors backend/app/schemas/pipeline.py field-for-field.
 */

export type Role = "admin" | "analyst" | "viewer";

export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "retrying";
export type RunTrigger = "manual" | "scheduled" | "rerun";
export type StepName = "extract" | "transform" | "load";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface Schedule {
  id: number;
  pipeline_id: number;
  cron_expression: string;
  enabled: boolean;
  timezone: string;
  next_run_at: string | null;
}

export interface RetryPolicy {
  id: number;
  pipeline_id: number;
  max_attempts: number;
  backoff_seconds: number;
  retryable_error_patterns: string[] | null;
}

export interface Pipeline {
  id: number;
  name: string;
  source_connection_id: number;
  target_connection_id: number;
  mapping_id: number;
  mapping_version_id: number;
  enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  schedule?: Schedule | null;
  retry_policy?: RetryPolicy | null;
}

export interface PipelineRunStep {
  id: number;
  run_id: number;
  step: StepName;
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  rows_processed: number;
  error_message: string | null;
}

export interface PipelineRun {
  id: number;
  pipeline_id: number;
  status: RunStatus;
  trigger: RunTrigger;
  started_at: string | null;
  finished_at: string | null;
  rows_processed: number;
  error_message: string | null;
  retry_count: number;
  parent_run_id: number | null;
  steps: PipelineRunStep[];
}

export interface DriftValidation {
  pipeline_id: number;
  has_drift: boolean;
  baseline_hash: string | null;
  current_hash: string | null;
  changed_tables: string[];
  message: string;
}

export interface ConnectorRef {
  id: number;
  name: string;
  type: string;
}

export interface PublishedMappingRef {
  id: number;
  name: string;
  source_id: number | null;
  target_id: number | null;
  status: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface RunTriggerResponse {
  status: "queued";
  run_id: number;
  task_id: string;
}

export interface RerunResponse {
  status: "queued";
  original_run_id: number;
  new_run_id: number;
  task_id: string;
}
