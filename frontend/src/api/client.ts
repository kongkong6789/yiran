import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  timeout: 20000,
});

/** 行级 DB 导入 */
const dbImportTimeout = { timeout: 300_000 };
/** LightRAG / AGE 大批量导入 */
const ageImportTimeout = { timeout: 900_000 };

// ---- 类型定义 ----
export interface LayerNode {
  id: string;
  index: number;
  name: string;
  desc: string;
  children: string[];
}
export interface Architecture {
  title: string;
  layers: LayerNode[];
}

export interface SopStep {
  node: string;
  status: string;
  detail: string;
  data: Record<string, unknown>;
}
export interface SopResult {
  trace_id: string;
  decision: string;
  action: string;
  result?: Record<string, unknown>;
  missing?: string[];
  schema?: Record<string, string>;
  steps: SopStep[];
}

export interface ActionContract {
  name: string;
  title: string;
  object_type: string;
  connector: string;
  required_fields: Record<string, string>;
  required_roles: string[];
  from_states: string[];
  to_state: string | null;
  budget_field: string | null;
  high_risk: boolean;
}

// ---- API 封装 ----
export const getArchitecture = () =>
  api.get<Architecture>("/architecture/").then((r) => r.data);

export const runSop = (body: {
  text: string;
  payload?: Record<string, unknown>;
  role?: string;
}) => api.post<SopResult>("/orchestration/run/", body).then((r) => r.data);

export const getCatalog = () =>
  api.get<{ actions: ActionContract[] }>("/orchestration/catalog/").then((r) => r.data);

export const getTables = () =>
  api.get("/datalake/tables/").then((r) => r.data);
export const getMetrics = () =>
  api.get("/datalake/metrics/").then((r) => r.data);
export const getAnomalies = () =>
  api.get("/datalake/anomalies/").then((r) => r.data);

export const getAuditLogs = () =>
  api.get("/audit-logs/").then((r) => r.data);

// ================= 多 Agent 圆桌会议 =================
export interface Agent {
  id: number;
  name: string;
  emoji: string;
  group: string;
  role: string;
  expertise: string;
  persona: string;
  created_at: string;
}

export interface CouncilMessage {
  id: number;
  speaker_type: "agent" | "user" | "system";
  speaker_name: string;
  emoji: string;
  agent_id: number | null;
  content: string;
  round: number;
  created_at: string;
}

export interface Meeting {
  id: number;
  title: string;
  question: string;
  status: "active" | "paused" | "stopped";
  round: number;
  context_summary: string;
  participants: Agent[];
  created_at: string;
  message_count?: number;
  has_deliverable?: boolean;
  deliverable_title?: string | null;
  graph_ref_count?: number;
}

export interface Deliverable {
  id: number;
  kind: "md" | "html" | "xlsx";
  title: string;
  filename: string;
  content: string;
  has_binary?: boolean;
  version: number;
  created_at: string;
}

/** 会议引用的图谱实体(来自 AGE) */
export interface GraphRef {
  id: number;
  name: string;
  otype: string;
  description?: string;
}

/** 会议结束时的图谱回写摘要 */
export interface GraphWriteback {
  meeting_object_id?: number;
  plan_object_id?: number;
  referenced_entities?: number;
  extracted_objects?: number;
  extracted_relations?: number;
  already_stopped?: boolean;
  error?: string;
}

export const listAgents = () =>
  api.get<{ results: Agent[]; llm: boolean }>("/council/agents/").then((r) => r.data);
export const createAgent = (body: Partial<Agent>) =>
  api.post<Agent>("/council/agents/", body).then((r) => r.data);
export const updateAgent = (id: number, body: Partial<Agent>) =>
  api.patch<Agent>(`/council/agents/${id}/`, body).then((r) => r.data);
export const deleteAgent = (id: number) =>
  api.delete(`/council/agents/${id}/`).then((r) => r.data);

export const createMeeting = (body: {
  title?: string;
  question: string;
  agent_ids: number[];
}) => api.post<Meeting>("/council/meetings/", body).then((r) => r.data);

export const listMeetings = () =>
  api.get<{ count: number; results: Meeting[] }>("/council/meetings/").then((r) => r.data);

export const previewGraphRefs = (question: string) =>
  api
    .get<{ refs: GraphRef[]; card: string }>("/council/graph-preview/", {
      params: { question },
      timeout: 60_000,
    })
    .then((r) => r.data);

export const getMeeting = (id: number) =>
  api
    .get<{
      meeting: Meeting;
      messages: CouncilMessage[];
      deliverable: Deliverable | null;
      deliverables: Deliverable[];
      graph_refs: GraphRef[];
    }>(`/council/meetings/${id}/`)
    .then((r) => r.data);

export const downloadDeliverable = (meetingId: number, deliverableId: number) =>
  api.get(`/council/meetings/${meetingId}/deliverables/${deliverableId}/download/`, {
    responseType: "blob",
  }).then((r) => r.data);

export const pollMessages = (id: number, after: number) =>
  api
    .get<{ status: string; round: number; results: CouncilMessage[] }>(
      `/council/meetings/${id}/messages/?after=${after}`
    )
    .then((r) => r.data);

export const tickMeeting = (id: number) =>
  api
    .post<{ stopped: boolean; messages: CouncilMessage[] }>(
      `/council/meetings/${id}/tick/`,
      {},
      { timeout: 180_000 },
    )
    .then((r) => r.data);

export const interject = (id: number, text: string) =>
  api.post<CouncilMessage>(`/council/meetings/${id}/interject/`, { text }).then((r) => r.data);

export const stopMeeting = (id: number) =>
  api
    .post<{
      deliverables: Deliverable[];
      deliverable: Deliverable;
      graph?: GraphWriteback;
    }>(`/council/meetings/${id}/stop/`, {}, { timeout: 300_000 })
    .then((r) => r.data);

// ================= 本体 ER 图谱 =================
export interface OntObject {
  id: number;
  category: "physical" | "virtual";
  otype: string;
  name: string;
  attributes: Record<string, unknown>;
  x: number;
  y: number;
}
export interface OntRelation {
  id: number;
  source: number;
  target: number;
  label: string;
  polarity?: string;
  delay_days?: number | null;
  evidence_score?: number | null;
  is_causal_candidate?: boolean;
  db_relation_id?: number;
}
export interface OntGraph {
  objects: OntObject[];
  relations: OntRelation[];
  presets: { physical: string[]; virtual: string[] };
  llm: boolean;
  lightrag?: {
    source_id: string;
    workspace: string;
    source_name?: string;
    graph?: string;
    vertices?: number;
    edges?: number;
  };
  meta?: {
    scope: string;
    age_graph?: string;
    objects: number;
    relations: number;
    pg_vertices?: number;
    pg_edges?: number;
    node_limit?: number;
    edge_limit?: number;
    truncated?: boolean;
  };
  source?: string;
}

export const getAgeLiveGraph = (params?: { limit?: number; edge_limit?: number; refresh?: 1 }) =>
  api.get<OntGraph>("/ontology/graph/age-live/", { params }).then((r) => r.data);

export const getGraph = (params?: { scope?: "age" | "all" }) =>
  api.get<OntGraph>("/ontology/graph/", { params: { scope: params?.scope ?? "age" } }).then((r) => r.data);
export const addObject = (body: Partial<OntObject>) =>
  api.post<OntObject>("/ontology/graph/objects/", body).then((r) => r.data);
export const updateObject = (id: number, body: Partial<OntObject>) =>
  api.patch<OntObject>(`/ontology/graph/objects/${id}/`, body).then((r) => r.data);
export const deleteObject = (id: number) =>
  api.delete(`/ontology/graph/objects/${id}/`).then((r) => r.data);
export const addRelation = (body: { source: number; target: number; label: string }) =>
  api.post<OntRelation>("/ontology/graph/relations/", body).then((r) => r.data);
export const deleteRelation = (id: number) =>
  api.delete(`/ontology/graph/relations/${id}/`).then((r) => r.data);
export const updateRelation = (id: number, body: Partial<OntRelation>) =>
  api.patch<OntRelation>(`/ontology/graph/relations/${id}/`, body).then((r) => r.data);
export const upsertRelationCausal = (body: {
  relation_id?: number;
  source_age_id?: number;
  target_age_id?: number;
  source_name?: string;
  target_name?: string;
  label?: string;
  polarity?: string;
  delay_days?: number | null;
  evidence_score?: number | null;
  is_causal_candidate?: boolean;
}) => api.post<OntRelation>("/ontology/graph/relations/upsert-causal/", body).then((r) => r.data);
export const splitObject = (id: number, name?: string) =>
  api.post<{ new_object: OntObject }>(`/ontology/graph/objects/${id}/split/`, { name }).then((r) => r.data);
export const mergeObjects = (keep_id: number, from_id: number) =>
  api.post<{ kept: OntObject }>("/ontology/graph/merge/", { keep_id, from_id }).then((r) => r.data);
export const extractGraph = (text: string) =>
  api.post<OntGraph & { created_objects: number; created_relations: number }>(
    "/ontology/graph/extract/",
    { text }
  ).then((r) => r.data);

// ---- 数据底座打通 ----
export interface ObjectDataBlock {
  title: string;
  rows: Record<string, unknown>[];
}
export interface ObjectData {
  object: { id: number; otype: string; name: string; attributes?: Record<string, unknown> };
  source: string;
  blocks: ObjectDataBlock[];
  note: string;
}

export const importFromDb = () =>
  api.post<{
    mode: string;
    lake_entities: number;
    public_entities: number;
    total_entities: number;
    created_objects: number;
    created_relations: number;
  }>("/ontology/graph/import-from-db/", {}, dbImportTimeout).then((r) => r.data);

export const importFromAge = (sourceId?: string) =>
  api.post<{
    source_id: string;
    source_name?: string;
    workspace?: string;
    graph: string;
    vertices: number;
    created_objects: number;
    created_relations: number;
  }>(
    "/ontology/graph/import-from-age/",
    sourceId ? { source_id: sourceId } : {},
    ageImportTimeout,
  ).then((r) => r.data);

export const getAgeStats = (sourceId?: string) =>
  api.get<{
    source_id: string;
    source_name?: string;
    workspace?: string;
    vertices: number;
    edges: number;
    selected_graph?: string;
    error?: string;
  }>("/ontology/graph/age-stats/", { params: sourceId ? { source_id: sourceId } : {} }).then((r) => r.data);

export const getObjectData = (id: number) =>
  api.get<ObjectData>(`/ontology/graph/objects/${id}/data/`).then((r) => r.data);

// ================= Loops 动力学层 =================
export interface LoopMember {
  id: number;
  sequence: number;
  note: string;
  relation: OntRelation & { source_name?: string; target_name?: string };
}
export interface FeedbackLoop {
  id: number;
  code: string;
  name: string;
  loop_type: "R" | "B" | "comp";
  description: string;
  confidence: number;
  status: "candidate" | "confirmed" | "archived";
  confirmed_by: string;
  confirmed_at: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
  members?: LoopMember[];
}
export interface LoopDetectCandidate {
  relation_ids: number[];
  loop_type: string;
  node_ids: number[];
  confidence: number;
  negative_count: number;
}
export interface LoopDetectDiagnostics {
  candidate_count: number;
  search_relation_count: number;
  total_relation_count: number;
  cycles_in_candidates: number;
  cycles_in_search_set: number;
  cycles_in_all_relations: number;
  reason: string;
  hints: string[];
  longest_open_chains: { relation_ids: number[]; node_names: string[]; length: number }[];
  candidates_preview: {
    id: number;
    source_name: string;
    target_name: string;
    label: string;
    polarity: string;
  }[];
}

export const listLoops = (status?: string) =>
  api.get<{ results: FeedbackLoop[] }>("/loops/", { params: status ? { status } : {} }).then((r) => r.data);
export const getLoop = (id: number) =>
  api.get<FeedbackLoop>(`/loops/${id}/`).then((r) => r.data);
export const createLoop = (body: {
  name: string;
  code?: string;
  loop_type?: string;
  description?: string;
  confidence?: number;
  relation_ids?: number[];
}) => api.post<FeedbackLoop>("/loops/", body).then((r) => r.data);
export const updateLoop = (id: number, body: Partial<FeedbackLoop> & { relation_ids?: number[] }) =>
  api.patch<FeedbackLoop>(`/loops/${id}/`, body).then((r) => r.data);
export const deleteLoop = (id: number) =>
  api.delete(`/loops/${id}/`).then((r) => r.data);
export const confirmLoop = (id: number, body?: { confirmed_by?: string; confidence?: number }) =>
  api.post<FeedbackLoop>(`/loops/${id}/confirm/`, body || {}).then((r) => r.data);
export const detectLoops = (body?: {
  relation_ids?: number[];
  candidates_only?: boolean;
  max_len?: number;
}) => api.post<{
  candidates: LoopDetectCandidate[];
  count: number;
  diagnostics: LoopDetectDiagnostics;
}>("/loops/detect/", body || {}).then((r) => r.data);
export const createLoopFromCandidate = (body: {
  name: string;
  relation_ids: number[];
  code?: string;
  loop_type?: string;
  confidence?: number;
  description?: string;
}) => api.post<FeedbackLoop>("/loops/from-candidate/", body).then((r) => r.data);
export const listCausalCandidates = () =>
  api.get<{ results: (OntRelation & { source_name?: string; target_name?: string })[] }>(
    "/loops/causal-candidates/",
  ).then((r) => r.data);

