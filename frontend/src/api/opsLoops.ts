import { api } from "./client";

export type OpsLoopStatus = "draft" | "candidate" | "active" | "paused" | "error" | "archived";
export type OpsLoopPhase = "observe" | "orient" | "decide" | "act" | "learn" | "idle";
export type OpsRunStatus = "pending" | "running" | "awaiting_confirm" | "completed" | "failed";

export interface OpsLoopDefinition {
  goal?: { metric?: string; target?: string; threshold?: string };
  phases?: Record<string, Record<string, unknown>>;
  loop_condition?: string;
  layout?: Record<string, { x: number; y: number }>;
}

export interface OpsLoopRunSummary {
  id: number;
  run_key: string;
  status: OpsRunStatus;
  phase: string;
  progress: number;
  round: number;
  updated_at?: string;
}

export interface OpsLoopItem {
  id: number;
  loop_key: string;
  name: string;
  description: string;
  status: OpsLoopStatus;
  source: "ai" | "manual";
  confidence: number;
  definition: OpsLoopDefinition;
  knowledge_refs: unknown[];
  metrics_snapshot: Record<string, unknown>;
  ooda_phase: OpsLoopPhase;
  last_result?: Record<string, unknown>;
  current_run_key: string;
  linked_feedback_loop_id?: number | null;
  latest_run?: OpsLoopRunSummary | null;
  created_at: string;
  updated_at: string;
}

export interface OpsLoopRunItem {
  id: number;
  run_key: string;
  loop_id: number;
  round: number;
  status: OpsRunStatus;
  phase: string;
  progress: number;
  trace_id: string;
  logs: Array<{ ts?: string; phase?: string; message?: string }>;
  phase_results: Record<string, unknown>;
  metrics: Record<string, unknown>;
  error: Record<string, unknown>;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpsDiscoverCandidate {
  title: string;
  score: number;
  rationale: string;
  data_completeness?: number;
  execution_feasibility?: number;
  object_count?: number;
  suggested_definition?: OpsLoopDefinition;
  evidence_refs?: Array<{ filename?: string; excerpt?: string }>;
}

export interface OpsDiscoverResult {
  query: string;
  snippets: Array<{ filename?: string; text?: string }>;
  analysis: {
    documents_read?: number;
    rules_found?: number;
    objects_found?: number;
    summary?: string;
  };
  candidates: OpsDiscoverCandidate[];
  llm_used?: boolean;
}

export const listOpsLoops = (params?: { status?: string }) =>
  api.get<{ results: OpsLoopItem[] }>("/ops-loops/", { params }).then((r) => r.data);

export const getOpsLoop = (id: number) =>
  api.get<OpsLoopItem>(`/ops-loops/${id}/`).then((r) => r.data);

export const createOpsLoop = (body: Partial<OpsLoopItem> & { name: string }) =>
  api.post<OpsLoopItem>("/ops-loops/", body).then((r) => r.data);

export const updateOpsLoop = (id: number, body: Partial<OpsLoopItem>) =>
  api.patch<OpsLoopItem>(`/ops-loops/${id}/`, body).then((r) => r.data);

export const deleteOpsLoop = (id: number) =>
  api.delete(`/ops-loops/${id}/`);

export const publishOpsLoop = (id: number) =>
  api.post<OpsLoopItem>(`/ops-loops/${id}/publish/`).then((r) => r.data);

export const pauseOpsLoop = (id: number) =>
  api.post<OpsLoopItem>(`/ops-loops/${id}/pause/`).then((r) => r.data);

export const discoverOpsLoops = (body?: { query?: string }) =>
  api.post<OpsDiscoverResult>("/ops-loops/discover/", body || {}, { timeout: 120_000 }).then((r) => r.data);

export const createOpsLoopFromCandidate = (body: OpsDiscoverCandidate) =>
  api.post<OpsLoopItem>("/ops-loops/from-candidate/", body).then((r) => r.data);

export const listOpsLoopRuns = (loopId: number) =>
  api.get<{ results: OpsLoopRunItem[] }>(`/ops-loops/${loopId}/runs/`).then((r) => r.data);

export const startOpsLoopRun = (loopId: number) =>
  api.post<OpsLoopRunItem>(`/ops-loops/${loopId}/runs/`).then((r) => r.data);

export const getOpsLoopRun = (runId: number) =>
  api.get<OpsLoopRunItem>(`/ops-loops/runs/${runId}/`).then((r) => r.data);

export const confirmOpsLoopAct = (runId: number) =>
  api.post<OpsLoopRunItem>(`/ops-loops/runs/${runId}/confirm-act/`).then((r) => r.data);
