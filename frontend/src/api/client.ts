import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  timeout: 20000,
});

const TOKEN_KEY = "liangce_auth_token";

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  api.defaults.headers.common.Authorization = `Token ${token}`;
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
  delete api.defaults.headers.common.Authorization;
}

const saved = getAuthToken();
if (saved) {
  api.defaults.headers.common.Authorization = `Token ${saved}`;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      clearAuthToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  is_staff?: boolean;
  is_superuser?: boolean;
}

export const login = (body: { username: string; password: string }) =>
  api.post<{ ok: boolean; token: string; user: AuthUser; error?: string }>("/auth/login/", body)
    .then((r) => r.data);

export const register = (body: { username: string; password: string; email?: string }) =>
  api.post<{ ok: boolean; token: string; user: AuthUser; error?: string }>("/auth/register/", body)
    .then((r) => r.data);

export const logout = () => api.post("/auth/logout/").then((r) => r.data);

export const getMe = () =>
  api.get<{ ok: boolean; user: AuthUser; settings: { llm_configured: boolean } }>("/auth/me/")
    .then((r) => r.data);

export interface UserLlmSettings {
  llm_api_key: string;
  llm_base_url: string;
  llm_model: string;
  configured: boolean;
}

export const getUserSettings = () =>
  api.get<UserLlmSettings>("/auth/settings/").then((r) => r.data);

export const updateUserSettings = (body: Partial<UserLlmSettings>) =>
  api.put<{ ok: boolean; configured: boolean }>("/auth/settings/", body).then((r) => r.data);

// ================= Agent Skills =================
export const getSkills = () =>
  api.get<{ count: number; results: UserSkillItem[] }>("/skills/").then((r) => r.data);

export const uploadSkill = (file: File, adopt = false) => {
  const form = new FormData();
  form.append("file", file);
  if (adopt) form.append("adopt", "1");
  return api.post<{ ok: boolean; created?: boolean; adopted?: boolean; personal?: UserSkillItem; asset?: SkillAssetItem } & Partial<UserSkillItem>>("/skills/upload/", form, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};

export const uploadSkillAsset = (file: File, adopt = true) => {
  const form = new FormData();
  form.append("file", file);
  if (adopt) form.append("adopt", "1");
  return api.post<{ ok: boolean; asset: SkillAssetItem; adopted?: boolean; personal?: UserSkillItem }>("/skills/assets/upload/", form, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};

export const getSkillAssets = () =>
  api.get<{ count: number; results: SkillAssetItem[]; cos_enabled: boolean }>("/skills/assets/")
    .then((r) => r.data);

export const adoptSkillAsset = (skillId: string) =>
  api.post<{ ok: boolean; personal: UserSkillItem; asset: SkillAssetItem }>(`/skills/assets/${skillId}/adopt/`)
    .then((r) => r.data);

export const deleteSkillAsset = (skillId: string) =>
  api.delete(`/skills/assets/${skillId}/`);

export const uploadSkillContent = (body: { content: string; name?: string }) =>
  api.post<{ ok: boolean; created: boolean } & UserSkillItem>("/skills/upload/", body)
    .then((r) => r.data);

export const deleteSkill = (skillId: string) =>
  api.delete(`/skills/${skillId}/`);

export const toggleSkill = (skillId: string, enabled: boolean) =>
  api.patch<UserSkillItem>(`/skills/${skillId}/`, { enabled }).then((r) => r.data);

export const invokeSkill = (skillId: string, body: { message: string; history?: AgentChatMessage[] }) =>
  api.post<AgentChatResult>(`/skills/${skillId}/invoke/`, body, { timeout: 120_000 })
    .then((r) => r.data);

/** 行级 DB 导入 */
const dbImportTimeout = { timeout: 300_000 };
/** LightRAG / AGE 大批量导入 */
const ageImportTimeout = { timeout: 900_000 };

// ---- 类型定义 ----
export interface AgentChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  id?: number;
  meta?: Record<string, unknown>;
  created_at?: string;
}

export interface AgentChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  user_id?: number | null;
  username?: string;
  messages?: AgentChatMessage[];
}

export interface AgentChatResult {
  ok: boolean;
  reply?: string;
  error?: string;
  conversation_id?: string;
  conversation_title?: string;
  llm?: boolean;
  llm_model?: string;
  llm_error?: string;
  knowledge_hit?: boolean;
  mcp?: {
    attempted: boolean;
    ok: boolean;
    error?: string;
    tool?: string;
  };
  refs?: {
    rag?: unknown[];
    graph?: { id: number; name: string; otype: string }[];
    mcp?: { server: string; tool?: string; source?: string }[];
    skills?: { skill_id: string; name: string; description?: string }[];
  };
  skills?: { skill_id: string; name: string; description?: string }[];
  skill_scripts?: {
    skill_id?: string;
    skill_name?: string;
    ok?: boolean;
    error?: string;
    command?: string;
    stderr?: string;
    returncode?: number;
  }[];
  attachments?: {
    id?: string;
    name: string;
    size: number;
    mime?: string;
    has_text?: boolean;
    is_image?: boolean;
    url?: string;
  }[];
}

export interface UserSkillItem {
  id: number;
  skill_id: string;
  name: string;
  description: string;
  enabled: boolean;
  instructions_preview?: string;
  source_asset_id?: number | null;
  storage?: "cos" | "local";
  cos_url?: string;
  created_at: string;
  updated_at: string;
  raw_content?: string;
  instructions?: string;
}

export interface SkillAssetItem {
  id: number;
  skill_id: string;
  name: string;
  description: string;
  original_filename: string;
  cos_bucket: string;
  cos_key: string;
  cos_url: string;
  file_size: number;
  instructions_preview?: string;
  package_kind?: "single" | "package";
  package_file_count?: number;
  has_scripts?: boolean;
  storage: "cos" | "local";
  created_at: string;
  updated_at: string;
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
  approval_id?: number;
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
export const agentChat = (body: {
  message: string;
  conversation_id?: string;
  skill_ids?: string[];
  model?: string;
  files?: File[];
}) => {
  if (body.files?.length) {
    const form = new FormData();
    form.append("message", body.message);
    if (body.conversation_id) form.append("conversation_id", body.conversation_id);
    if (body.model) form.append("model", body.model);
    body.skill_ids?.forEach((id) => form.append("skill_ids", id));
    body.files.forEach((file) => form.append("files", file));
    return api.post<AgentChatResult>("/agent/chat/", form, { timeout: 120_000 }).then((r) => r.data);
  }
  return api.post<AgentChatResult>("/agent/chat/", body, { timeout: 120_000 }).then((r) => r.data);
};

export const getAgentModels = () =>
  api.get<{
    ok: boolean;
    chat: { value: string; title: string; kind: string }[];
    image: { value: string; title: string; kind: string }[];
  }>("/agent/models/").then((r) => r.data);

export const getAgentChatSessions = (params?: { limit?: number; username?: string }) =>
  api.get<{ count: number; results: AgentChatSession[]; is_admin?: boolean }>("/agent/sessions/", { params })
    .then((r) => r.data);

export const getAgentChatSession = (id: string) =>
  api.get<AgentChatSession>(`/agent/sessions/${id}/`).then((r) => r.data);

export const createAgentChatSession = () =>
  api.post<AgentChatSession>("/agent/sessions/", {}).then((r) => r.data);

export const deleteAgentChatSession = (id: string) =>
  api.delete(`/agent/sessions/${id}/`);

export const runSop = (body: {
  text: string;
  payload?: Record<string, unknown>;
  role?: string;
}) => api.post<SopResult>("/orchestration/run/", body).then((r) => r.data);

export const resumeSop = (body: {
  approval_id: number;
  approve?: boolean;
  approver?: string;
  comment?: string;
}) => api.post<{
  ok: boolean;
  approval_id?: number;
  status?: string;
  decision?: string;
  action?: string;
  result?: Record<string, unknown>;
  error?: string;
}>("/orchestration/resume/", body).then((r) => r.data);

export const getCatalog = () =>
  api.get<{ actions: ActionContract[] }>("/orchestration/catalog/").then((r) => r.data);

export const syncJackyun = () =>
  api.post<{
    ok: boolean;
    goods_mode?: string;
    trades_mode?: string;
    configured?: boolean;
    written?: Record<string, unknown>;
    error?: string;
  }>("/connectors/jackyun/sync/", {}, { timeout: 120_000 }).then((r) => r.data);

export const getTables = () =>
  api.get("/datalake/tables/").then((r) => r.data);
export const getMetrics = () =>
  api.get("/datalake/metrics/").then((r) => r.data);
export const getAnomalies = () =>
  api.get("/datalake/anomalies/").then((r) => r.data);

export const getAuditLogs = () =>
  api.get("/audit-logs/").then((r) => r.data);

// ================= MCP 业务系统接入 =================
export interface McpServer {
  id: string;
  name: string;
  desc: string;
  layer: string;
  transport: "streamable_http" | "sse" | "stdio";
  declared_transport?: "streamable_http" | "sse" | "stdio";
  configured: boolean;
  enabled: boolean;
  url: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  tools: string[];
  env_keys: string[];
  placeholders?: Record<string, string>;
  hints?: string[];
  config_source: "none" | "ui" | "env" | "personal";
  updated_at?: string | null;
  status: "unconfigured" | "configured" | "reachable" | "unreachable" | "error" | "disabled";
}

export interface McpServerDetail extends McpServer {
  cursor_config: { mcpServers: Record<string, unknown> };
  cursor_json: string;
  ok?: boolean;
}

export const getMcpServers = () =>
  api.get<{ count: number; results: McpServer[] }>("/mcp/servers/").then((r) => r.data);

export const getMcpServer = (id: string) =>
  api.get<McpServerDetail>(`/mcp/servers/${id}/`).then((r) => r.data);

export const saveMcpServer = (id: string, body: {
  url?: string;
  command?: string;
  args?: string[] | string;
  env?: Record<string, string> | string;
  enabled?: boolean;
  import_json?: string;
}) => api.put<McpServerDetail>(`/mcp/servers/${id}/`, body).then((r) => r.data);

export const importMcpServer = (id: string, cursor_json: string) =>
  api.post<McpServerDetail>(`/mcp/servers/${id}/import/`, { cursor_json }).then((r) => r.data);

export const probeMcpServer = (id: string) =>
  api.post<{
    ok: boolean;
    status: string;
    message: string;
    url?: string;
    transport?: string;
    note?: string;
  }>(`/mcp/servers/${id}/probe/`).then((r) => r.data);

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

// ================= 协作风控 =================
export interface CollabUserBrief {
  id: number;
  username: string;
  nickname?: string;
  display_name?: string;
  online?: boolean;
  last_seen?: string | null;
}

export interface CollabRoom {
  id: string;
  title: string;
  display_title?: string;
  room_kind?: "dm" | "group";
  status: "open" | "closed";
  risk_level: "green" | "yellow" | "red";
  summary?: string;
  created_by: CollabUserBrief;
  participants: CollabUserBrief[];
  peer_online?: boolean | null;
  online_count?: number;
  member_count?: number;
  created_at: string;
  updated_at: string;
  message_count?: number;
  insight_count?: number;
  last_message?: {
    id: number;
    content: string;
    sender: string;
    created_at: string;
  };
  messages?: CollabMessage[];
  insights?: CollabInsight[];
  unread_count?: number;
  last_read_message_id?: number;
}

export interface CollabMessage {
  id: number;
  room_id: string;
  sender: CollabUserBrief;
  content: string;
  attachments?: {
    id: string;
    name: string;
    size: number;
    mime?: string;
    is_image?: boolean;
    is_file?: boolean;
    url?: string;
  }[];
  mentions?: { type: "all" | "ai" | "user"; key: string; label: string }[];
  msg_type?: "user" | "system" | "ai";
  created_at: string;
}

export interface CollabInsight {
  id: number;
  room_id: string;
  risk_level: "green" | "yellow" | "red";
  title: string;
  analysis: string;
  advice: string;
  control: string;
  tags: string[];
  evidence_message_ids: number[];
  draft_reply: string;
  created_at: string;
}

export const listCollabRooms = (params?: { status?: string }) =>
  api.get<{ count: number; results: CollabRoom[] }>("/collab/rooms/", { params })
    .then((r) => r.data);

export const createCollabRoom = (body: {
  title?: string;
  peer_username?: string;
  peer_usernames?: string[];
  room_kind?: "dm" | "group";
}) =>
  api.post<CollabRoom>("/collab/rooms/", body).then((r) => r.data);

export const getCollabRoom = (id: string) =>
  api.get<CollabRoom>(`/collab/rooms/${id}/`).then((r) => r.data);

export const updateCollabRoom = (id: string, body: { status?: string; title?: string }) =>
  api.patch<CollabRoom>(`/collab/rooms/${id}/`, body).then((r) => r.data);

/** 删除整个协作会话 */
export const deleteCollabRoom = (id: string) =>
  api.delete<{ ok: boolean; deleted: string }>(`/collab/rooms/${id}/`).then((r) => r.data);

/** 清空聊天记录（保留会话） */
export const clearCollabMessages = (id: string) =>
  api
    .delete<{
      ok: boolean;
      cleared_messages: number;
      cleared_insights: number;
      message: CollabMessage | null;
      room: CollabRoom;
    }>(`/collab/rooms/${id}/messages/`)
    .then((r) => r.data);

/** 群聊拉人 */
export const addCollabRoomMembers = (id: string, usernames: string[]) =>
  api
    .post<{
      ok: boolean;
      added: CollabUserBrief[];
      added_count: number;
      message: CollabMessage;
      room: CollabRoom;
      error?: string;
    }>(`/collab/rooms/${id}/members/`, { usernames })
    .then((r) => r.data);

/** 群聊踢人 / 退群 */
export const removeCollabRoomMembers = (id: string, usernames: string[]) =>
  api
    .delete<{
      ok: boolean;
      removed: CollabUserBrief[];
      removed_count: number;
      message: CollabMessage;
      room: CollabRoom | null;
      left?: boolean;
      error?: string;
    }>(`/collab/rooms/${id}/members/`, { data: { usernames } })
    .then((r) => r.data);

/** 修改群内名称 */
export const updateCollabMemberNickname = (
  id: string,
  body: { username: string; nickname: string },
) =>
  api
    .patch<{
      ok: boolean;
      participant: CollabUserBrief;
      room: CollabRoom;
      message?: CollabMessage;
      error?: string;
    }>(`/collab/rooms/${id}/members/`, body)
    .then((r) => r.data);

export const listCollabMessages = (id: string, afterId = 0) =>
  api.get<{ count: number; results: CollabMessage[]; room: Partial<CollabRoom> }>(
    `/collab/rooms/${id}/messages/`,
    { params: afterId ? { after_id: afterId } : {} },
  ).then((r) => r.data);

export const sendCollabMessage = (
  id: string,
  content: string,
  analyze = true,
  files?: File[],
) => {
  if (files?.length) {
    const form = new FormData();
    form.append("content", content || "");
    form.append("analyze", analyze ? "1" : "0");
    files.forEach((file) => form.append("files", file));
    return api
      .post<{
        ok: boolean;
        message: CollabMessage;
        ai_message?: CollabMessage;
        room: CollabRoom;
        insight?: CollabInsight;
      }>(`/collab/rooms/${id}/messages/`, form, { timeout: 120_000 })
      .then((r) => r.data);
  }
  return api
    .post<{
      ok: boolean;
      message: CollabMessage;
      ai_message?: CollabMessage;
      room: CollabRoom;
      insight?: CollabInsight;
    }>(`/collab/rooms/${id}/messages/`, { content, analyze: analyze ? "1" : "0" }, { timeout: 120_000 })
    .then((r) => r.data);
};

export const listCollabInsights = (id: string, afterId = 0) =>
  api.get<{ count: number; results: CollabInsight[]; room_risk_level: string }>(
    `/collab/rooms/${id}/insights/`,
    { params: afterId ? { after_id: afterId } : {} },
  ).then((r) => r.data);

export const refreshCollabInsights = (id: string) =>
  api.post<{ ok: boolean; insight: CollabInsight; room: CollabRoom }>(
    `/collab/rooms/${id}/insights/`,
    {},
  ).then((r) => r.data);

export const listCollabUsers = (q?: string) =>
  api.get<{ count: number; results: CollabUserBrief[] }>("/collab/users/", {
    params: q ? { q } : {},
  }).then((r) => r.data);

/** 维持当前用户在线 */
export const collabPresenceHeartbeat = () =>
  api
    .post<{ ok: boolean; online: boolean; last_seen: string; window_seconds: number }>(
      "/collab/presence/",
      {},
    )
    .then((r) => r.data);

/** 查询一批用户在线状态（同时刷新自己心跳） */
export const collabPresenceQuery = (userIds: number[]) =>
  api
    .get<{
      ok: boolean;
      me: { id: number; online: boolean; last_seen: string };
      users: Record<string, { online: boolean; last_seen: string | null }>;
    }>("/collab/presence/", {
      params: { user_ids: userIds.join(",") },
    })
    .then((r) => r.data);

export type CollabUnreadItem = {
  room_id: string;
  title: string;
  room_kind?: "dm" | "group";
  unread_count: number;
  last_message?: {
    id: number;
    content: string;
    sender: string;
    created_at: string;
  };
  updated_at: string;
  risk_level?: string;
};

/** 未读协作消息汇总（顶栏铃铛） */
export const getCollabUnread = () =>
  api
    .get<{
      ok: boolean;
      total_unread: number;
      count: number;
      results: CollabUnreadItem[];
    }>("/collab/unread/")
    .then((r) => r.data);

/** 标记会话已读 */
export const markCollabRoomRead = (id: string, upToId?: number) =>
  api
    .post<{ ok: boolean; last_read_message_id: number; unread_count: number; room_id: string }>(
      `/collab/rooms/${id}/read/`,
      upToId ? { up_to_id: upToId } : {},
    )
    .then((r) => r.data);

