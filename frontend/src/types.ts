// API types. These mirror the Pydantic response models in backend/app/schemas.py.

export type Role = "analyst" | "controller" | "auditor" | "admin";
export type Severity = "high" | "medium" | "low";
export type ExceptionStatus = "open" | "accepted" | "rejected" | "overridden" | "resolved_by_rerun";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type DecisionAction = "accept" | "reject" | "override" | "comment" | "reopen";

export interface Me {
  username: string;
  role: Role;
}

export interface Company {
  id: string;
  name: string;
  sector: string | null;
  currency: string;
  fiscal_year_end: string | null;
  segments: string[];
}

export interface CompanyInput {
  id: string;
  name: string;
  sector?: string;
  currency: string;
  fiscal_year_end?: string;
  segments: string[];
}

export interface RunBrief {
  id: string;
  status: RunStatus;
  created_at: string;
  finished_at: string | null;
  step_count: number;
  current_node: string | null;
}

export interface SetSummary {
  id: string;
  company_id: string;
  company_name: string;
  currency: string;
  fiscal_year: number;
  source: string;
  documents: number;
  latest_run: RunBrief | null;
  open_exceptions: number;
  total_exceptions: number;
}

export interface DocumentInfo {
  id: string;
  filename: string;
  format: "pdf" | "xlsx" | "csv";
  size_bytes: number;
  pages: number | null;
  sha256: string;
}

export interface SetDetail extends SetSummary {
  document_list: DocumentInfo[];
}

export interface RunStep {
  seq: number;
  node: string;
  started_at: string;
  duration_ms: number;
  summary: Record<string, unknown>;
}

export interface Run {
  id: string;
  set_id: string;
  status: RunStatus;
  current_node: string | null;
  step_count: number;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  stats: Record<string, any>;
}

export interface RunDetail extends Run {
  steps: RunStep[];
}

export interface ToolCall {
  id: number;
  node: string;
  tool: string;
  input: Record<string, unknown>;
  output_summary: Record<string, unknown> | null;
  status: "ok" | "error";
  attempts: number;
  duration_ms: number;
  error: string | null;
  created_at: string;
}

/** Where a figure sits in its source document. Which keys exist depends on the file type. */
export interface Location {
  doc: string;
  page?: number;
  table?: string;
  bbox?: [number, number, number, number];
  page_size?: [number, number];
  sheet?: string;
  cell?: string;
  line?: number;
  row?: string;
  column?: string;
}

export interface EvidenceItem {
  line_item_id: number;
  document_id: string;
  filename: string;
  value: number | null;
  displayed: string;
  location: Location;
  missing: boolean;
}

export interface ExceptionItem {
  id: string;
  set_id: string;
  metric: string;
  period: string;
  type: string;
  severity: Severity;
  status: ExceptionStatus;
  expected_value: number | null;
  reported_value: number | null;
  override_value: number | null;
  unit: string;
  outlier_documents: string[];
  explanation: string;
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: number;
  action: DecisionAction;
  comment: string | null;
  override_value: number | null;
  status_before: ExceptionStatus;
  status_after: ExceptionStatus;
  username: string;
  role: Role;
  created_at: string;
}

export interface ExceptionDetail extends ExceptionItem {
  evidence: {
    supporting: EvidenceItem[];
    conflicting: EvidenceItem[];
    baseline: { period: string; value: number; source?: string } | null;
    detail: Record<string, unknown>;
  };
  decisions: Decision[];
  documents: Record<string, string>;
}

export interface ExceptionPage {
  items: ExceptionItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface Summary {
  sets: number;
  runs_by_status: Record<string, number>;
  exceptions_by_status: Record<string, number>;
  open_by_severity: Record<string, number>;
  open_by_type: Record<string, number>;
}

export interface Rules {
  anomaly_threshold: number;
  baseline_metrics: string[];
}

export interface AuditEntry {
  id: number;
  exception_id: string;
  set_id: string;
  metric: string;
  period: string;
  severity: Severity;
  unit: string;
  action: DecisionAction;
  comment: string | null;
  override_value: number | null;
  status_before: ExceptionStatus;
  status_after: ExceptionStatus;
  username: string;
  role: Role;
  created_at: string;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface CompanyReport {
  company_id: string;
  company_name: string;
  sets: number;
  open: number;
  high: number;
  decided: number;
}

export interface Reports {
  by_company: CompanyReport[];
  type_by_severity: Record<string, Partial<Record<Severity, number>>>;
  by_metric: Record<string, number>;
  decisions_by_user: Record<string, number>;
  decisions_by_action: Record<string, number>;
}

export interface UserInfo {
  username: string;
  role: Role;
  decisions: number;
  runs_started: number;
  last_active: string | null;
}

export interface SystemStatus {
  version: string;
  database: string;
  llm_enabled: boolean;
  llm_model: string | null;
  llm_max_calls_per_run: number;
  worker_threads: number;
  max_steps: number;
  anomaly_threshold: number;
  counts: Record<string, number>;
  runs_by_status: Record<string, number>;
}

export interface ToolSchema {
  name: string;
  description: string;
  [key: string]: unknown;
}
