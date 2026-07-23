import axios from "axios";
import type { AxiosProgressEvent } from "axios";

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");

export const api = axios.create({
  baseURL: configuredApiBaseUrl || "/api",
  timeout: 20000,
});

const TOKEN_KEY = "liangce_auth_token";
export const LOGIN_NOTICE_KEY = "liangce_login_notice";

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
      const notice = String(err?.response?.data?.detail || "").trim();
      if (notice) {
        sessionStorage.setItem(LOGIN_NOTICE_KEY, notice);
      }
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
  display_name?: string;
  bio?: string;
  methodology?: string;
  avatar_url?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  /** 是否可进入账号管理：平台管理员，或任一企业的所有者/管理员 */
  can_manage_accounts?: boolean;
  organization?: {
    id: number;
    name: string;
    role: "owner" | "admin" | "member";
    roleLabel: string;
    canManage: boolean;
  } | null;
  /** 当前账号真实加入且可切换的企业；不包含仅因平台管理权限而可管理的主体。 */
  organizations?: OrganizationSummary[];
}

export const login = (body: { username: string; password: string }) =>
  api.post<{ ok: boolean; token: string; user: AuthUser; error?: string }>("/auth/login/", body)
    .then((r) => r.data);

export const register = (body: { username: string; password: string; email?: string }) =>
  api.post<{ ok: boolean; token: string; user: AuthUser; error?: string }>("/auth/register/", body)
    .then((r) => r.data);

export const logout = () => api.post("/auth/logout/").then((r) => r.data);

export const getMe = () =>
  api.get<{
    ok: boolean;
    user: AuthUser;
    settings: {
      llm_configured: boolean;
      display_name?: string;
      bio?: string;
      methodology?: string;
      avatar_url?: string;
    };
  }>("/auth/me/").then((r) => r.data);

export const changePassword = (body: { old_password: string; new_password: string }) =>
  api.post<{ ok: boolean; token: string; user: AuthUser; error?: string }>("/auth/password/", body)
    .then((r) => r.data);

export interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  has_usable_password: boolean;
  date_joined: string | null;
  last_login: string | null;
  phone_masked: string;
  organization_id: number | null;
  organization_name: string;
  organization_role: "owner" | "admin" | "member" | "";
  organizations: Array<{
    id: number;
    name: string;
    role: "owner" | "admin" | "member";
    roleLabel: string;
    isCurrent: boolean;
  }>;
}

export interface OrganizationMember {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  role: "owner" | "admin" | "member";
  roleLabel: string;
  isActive: boolean;
  canRemove: boolean;
}

export interface OrganizationSummary {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  memberCount: number;
  role: "owner" | "admin" | "member" | "";
  canManage: boolean;
  isCurrent: boolean;
  canSwitch: boolean;
  createdAt: string | null;
}

export const getCurrentOrganization = (organizationId?: number) =>
  api.get<{ ok: boolean; organization: OrganizationSummary; members: OrganizationMember[] }>(
    "/auth/organization/",
    { params: organizationId ? { organizationId } : {} },
  ).then((r) => r.data);
export const switchCurrentOrganization = (organizationId: number) =>
  api.post<{ ok: boolean; organization: OrganizationSummary; user: AuthUser }>(
    "/auth/organization/switch/",
    { organizationId },
  ).then((r) => r.data);
export const updateCurrentOrganization = (name: string, organizationId?: number) =>
  api.patch<{ ok: boolean; organization: OrganizationSummary; members: OrganizationMember[] }>(
    "/auth/organization/",
    { name, organizationId },
  ).then((r) => r.data);
export const transferOrganizationOwnership = (targetUserId: number, organizationId?: number) =>
  api.post<{
    ok: boolean;
    organization: OrganizationSummary;
    previousOwner: { id: number; username: string; role: "admin" };
    newOwner: { id: number; username: string; role: "owner" };
    transferredAt: string;
  }>("/auth/organization/transfer-ownership/", { targetUserId, organizationId }).then((r) => r.data);
export const removeOrganizationMember = (userId: number, organizationId?: number) =>
  api.delete<{
    ok: boolean;
    organization: OrganizationSummary;
    removedUser: { id: number; username: string };
  }>(`/auth/organization/members/${userId}/`, { params: organizationId ? { organizationId } : {} }).then((r) => r.data);
export const createOrganization = (body: { name: string; ownerUserId: number }) =>
  api.post<{
    ok: boolean;
    organization: OrganizationSummary;
    owner: { id: number; username: string; role: "owner" };
  }>("/auth/admin/organizations/", body).then((r) => r.data);
export const listOrganizations = () =>
  api.get<{ ok: boolean; count: number; results: OrganizationSummary[] }>(
    "/auth/admin/organizations/",
  ).then((r) => r.data);
export const assignUsersToOrganization = (body: {
  organizationId: number;
  userIds: number[];
  role: "admin" | "member";
}) =>
  api.post<{
    ok: boolean;
    organization: OrganizationSummary;
    assignedCount: number;
    assignedUsers: Array<{ id: number; username: string; role: "admin" | "member"; isCurrent: boolean }>;
    skippedCount: number;
    skippedUsers: Array<{ id: number; username: string }>;
  }>("/auth/admin/organizations/assign-users/", body).then((r) => r.data);

export type TeamKind = "platform" | "enterprise";

export interface TeamMemberRow {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  role: "lead" | "member";
  roleLabel: string;
  isActive: boolean;
  wecomBound: boolean;
}

export interface TeamSummary {
  id: number;
  name: string;
  kind: TeamKind;
  kindLabel: string;
  description: string;
  organizationId: number | null;
  organizationName: string;
  isActive: boolean;
  memberCount: number;
  pendingWecomCount: number;
  canManage: boolean;
  createdAt: string | null;
  members: TeamMemberRow[];
}

export interface TeamUserOption {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  wecomBound: boolean;
}

export const listTeams = (kind?: TeamKind) =>
  api.get<{ ok: boolean; count: number; results: TeamSummary[] }>("/auth/teams/", {
    params: kind ? { kind } : {},
  }).then((r) => r.data);

export const createTeam = (body: {
  name: string;
  kind: TeamKind;
  description?: string;
  organizationId?: number;
  memberIds?: number[];
}) =>
  api.post<{ ok: boolean; team: TeamSummary; error?: string }>("/auth/teams/", body).then((r) => r.data);

export const updateTeam = (
  id: number,
  body: { name?: string; description?: string; isActive?: boolean },
) =>
  api.patch<{ ok: boolean; team: TeamSummary; error?: string }>(`/auth/teams/${id}/`, body).then((r) => r.data);

export const deleteTeam = (id: number) =>
  api.delete<{ ok: boolean; deleted: string }>(`/auth/teams/${id}/`).then((r) => r.data);

export const addTeamMembers = (id: number, body: { userIds: number[]; role?: "lead" | "member" }) =>
  api.post<{ ok: boolean; addedCount: number; team: TeamSummary }>(`/auth/teams/${id}/members/`, body).then((r) => r.data);

export const removeTeamMember = (id: number, userId: number) =>
  api.delete<{ ok: boolean; removedUserId: number; team: TeamSummary }>(`/auth/teams/${id}/members/${userId}/`).then((r) => r.data);

export const listTeamUserOptions = (params: { kind: TeamKind; organizationId?: number }) =>
  api.get<{ ok: boolean; count: number; results: TeamUserOption[] }>("/auth/teams/user-options/", {
    params: params.organizationId ? { kind: params.kind, organizationId: params.organizationId } : { kind: params.kind },
  }).then((r) => r.data);

export const listAdminUsers = (q?: string, organizationId?: number) =>
  api.get<{ ok: boolean; count: number; organization?: OrganizationSummary | null; results: AdminUserRow[] }>("/auth/admin/users/", {
    params: { ...(q ? { q } : {}), ...(organizationId ? { organizationId } : {}) },
  }).then((r) => r.data);

export const createAdminUser = (body: {
  username: string;
  password: string;
  email?: string;
  display_name?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  platform_role?: "user" | "staff" | "superuser";
  phone?: string;
  organization_id?: number;
  organization_role?: "owner" | "admin" | "member";
  organizations?: Array<{ id: number; role: "owner" | "admin" | "member" }>;
}) =>
  api.post<{ ok: boolean; user: AdminUserRow; password_once?: string; error?: string }>(
    "/auth/admin/users/",
    body,
  ).then((r) => r.data);

export const updateAdminUser = (
  id: number,
  body: {
    password?: string;
    email?: string;
    display_name?: string;
    is_active?: boolean;
    is_staff?: boolean;
    is_superuser?: boolean;
    platform_role?: "user" | "staff" | "superuser";
    phone?: string;
    organization_id?: number;
    organization_role?: "owner" | "admin" | "member";
    organizations?: Array<{ id: number; role: "owner" | "admin" | "member" }>;
  },
) =>
  api.patch<{ ok: boolean; user: AdminUserRow; password_once?: string; error?: string }>(
    `/auth/admin/users/${id}/`,
    body,
  ).then((r) => r.data);

export const deleteAdminUser = (id: number) =>
  api.delete<{
    ok: boolean;
    deletedUser: { id: number; username: string };
  }>(`/auth/admin/users/${id}/`).then((r) => r.data);

export type WeComBindingStatus = "pending" | "matched" | "not_found" | "invalid_phone" | "duplicate_phone" | "conflict" | "permission_denied" | "retry_waiting" | "disabled";

export interface UserWeComBindingSummary {
  status: WeComBindingStatus;
  statusLabel: string;
  weComUserId: string;
  weComMember: string;
  wecomContactId?: number | null;
  failureReason: string;
  statusHint?: string;
}

export interface UserProfileSettings {
  display_name: string;
  bio: string;
  methodology: string;
  avatar: string;
  avatar_url: string;
  llm_api_key: string;
  llm_base_url: string;
  llm_model: string;
  configured: boolean;
  phone_masked?: string;
  wecom_binding?: UserWeComBindingSummary;
}

export interface WeComBindingRow {
  id: number;
  platformUserId: number;
  platformUser: string;
  platformAvatar: string;
  phoneMasked: string;
  weComUserId: string;
  weComMember: string;
  weComAvatar: string;
  weComDepartment: string;
  weComPosition: string;
  weComAvailable: boolean | null;
  status: WeComBindingStatus;
  statusLabel: string;
  source: string;
  sourceLabel: string;
  matchedAt: string | null;
  verifiedAt: string | null;
  nextRetryAt: string | null;
  failureReason: string;
  retry_count: number;
}

export interface WeComBindingSyncJob {
  id: number;
  status: string;
  source: string;
  scanned_count: number;
  matched_count: number;
  not_found_count: number;
  invalid_phone_count: number;
  duplicate_phone_count: number;
  conflict_count: number;
  permission_denied_count: number;
  retry_waiting_count: number;
  created_at: string;
  finished_at: string | null;
}

export const listWeComBindings = (params?: { q?: string; status?: string; page?: number; page_size?: number }) =>
  api.get<{ ok: boolean; count: number; results: WeComBindingRow[] }>("/wecom/bindings/", { params }).then((r) => r.data);
export const syncWeComBindings = () =>
  api.post<{ ok: boolean; job: WeComBindingSyncJob }>("/wecom/bindings/sync/", {}).then((r) => r.data);
export const matchWeComBinding = (userId: number) =>
  api.post<{ ok: boolean; binding: WeComBindingRow }>(`/wecom/bindings/${userId}/match/`, {}).then((r) => r.data);
export const manualWeComBinding = (platformUserId: number, weComUserId: string) =>
  api.post<{ ok: boolean; binding: WeComBindingRow }>("/wecom/bindings/manual/", { platformUserId, weComUserId }).then((r) => r.data);
export const deleteWeComBinding = (bindingId: number) =>
  api.delete<{ ok: boolean }>(`/wecom/bindings/${bindingId}/`).then((r) => r.data);
export const listWeComBindingJobs = () =>
  api.get<{ ok: boolean; results: WeComBindingSyncJob[] }>("/wecom/bindings/sync-jobs/").then((r) => r.data);
export const listWeComBindingLogs = (bindingId: number) =>
  api.get<{ ok: boolean; results: Array<{ id: number; action: string; status: string; message: string; actorName: string; created_at: string }> }>(`/wecom/bindings/${bindingId}/logs/`).then((r) => r.data);

/** @deprecated ?? UserProfileSettings */
export type UserLlmSettings = UserProfileSettings;

export const getUserSettings = () =>
  api.get<UserProfileSettings>("/auth/settings/").then((r) => r.data);

export const updateUserSettings = (
  body: Partial<Omit<UserProfileSettings, "avatar" | "avatar_url" | "configured" | "wecom_binding">> & {
    phone?: string;
  },
) =>
  api.put<{
    ok: boolean;
    configured: boolean;
    wecom_sync_triggered?: boolean;
    phone_masked?: string;
    wecom_binding?: UserWeComBindingSummary;
    user?: AuthUser;
    display_name?: string;
    bio?: string;
    methodology?: string;
    avatar_url?: string;
  }>("/auth/settings/", body).then((r) => r.data);

export const uploadUserAvatar = (file: File, userId?: number) => {
  const form = new FormData();
  form.append("file", file);
  if (userId) form.append("user_id", String(userId));
  return api
    .post<{
      ok: boolean;
      avatar: string;
      avatar_url: string;
      user?: AuthUser | null;
      admin_user?: AdminUserRow | null;
    }>(
      "/auth/avatar/",
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    )
    .then((r) => r.data);
};

// ================= Knowledge Center =================
export type KnowledgeBaseStatus = "draft" | "processing" | "ready" | "review" | "archived";
export type KnowledgeFileStatus = "uploaded" | "processing" | "ready" | "review" | "failed" | "archived";

export interface KnowledgeBaseItem {
  id: number;
  template: number | null;
  owner_username?: string;
  owner_user_id?: number | null;
  can_edit?: boolean;
  team_ids?: number[];
  teamIds?: number[];
  name: string;
  description: string;
  category: string;
  icon: string;
  tags: string[];
  visibility: "private" | "team" | "company";
  retrieval_mode: "naive-rag" | "graph-rag" | "hybrid-rag";
  review_policy: string;
  status: KnowledgeBaseStatus;
  config: Record<string, unknown>;
  file_count: number;
  app_count: number;
  recall_count: number;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export interface KnowledgeFileItem {
  id: number;
  knowledge_base: number;
  uploaded_by_username?: string;
  original_filename: string;
  file_type: string;
  segment_mode: string;
  char_count: number;
  chunk_count: number;
  recall_count: number;
  status: KnowledgeFileStatus;
  storage_path: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  uploaded_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export interface KnowledgeIngestJobItem {
  id: number;
  file: number;
  status: "pending" | "parsing" | "chunking" | "embedding" | "graphing" | "ready" | "failed";
  stage: string;
  progress: number;
  error: Record<string, unknown> | null;
  metrics: Record<string, unknown>;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
}
export interface KnowledgeChunkItem {
  id: number;
  file: number;
  chunk_index: number;
  chunk_ref: string;
  text_preview: string;
  embedding_ref: string;
  graph_entity_ref: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const listKnowledgeBases = (params?: { q?: string; category?: string; visibility?: string }) =>
  api.get<KnowledgeBaseItem[] | { count?: number; results: KnowledgeBaseItem[] }>("/knowledge/bases/", { params })
    .then((r) => Array.isArray(r.data) ? r.data : r.data.results);

export const createKnowledgeBase = (body: Partial<KnowledgeBaseItem>) =>
  api.post<KnowledgeBaseItem>("/knowledge/bases/", body).then((r) => r.data);

export const updateKnowledgeBase = (id: number, body: Partial<KnowledgeBaseItem>) =>
  api.patch<KnowledgeBaseItem>(`/knowledge/bases/${id}/`, body).then((r) => r.data);

export const deleteKnowledgeBase = (id: number) =>
  api.delete(`/knowledge/bases/${id}/`);

export const listKnowledgeFiles = (knowledgeBaseId: number, params?: { q?: string; file_type?: string }) =>
  api.get<{ knowledge_base: KnowledgeBaseItem; count: number; results: KnowledgeFileItem[] }>(
    `/knowledge/bases/${knowledgeBaseId}/files/`,
    { params },
  ).then((r) => r.data);

export const uploadKnowledgeFile = (
  knowledgeBaseId: number,
  file: File,
  body?: {
    segment_mode?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    /** upload = ?????smart_doc / mindmap = ?????? */
    asset_role?: "upload" | "smart_doc" | "mindmap";
    onUploadProgress?: (event: AxiosProgressEvent) => void;
  },
) => {
  const form = new FormData();
  form.append("file", file);
  if (body?.segment_mode) form.append("segment_mode", body.segment_mode);
  if (body?.chunk_size) form.append("chunk_size", String(body.chunk_size));
  if (body?.chunk_overlap !== undefined) form.append("chunk_overlap", String(body.chunk_overlap));
  form.append("asset_role", body?.asset_role || "upload");
  return api.post<{
    file: KnowledgeFileItem;
    job: KnowledgeIngestJobItem;
    chunk_count: number;
    job_id: number;
    chunks_preview: KnowledgeChunkItem[];
  }>(`/knowledge/bases/${knowledgeBaseId}/upload/`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60_000,
    onUploadProgress: body?.onUploadProgress,
  }).then((r) => r.data);
};

export const getKnowledgeJob = (jobId: number) =>
  api.get<KnowledgeIngestJobItem>(`/knowledge/jobs/${jobId}/`).then((r) => r.data);
export const getKnowledgeFileChunks = (fileId: number, params?: { page?: number; page_size?: number }) =>
  api.get<{ file: KnowledgeFileItem; count: number; page: number; page_size: number; results: KnowledgeChunkItem[] }>(`/knowledge/files/${fileId}/chunks/`, { params })
    .then((r) => r.data);

export const downloadKnowledgeFile = (fileId: number) =>
  api.get<Blob>(`/knowledge/files/${fileId}/download/`, { responseType: "blob" }).then((r) => r.data);

export const getKnowledgeFileContent = (fileId: number) =>
  api.get<{ content: string; encoding?: string; file: KnowledgeFileItem }>(`/knowledge/files/${fileId}/content/`)
    .then((r) => r.data);

export const saveKnowledgeFileContent = (
  fileId: number,
  body: { content: string; title?: string; reingest?: boolean },
) =>
  api.put<{
    ok: boolean;
    content: string;
    file: KnowledgeFileItem;
    job?: KnowledgeIngestJobItem;
    job_id?: number;
  }>(`/knowledge/files/${fileId}/content/`, body).then((r) => r.data);

export const deleteKnowledgeFile = (fileId: number) =>
  api.delete(`/knowledge/files/${fileId}/`);

export const deleteKnowledgeChunk = (fileId: number, chunkId: number) =>
  api.delete<{ deleted: boolean; chunk_id: number }>(`/knowledge/files/${fileId}/chunks/${chunkId}/`)
    .then((r) => r.data);

export const searchKnowledge = (params: { q: string; knowledge_base?: number; mode?: "keyword" | "semantic" | "hybrid"; limit?: number }) =>
  api.get<{ query: string; mode?: string; count: number; results: KnowledgeChunkItem[] }>("/knowledge/traditional-search/", { params })
    .then((r) => r.data);

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

export const uploadSkillAsset = (
  file: File,
  adopt = true,
  category: SkillAssetCategory = "general",
  onUploadProgress?: (event: AxiosProgressEvent) => void,
) => {
  const form = new FormData();
  form.append("file", file);
  form.append("category", category);
  if (adopt) form.append("adopt", "1");
  return api.post<{ ok: boolean; asset: SkillAssetItem; adopted?: boolean; personal?: UserSkillItem }>("/skills/assets/upload/", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180_000,
    onUploadProgress,
  }).then((r) => r.data);
};

export const uploadSkillAssetFolder = (
  files: File[],
  adopt = true,
  category: SkillAssetCategory = "general",
  onUploadProgress?: (event: AxiosProgressEvent) => void,
) => {
  const form = new FormData();
  files.forEach((file) => {
    form.append("files", file, file.name);
    form.append("paths", file.webkitRelativePath || file.name);
  });
  form.append("category", category);
  if (adopt) form.append("adopt", "1");
  return api.post<{ ok: boolean; asset: SkillAssetItem; adopted?: boolean; personal?: UserSkillItem }>("/skills/assets/upload/", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180_000,
    onUploadProgress,
  }).then((r) => r.data);
};

export const createSkillAsset = (body: {
  skill_id: string;
  name: string;
  description: string;
  instructions: string;
  category: SkillAssetCategory;
  adopt?: boolean;
}) => {
  const safeName = body.name.replace(/[\r\n]+/g, " ").replace(/"/g, "'").trim();
  const safeDescription = body.description.replace(/[\r\n]+/g, " ").replace(/"/g, "'").trim();
  const content = `---\nname: "${safeName}"\ndescription: "${safeDescription}"\n---\n\n${body.instructions.trim()}\n`;
  const form = new FormData();
  form.append("filename", "SKILL.md");
  form.append("skill_id", body.skill_id);
  form.append("content", content);
  form.append("category", body.category);
  if (body.adopt !== false) form.append("adopt", "1");
  return api.post<{ ok: boolean; asset: SkillAssetItem; adopted?: boolean; personal?: UserSkillItem }>("/skills/assets/upload/", form, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};

export const searchSkillHub = (params: {
  q?: string;
  page?: number;
  page_size?: number;
  sort_by?: SkillHubSortKey;
  source?: SkillHubSourceFilter;
  category?: SkillHubCategoryFilter;
  api_key?: SkillHubApiKeyFilter;
}) =>
  api.get<SkillHubSearchResponse>("/skills/skillhub/search/", { params }).then((r) => r.data);

export const getSkillHubDetail = (slug: string) =>
  api.get<{ ok: boolean; skill: SkillHubSkillItem }>(`/skills/skillhub/${encodeURIComponent(slug)}/`)
    .then((r) => r.data);

export const importSkillHubSkill = (body: { slug: string; version?: string; category: SkillAssetCategory; adopt?: boolean }) =>
  api.post<{ ok: boolean; asset: SkillAssetItem; personal?: UserSkillItem; adopted: boolean; verification: { verified: boolean; status: string } }>(
    "/skills/skillhub/import/",
    { adopt: true, ...body },
    { timeout: 60_000 },
  ).then((r) => r.data);

export const getSkillAssets = () =>
  api.get<{ count: number; results: SkillAssetItem[]; cos_enabled: boolean }>("/skills/assets/")
    .then((r) => r.data);

export const getSkillAnalytics = (params?: { trend_start?: string; trend_end?: string }) =>
  api.get<SkillAnalyticsResponse>("/skills/analytics/", { params }).then((r) => r.data);

export const getSkillAssetUsage = (assetId: number, params?: { page?: number; page_size?: number }) =>
  api.get<SkillUsageHistoryResponse>(`/skills/assets/id/${assetId}/usage/`, { params }).then((r) => r.data);

export const updateSkillAssetOwner = (assetId: number, ownerId: number | null) =>
  api.patch<{ ok: boolean; asset: SkillAssetItem }>(`/skills/assets/id/${assetId}/owner/`, {
    owner_id: ownerId,
  }).then((r) => r.data);

export const updateSkillAssetCategory = (assetId: number, category: SkillAssetCategory) =>
  api.patch<{ ok: boolean; asset: SkillAssetItem }>(`/skills/assets/id/${assetId}/category/`, {
    category,
  }).then((r) => r.data);

export const updateSkillAssetVisibility = (assetId: number, visibility: "shared" | "private") =>
  api.patch<{ ok: boolean; asset: SkillAssetItem; revoked_count: number }>(`/skills/assets/id/${assetId}/visibility/`, {
    visibility,
  }).then((r) => r.data);

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

// ================= Agent Context / Memory =================
export interface AgentMemoryItem {
  id: number;
  scope: "user" | "session" | string;
  session_id?: string | null;
  kind: "fact" | "preference" | "summary" | string;
  content: string;
  source: string;
  importance: number;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AgentSessionSummary {
  id: number;
  session_key: string;
  summary: string;
  message_count: number;
  created_at?: string;
  updated_at?: string;
}

export const getAgentMemories = (params?: { scope?: string; kind?: string }) =>
  api.get<{ count: number; results: AgentMemoryItem[] }>("/agentctx/memories/", { params })
    .then((r) => r.data);

export const createAgentMemory = (body: Partial<AgentMemoryItem> & { content: string }) =>
  api.post<{ ok: boolean; item: AgentMemoryItem }>("/agentctx/memories/", body)
    .then((r) => r.data);

export const updateAgentMemory = (id: number, body: Partial<AgentMemoryItem>) =>
  api.patch<{ ok: boolean; item: AgentMemoryItem }>(`/agentctx/memories/${id}/`, body)
    .then((r) => r.data);

export const deleteAgentMemory = (id: number) =>
  api.delete(`/agentctx/memories/${id}/`);

export const getAgentSummaries = (params?: { session_key?: string }) =>
  api.get<{ count: number; results: AgentSessionSummary[] }>("/agentctx/summaries/", { params })
    .then((r) => r.data);

export const deleteAgentSummary = (id: number) =>
  api.delete(`/agentctx/summaries/${id}/`);

export const deleteAgentSummaryByKey = (session_key: string) =>
  api.delete(`/agentctx/summaries/by-key/`, { params: { session_key } });

export const getAgentDebugPack = (params?: { q?: string; session_key?: string }) =>
  api.get<{
    query: string;
    session_key: string;
    memory_block: string;
    summary_block: string;
    items: AgentMemoryItem[];
    summary: AgentSessionSummary | null;
  }>("/agentctx/debug-pack/", { params }).then((r) => r.data);

/** ?? DB ?? */
const dbImportTimeout = { timeout: 300_000 };
/** LightRAG / AGE ????? */
const ageImportTimeout = { timeout: 900_000 };

// ---- ???? ----
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
    lightrag?: { source_id?: string; source_name?: string; workspace?: string; mode?: string }[];
    lightrag_status?: { mode?: string; error?: string; degraded_sources?: string[] };
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
  nas_files?: {
    name: string;
    path: string;
    native_path: string;
    size: number;
    download_url: string;
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
  owner_id?: number | null;
  owner?: string;
}

export type SkillAssetCategory = "business" | "analysis" | "content" | "automation" | "general";
export type SkillHubSortKey = "score" | "curated_score" | "rank" | "downloads" | "stars" | "updated_at";
export type SkillHubSourceFilter = "" | "clawhub" | "community";
export type SkillHubApiKeyFilter = "" | "required" | "not_required";
export type SkillHubCategoryFilter = ""
  | "office-efficiency"
  | "content-creation"
  | "dev-programming"
  | "data-analysis"
  | "design-media"
  | "ai-agent"
  | "knowledge-management"
  | "business-ops"
  | "education"
  | "professional"
  | "it-ops-security"
  | "life-service";

export interface SkillHubSecurityReport {
  status: string;
  status_text: string;
  report_url: string;
}

export interface SkillHubSkillItem {
  slug: string;
  name: string;
  description: string;
  version: string;
  category: string;
  sub_categories: Array<{ key: string; name: string }>;
  owner: string;
  source: string;
  source_url: string;
  icon_url: string;
  downloads: number;
  stars: number;
  score: number;
  verified: boolean;
  requires_api_key: boolean;
  detail_url: string;
  security_reports?: Record<string, SkillHubSecurityReport>;
  changelog?: string;
}

export interface SkillHubSearchResponse {
  ok: boolean;
  keyword: string;
  page: number;
  page_size: number;
  total: number;
  results: SkillHubSkillItem[];
}

export interface SkillAssetItem {
  id: number;
  skill_id: string;
  source: "upload" | "skillhub";
  source_url: string;
  source_version: string;
  source_verified: boolean;
  source_metadata?: Record<string, unknown>;
  content_hash?: string;
  category: SkillAssetCategory;
  visibility: "shared" | "private";
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
  uploader?: string;
  is_uploader?: boolean;
  owner_id?: number | null;
  owner?: string;
  created_at: string;
  updated_at: string;
}

export interface SkillAnalyticsSummary {
  total_skills: number;
  total_invocations: number;
  invocations_30d: number;
  active_skills_30d: number;
  utilization_rate: number;
  shared_skills: number;
  shared_adoptions: number;
  owner_count: number;
  responsibility_coverage: number;
}

export interface SkillAnalyticsRow {
  asset_id: number;
  skill_id: string;
  name: string;
  description: string;
  visibility: "shared" | "private";
  owner_id: number | null;
  owner: string;
  owner_avatar_url: string;
  owner_team: string;
  uploader: string;
  is_uploader: boolean;
  adoption_count: number;
  enabled_count: number;
  usage_count_30d: number;
  unique_users_30d: number;
  last_used_at: string | null;
  last_used_by: string;
  last_source: string;
  recent_usage: SkillUsageEventItem[];
  updated_at: string;
}

export interface SkillUsageEventItem {
  id: number;
  skill_id: string;
  skill_name: string;
  user_id: number | null;
  user: string;
  avatar_url: string;
  source: "agent" | "collab" | "direct";
  source_label: string;
  used_at: string;
}

export interface SkillUsageHistoryResponse {
  ok: boolean;
  asset: { id: number; skill_id: string; name: string };
  page: number;
  page_size: number;
  count: number;
  results: SkillUsageEventItem[];
}

export interface SkillPeopleRankingItem {
  user_id: number;
  user: string;
  avatar_url: string;
  team: string;
  usage_count_30d: number;
  skill_count_30d: number;
  last_used_at: string | null;
}

export interface SkillTrendPoint {
  date: string;
  label: string;
  count: number;
  unique_users: number;
  active_skills: number;
}

export interface SkillTrendSeries {
  points: SkillTrendPoint[];
  total: number;
  unique_users: number;
  active_skills: number;
  daily_average: number;
  peak_date: string | null;
  peak_label: string;
  peak_count: number;
}

export interface SkillAnalyticsResponse {
  scope_label: string;
  can_manage: boolean;
  summary: SkillAnalyticsSummary;
  skills: SkillAnalyticsRow[];
  ranking: SkillAnalyticsRow[];
  people_ranking: SkillPeopleRankingItem[];
  trend: SkillTrendPoint[];
  trend_range: { start: string; end: string; days: number };
  trend_by_category: Record<string, SkillTrendSeries>;
  recent_usage: SkillUsageEventItem[];
  owner_options: Array<{ id: number; name: string; username: string; avatar_url: string }>;
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
  executor?: Agent;
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

export interface TaskTemplateItem {
  id?: number;
  key: string;
  name: string;
  description: string;
  category: "report" | "operation" | "analysis" | "collab";
  actionName: string;
  prompt: string;
  defaults: Record<string, unknown>;
  outputConfig: Record<string, unknown>;
  assignmentConfig: Record<string, unknown>;
  tags: string[];
  estimatedMinutes: number;
  visibility: "personal" | "workspace";
  builtin: boolean;
  overridden: boolean;
  canReset: boolean;
  canEdit: boolean;
  createdBy?: string | null;
  updatedAt?: string | null;
}

// ---- API ?? ----
export const agentChat = (body: {
  message: string;
  conversation_id?: string;
  skill_ids?: string[];
  model?: string;
  knowledge_mode?: "auto" | "none" | "selected" | string;
  lightrag_mode?: "local" | "global" | "hybrid" | "mix" | "naive" | "bypass" | string;
  knowledge_base_ids?: number[];
  files?: File[];
}) => {
  if (body.files?.length) {
    const form = new FormData();
    form.append("message", body.message);
    if (body.conversation_id) form.append("conversation_id", body.conversation_id);
    if (body.model) form.append("model", body.model);
    if (body.knowledge_mode) form.append("knowledge_mode", body.knowledge_mode);
    if (body.lightrag_mode) form.append("lightrag_mode", body.lightrag_mode);
    body.knowledge_base_ids?.forEach((id) => form.append("knowledge_base_ids", String(id)));
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
  agent_id?: number;
  trace_id?: string;
  mode?: "task_create";
}) => api.post<SopResult>("/orchestration/run/", body, {
  // 经营分析需要读取可信快照并等待模型生成，不能沿用普通 API 的 20 秒超时。
  timeout: 180_000,
}).then((r) => r.data);

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

export const listTaskTemplates = () =>
  api.get<{ results: TaskTemplateItem[] }>("/task-templates/").then((r) => r.data);

export const getTaskTemplate = (key: string) =>
  api.get<TaskTemplateItem>(`/task-templates/${key}/`).then((r) => r.data);

export const createTaskTemplate = (body: Partial<TaskTemplateItem>) =>
  api.post<TaskTemplateItem>("/task-templates/", body).then((r) => r.data);

export const updateTaskTemplate = (key: string, body: Partial<TaskTemplateItem>) =>
  api.patch<TaskTemplateItem>(`/task-templates/${key}/`, body).then((r) => r.data);

export const deleteTaskTemplate = (key: string) =>
  api.delete(`/task-templates/${key}/`);

export const duplicateTaskTemplate = (key: string) =>
  api.post<TaskTemplateItem>(`/task-templates/${key}/duplicate/`, {}).then((r) => r.data);

export interface SopGraphNode {
  key: string;
  type: "collect_info" | "checkpoint" | "execute_action" | "gate" | "handoff" | "end" | "knowledge_query" | "data_bind";
  title: string;
  config: Record<string, unknown>;
}

export interface SopNodeDataBindings {
  snapshot_ids: number[];
  metric_ids: string[];
  asset_keys: string[];
  scope: string;
  brand_ids: string[];
}

export interface SopNodeKnowledgeScope {
  knowledge_base_ids: number[];
  retrieval_hint: string;
}

export interface SopGraphEdge {
  source: string;
  target: string;
  condition: string;
  priority: number;
}

export interface SopGraphLayout {
  [nodeKey: string]: { x: number; y: number };
}

export interface SopGraphMeta {
  goal?: string[];
  required_info?: string[];
  layout?: SopGraphLayout;
  slot_filling_policy?: Record<string, unknown>;
}

export interface SopVersionItem {
  id: number;
  version: string;
  status: "draft" | "published" | "retired";
  graph: {
    start: string;
    terminals: string[];
    nodes: SopGraphNode[];
    edges: SopGraphEdge[];
    meta?: SopGraphMeta;
  };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  triggerIntents: string[];
  utteranceExamples: string[];
  contentHash: string;
  changeSummary: string;
  publishedAt?: string | null;
  createdAt: string;
}

export interface SopDefinitionItem {
  id: number;
  key: string;
  name: string;
  businessDomain: string;
  description: string;
  actionName: string;
  status: "draft" | "published" | "archived";
  currentVersion: string;
  system: boolean;
  canEdit: boolean;
  hasDraft: boolean;
  draftVersion: string | null;
  callCount: number;
  successRate: number;
  nodeCount: number;
  updatedAt: string;
  version?: SopVersionItem;
}

export const listSops = () =>
  api.get<{ results: SopDefinitionItem[] }>("/orchestration/sops/").then((r) => r.data);

export const getSop = (key: string) =>
  api.get<SopDefinitionItem>(`/orchestration/sops/${key}/`).then((r) => r.data);

export const createSop = (body: Record<string, unknown>) =>
  api.post<SopDefinitionItem>("/orchestration/sops/", body).then((r) => r.data);

export const updateSop = (key: string, body: Record<string, unknown>) =>
  api.patch<SopDefinitionItem>(`/orchestration/sops/${key}/`, body).then((r) => r.data);

export const duplicateSop = (key: string, body: { key?: string; name?: string } = {}) =>
  api.post<SopDefinitionItem>(`/orchestration/sops/${key}/duplicate/`, body).then((r) => r.data);

export const createSopVersion = (key: string, body: Record<string, unknown>) =>
  api.post<SopVersionItem>(`/orchestration/sops/${key}/versions/`, body).then((r) => r.data);

export const listSopVersions = (key: string) =>
  api.get<{ results: SopVersionItem[] }>(`/orchestration/sops/${key}/versions/`).then((r) => r.data);

export const getSopVersion = (key: string, version: string) =>
  api.get<SopVersionItem>(`/orchestration/sops/${key}/versions/${version}/`).then((r) => r.data);

export const updateSopVersion = (key: string, version: string, body: Record<string, unknown>) =>
  api.patch<SopVersionItem>(`/orchestration/sops/${key}/versions/${version}/`, body).then((r) => r.data);

export const publishSopVersion = (key: string, version: string) =>
  api.post<SopDefinitionItem>(`/orchestration/sops/${key}/versions/${version}/publish/`, {}).then((r) => r.data);

export interface SopDraftPayload {
  key: string;
  name: string;
  businessDomain: string;
  description: string;
  actionName: string;
  version: string;
  triggerIntents: string[];
  utteranceExamples: string[];
  graph: {
    start: string;
    terminals: string[];
    nodes: SopGraphNode[];
    edges: SopGraphEdge[];
    meta?: SopGraphMeta;
  };
}

export const rewriteSopWithAi = (body: {
  instruction: string;
  draft: SopDraftPayload;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  targetNodeKey?: string | null;
  targetNodeKeys?: string[];
  images?: string[];
}) => api.post<{
  assistant: string;
  draft: SopDraftPayload;
  model: string;
  scope?: "node" | "nodes" | "flow";
  targetNodeKey?: string;
  targetNodeKeys?: string[];
  tools?: Array<{ name: string; summary: string; status?: string }>;
}>(
  "/orchestration/sops/ai/rewrite/",
  body,
  { timeout: 90_000 },
).then((r) => r.data);

export const syncJackyun = () =>
  api.post<{
    ok: boolean;
    goods_mode?: string;
    trades_mode?: string;
    configured?: boolean;
    written?: Record<string, unknown>;
    error?: string;
  }>("/connectors/jackyun/sync/", {}, { timeout: 120_000 }).then((r) => r.data);

export const queryJackyun = (body: {
  question?: string;
  capability?: string;
  params?: Record<string, unknown>;
}) =>
  api
    .post<{
      ok: boolean;
      plan?: Record<string, unknown>;
      result?: Record<string, unknown>;
      block?: string;
      capabilities?: Array<Record<string, unknown>>;
      error?: string;
    }>("/connectors/jackyun/query/", body, { timeout: 60_000 })
    .then((r) => r.data);

export const getTables = () =>
  api.get("/datalake/tables/").then((r) => r.data);
export const getDataAssetPreview = (table: string, limit = 50) =>
  api.get(`/datalake/assets/${encodeURIComponent(table)}/preview/`, { params: { limit } }).then((r) => r.data);
export const publishDataAsset = (body: {
  table: string;
  asset_key: string;
  display_name: string;
  as_of: string;
  confirm_complete: boolean;
}) => api.post("/datalake/assets/publish/", body).then((r) => r.data);
export const getReportOptions = () =>
  api.get<{
    brands: Array<{ label: string; value: string }>;
    platforms: Array<{ label: string; value: string }>;
  }>("/datalake/report-options/").then((r) => r.data);
export const getMetrics = () =>
  api.get("/datalake/metrics/").then((r) => r.data);
export const getAnomalies = () =>
  api.get("/datalake/anomalies/").then((r) => r.data);
export const getSourceSnapshots = () =>
  api.get("/datalake/snapshots/").then((r) => r.data);
export const getMetricContracts = () =>
  api.get("/datalake/metric-contracts/").then((r) => r.data);
export const getRawImports = () =>
  api.get("/datalake/raw-imports/").then((r) => r.data);
export const getImportContracts = () =>
  api.get("/datalake/import-contracts/").then((r) => r.data);
export const getReferenceMappings = () =>
  api.get("/datalake/reference-mappings/").then((r) => r.data);
export const createReferenceMapping = (body: {
  mapping_key: string;
  kind: "channel" | "product" | "warehouse";
  version?: string;
  mappings: Record<string, unknown>;
}) => api.post("/datalake/reference-mappings/", body).then((r) => r.data);
export const confirmReferenceMapping = (id: number) =>
  api.post(`/datalake/reference-mappings/${id}/confirm/`, {}).then((r) => r.data);
export const uploadSalesLedger = (form: FormData) =>
  api.post("/datalake/raw-imports/sales-ledger/", form, { timeout: 10 * 60_000 }).then((r) => r.data);
export const reconcileRawImport = (id: number, reconciliation_hash: string) =>
  api.post(`/datalake/raw-imports/${id}/reconcile/`, { reconciliation_hash }).then((r) => r.data);
export const composeInventorySalesSnapshot = (body: {
  inventory_snapshot_id: number;
  sales_snapshot_id: number;
}) => api.post("/datalake/snapshots/compose/", body).then((r) => r.data);

export type AuditLogCategory = "operation" | "login" | "system" | "security" | "data_change";
export interface AuditKpi { value: number; deltaPct: number; trend: "up" | "down" | "flat" }
export interface AuditTrendPoint { date: string; count: number }
export interface AuditDistribution { key: string; label: string; count: number; pct: number }
export interface AuditTopUser { name: string; roleLabel: string; avatarUrl?: string; actor: string; count: number }
export interface AuditRow {
  id: number;
  time: string;
  user: { name: string; roleLabel: string; avatarUrl?: string };
  operationType: { key: string; label: string };
  content: string;
  detail: string;
  resourceType: string;
  resourceName: string;
  ip: string;
  status: { key: string; label: string };
  traceId: string;
  decision: string;
  payload: Record<string, unknown>;
  checks: unknown[];
  result: Record<string, unknown>;
}
export interface AuditOverview {
  ok: boolean;
  range: { start: string; end: string };
  kpis: {
    totalOps: AuditKpi;
    totalUsers: AuditKpi;
    errorOps: AuditKpi;
    sensitiveOps: AuditKpi;
    activeUsers: AuditKpi;
  };
  trend: AuditTrendPoint[];
  distribution: AuditDistribution[];
  topUsers: AuditTopUser[];
  rows: AuditRow[];
  pagination: { page: number; pageSize: number; total: number };
  filters: {
    operationTypes: { value: string; label: string }[];
    statuses: { value: string; label: string }[];
    users: { value: string; label: string }[];
  };
}
export const getAuditOverview = (params: {
  category?: AuditLogCategory;
  start?: string;
  end?: string;
  type?: string;
  status?: string;
  user?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) =>
  api.get<AuditOverview>("/audit/overview/", { params }).then((r) => r.data);

// ================= MCP ?????? =================
export interface McpServer {
  id: string;
  name: string;
  desc: string;
  layer: string;
  transport: "streamable_http" | "sse" | "stdio" | "openapi";
  declared_transport?: "streamable_http" | "sse" | "stdio" | "openapi";
  configured: boolean;
  enabled: boolean;
  url: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  native?: {
    native_type?: string;
    app_key?: string;
    app_secret_set?: boolean;
    base_url?: string;
    method_inventory?: string;
    acct_id?: string;
    username?: string;
    password_set?: boolean;
    lcid?: string;
  };
  tools: string[];
  env_keys: string[];
  placeholders?: Record<string, string>;
  hints?: string[];
  config_source: "none" | "ui" | "env" | "personal" | "organization";
  organization_id?: number | null;
  organization_name?: string;
  can_manage?: boolean;
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
  native?: Record<string, unknown>;
  app_key?: string;
  app_secret?: string;
  base_url?: string;
  method_inventory?: string;
  acct_id?: string;
  username?: string;
  password?: string;
  lcid?: string;
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

export interface NasFileEntry {
  name: string;
  path: string;
  kind: "folder" | "file";
  size: number | null;
  modified_at: string;
  extension: string;
  mime_type: string;
  previewable: boolean;
  preview_kind: "text" | "image" | "pdf" | "none";
  native_path: string;
  download_url: string;
  preview_url: string;
}

export interface NasDirectoryResult {
  root_name: string;
  current_path: string;
  current_native_path: string;
  parent_path: string | null;
  entries: NasFileEntry[];
  count: number;
  truncated: boolean;
  read_only: boolean;
}

export interface NasFilePreview {
  name: string;
  path: string;
  size: number;
  modified_at: string;
  mime_type: string;
  previewable: boolean;
  preview_kind: "text" | "image" | "pdf" | "none";
  native_path: string;
  download_url: string;
  preview_url: string;
  content: string;
  truncated: boolean;
}

export const getNasDirectory = (path = "/") =>
  api.get<NasDirectoryResult>("/mcp/servers/nas/files/", { params: { path } }).then((r) => r.data);

export const getNasFilePreview = (path: string) =>
  api.get<NasFilePreview>("/mcp/servers/nas/files/preview/", { params: { path } }).then((r) => r.data);

// ================= ? Agent ???? =================
export interface Agent {
  id: number;
  name: string;
  emoji: string;
  group: string;
  role: string;
  expertise: string;
  persona: string;
  execution_role: "operator" | "manager" | "director";
  is_active: boolean;
  quota_limit: number;
  quota_used: number;
  quota_remaining: number;
  status: "available" | "disabled" | "quota_exhausted";
  skill_ids: string[];
  knowledge_base_ids: number[];
  capability_instructions: string;
  created_at: string;
}

export interface CouncilHuman {
  id: number;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  kind?: "human";
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
  intro?: string;
  scheduled_at?: string | null;
  duration_minutes?: number;
  started_at?: string | null;
  status: "draft" | "active" | "paused" | "stopped";
  round: number;
  context_summary: string;
  participants: Agent[];
  human_participants?: CouncilHuman[];
  created_at: string;
  message_count?: number;
  has_deliverable?: boolean;
  deliverable_title?: string | null;
  graph_ref_count?: number;
  agent_count?: number;
  human_count?: number;
  agent_names?: string[];
  human_names?: string[];
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

/** ?????????(?? AGE) */
export interface GraphRef {
  id: number;
  name: string;
  otype: string;
  description?: string;
}

/** ???????????? */
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
  api.get<{
    results: Partial<Agent>[];
    llm: boolean;
  }>("/council/agents/").then((r) => ({
    ...r.data,
    results: (r.data.results || []).map((row) => {
      const quotaLimit = Number(row.quota_limit ?? 10000);
      const quotaUsed = Number(row.quota_used ?? 0);
      const quotaRemaining = Number(row.quota_remaining ?? Math.max(0, quotaLimit - quotaUsed));
      const isActive = row.is_active !== false;
      return {
        id: Number(row.id),
        name: String(row.name || "??????"),
        emoji: String(row.emoji || "??"),
        group: String(row.group || "???"),
        role: String(row.role || ""),
        expertise: String(row.expertise || ""),
        persona: String(row.persona || ""),
        execution_role: row.execution_role || "operator",
        is_active: isActive,
        quota_limit: quotaLimit,
        quota_used: quotaUsed,
        quota_remaining: quotaRemaining,
        status: row.status || (!isActive ? "disabled" : quotaRemaining <= 0 ? "quota_exhausted" : "available"),
        skill_ids: Array.isArray(row.skill_ids) ? row.skill_ids.map(String) : [],
        knowledge_base_ids: Array.isArray(row.knowledge_base_ids)
          ? row.knowledge_base_ids.map(Number).filter(Number.isFinite)
          : [],
        capability_instructions: String(row.capability_instructions || ""),
        created_at: String(row.created_at || ""),
      } satisfies Agent;
    }),
  }));
export const createAgent = (body: Partial<Agent>) =>
  api.post<Agent>("/council/agents/", body).then((r) => r.data);
export const updateAgent = (id: number, body: Partial<Agent>) =>
  api.patch<Agent>(`/council/agents/${id}/`, body).then((r) => r.data);
export const deleteAgent = (id: number) =>
  api.delete(`/council/agents/${id}/`).then((r) => r.data);

export const createMeeting = (body: {
  title?: string;
  intro?: string;
  question?: string;
  agent_ids: number[];
  user_ids?: number[];
  scheduled_at?: string | null;
  duration_minutes?: number;
  start_now?: boolean;
}) =>
  api
    .post<{ meeting: Meeting; messages: CouncilMessage[] }>("/council/meetings/", body, {
      timeout: 30_000,
    })
    .then((r) => r.data);

export const startMeeting = (id: number) =>
  api
    .post<{ meeting: Meeting; message: CouncilMessage | null }>(`/council/meetings/${id}/start/`)
    .then((r) => r.data);

export const pauseMeeting = (id: number) =>
  api
    .post<{ meeting: Meeting; message: CouncilMessage | null }>(`/council/meetings/${id}/pause/`)
    .then((r) => r.data);

/** ????????????? ids ????? active */
export const pauseActiveMeetings = (meeting_ids?: number[]) =>
  api
    .post<{ ok: boolean; paused_count: number; results: Meeting[] }>(
      "/council/meetings/pause-active/",
      meeting_ids ? { meeting_ids } : {},
    )
    .then((r) => r.data);

export const inviteMeetingParticipants = (
  id: number,
  body: { agent_ids?: number[]; user_ids?: number[] },
) =>
  api
    .post<{ meeting: Meeting; message: CouncilMessage | null; invited_count?: number }>(
      `/council/meetings/${id}/invite/`,
      body,
    )
    .then((r) => r.data);

export type CouncilInvite = {
  invite_id: number;
  meeting_id: number;
  title: string;
  question: string;
  status: string;
  inviter_name: string;
  created_at?: string | null;
};

export const listPendingCouncilInvites = () =>
  api
    .get<{ count: number; results: CouncilInvite[] }>("/council/invites/pending/")
    .then((r) => r.data);

export const ackCouncilInvite = (inviteId: number, action: "seen" | "join" | "dismiss") =>
  api
    .post<{ ok: boolean; invite: CouncilInvite }>(`/council/invites/${inviteId}/ack/`, { action })
    .then((r) => r.data);

/** ???? WebSocket??? CONNECTING ?? close ?????? */
export function closeWebSocketQuietly(ws: WebSocket | null | undefined) {
  if (!ws) return;
  try {
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener(
        "open",
        () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        },
        { once: true },
      );
      return;
    }
    if (ws.readyState === WebSocket.OPEN) ws.close();
  } catch {
    /* ignore */
  }
}

/** ????? WebSocket??????? */
export function openUserNotifySocket(opts: {
  onInvite?: (data: CouncilInvite) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
}): WebSocket {
  const token = getAuthToken() || "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.DEV
    ? `${window.location.hostname}:8000`
    : window.location.host;
  const url = `${proto}//${host}/ws/notify/?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  ws.onopen = () => opts.onOpen?.();
  ws.onclose = (e) => opts.onClose?.(e);
  ws.onmessage = (ev) => {
    try {
      const packet = JSON.parse(ev.data) as { event?: string; data?: CouncilInvite };
      if (packet.event === "council_invite" && packet.data) opts.onInvite?.(packet.data);
    } catch {
      /* ignore */
    }
  };
  return ws;
}

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

/** ???? WebSocket????? / ??????? */
export function openCouncilMeetingSocket(
  meetingId: number,
  opts: {
    onMessages?: (data: { status?: string; round?: number; results?: CouncilMessage[] }) => void;
    onStatus?: (data: { status?: string; round?: number }) => void;
    onOpen?: () => void;
    onClose?: (ev: CloseEvent) => void;
    onError?: (err: Event) => void;
  },
): WebSocket {
  const token = getAuthToken() || "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // ???????? :8000??? Vite ? WebSocket ??????????????????
  const host = import.meta.env.DEV
    ? `${window.location.hostname}:8000`
    : window.location.host;
  const url = `${proto}//${host}/ws/council/meetings/${meetingId}/?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  ws.onopen = () => opts.onOpen?.();
  ws.onerror = (e) => opts.onError?.(e);
  ws.onclose = (e) => opts.onClose?.(e);
  ws.onmessage = (ev) => {
    try {
      const packet = JSON.parse(ev.data) as {
        event?: string;
        data?: { status?: string; round?: number; results?: CouncilMessage[] };
      };
      if (packet.event === "messages" && packet.data) opts.onMessages?.(packet.data);
      if (packet.event === "status" && packet.data) opts.onStatus?.(packet.data);
    } catch {
      /* ignore */
    }
  };
  return ws;
}

export const tickMeeting = (id: number) =>
  api
    .post<{ stopped: boolean; messages: CouncilMessage[] }>(
      `/council/meetings/${id}/tick/`,
      {},
      { timeout: 180_000 },
    )
    .then((r) => r.data);

export const interject = (id: number, text: string) =>
  api
    .post<{ message: CouncilMessage; replies?: CouncilMessage[] }>(
      `/council/meetings/${id}/interject/`,
      { text },
      { timeout: 45_000 },
    )
    .then((r) => r.data);

export const stopMeeting = (id: number) =>
  api
    .post<{
      deliverables: Deliverable[];
      deliverable: Deliverable;
      graph?: GraphWriteback;
    }>(`/council/meetings/${id}/stop/`, {}, { timeout: 300_000 })
    .then((r) => r.data);

// ================= ?? ER ?? =================
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

export const getAgeLiveGraph = (params?: { limit?: number; edge_limit?: number; focus_age_id?: number; refresh?: 1 }) =>
  api.get<OntGraph>("/ontology/graph/age-live/", { params }).then((r) => r.data);

export const getGraph = (params?: { scope?: "age" | "all" }) =>
  api.get<OntGraph>("/ontology/graph/", { params: { scope: params?.scope ?? "age" } }).then((r) => r.data);

/** ???? Ontology ?????????? */
export type CommerceSchema = {
  source: string;
  phase: number;
  object_types: {
    key: string;
    label: string;
    description: string;
    key_properties: string[];
    sensitivity: string;
    loop_level?: string | null;
    category: string;
  }[];
  relation_types: { key: string; label: string; description: string }[];
  loop_level_object: Record<string, string>;
  containment_chain: {
    parent_key: string;
    child_key: string;
    parent_label: string;
    child_label: string;
    label: string;
  }[];
  samples?: {
    objects: {
      id: number;
      otype: string;
      name: string;
      category: string;
      attributes: Record<string, unknown>;
    }[];
    contain_relations: {
      id: number;
      label: string;
      source: string;
      target: string;
    }[];
  };
  fusion?: {
    name: string;
    source_path: string;
    phase: number;
    phase_title: string;
    done: string[];
    pending: string[];
  };
};
export const getCommerceSchema = () =>
  api.get<CommerceSchema>("/ontology/commerce-schema/").then((r) => r.data);

// ---- ???????????????----
export const getCommerceOverview = () =>
  api.get<{
    name: string;
    source_path: string;
    phases: { id: number; title: string; status: string; items: string[] }[];
    runtime: Record<string, unknown>;
  }>("/commerce/overview/").then((r) => r.data);

export const getCommerceFactsHealth = () =>
  api.get<{
    status: string;
    duckdb: { available: boolean; path: string; table_count: number; tables: { schema?: string; name: string }[]; error?: string };
    postgres: { available: boolean; table_count: number; tables: Record<string, unknown>[]; error?: string };
    connectors: { id: string; name: string; status: string; note: string }[];
    facts?: FactTableHealth[];
    facts_summary?: { total: number; ok: number; partial: number; missing: number };
    guidance: string[];
  }>("/commerce/facts/health/").then((r) => r.data);

export type FactTableHealth = {
  id: string;
  code: string;
  name: string;
  source: string;
  grain: string;
  status: "ok" | "empty" | "partial" | "missing";
  available: boolean;
  missing: boolean;
  rows: number | null;
  matched_tables: { table: string; engines: string[]; refs: string[]; rows: number | null }[];
  expected_tables: string[];
  note: string;
};

export const simulateCommerceLoops = (body?: {
  model_id?: string;
  periods?: number;
  interventions?: Record<string, number[]>;
}) => api.post<{
  model_name: string;
  periods: number;
  trajectory: { period: number; values: Record<string, number>; labels: Record<string, string> }[];
  final: Record<string, number>;
  uncertainty_metadata?: { note?: string };
}>("/commerce/loops/simulate/", body || {}).then((r) => r.data);

export const getCommerceEvidence = () =>
  api.get<{
    nodes: { id: string; type: string; label: string; summary?: string }[];
    edges: { id: string; source: string; target: string; type: string; label?: string }[];
    counts: { nodes: number; edges: number };
    warnings: string[];
  }>("/commerce/evidence/").then((r) => r.data);

export const getCommerceGovernance = () =>
  api.get<{
    external_writes_enabled: boolean;
    policy: { default: string; modes: string[] };
    approvals: { pending_count: number; items: Record<string, unknown>[]; error?: string };
    mcp: { servers: { id: number; name: string; enabled: boolean }[]; error?: string };
    tool_gates: { tool: string; action: string; requires_approval: boolean }[];
  }>("/commerce/governance/").then((r) => r.data);

export const runCommerceCouncil = (body: { decision_context: string; domain?: string; evidence?: string }) =>
  api.post<{
    summary: string;
    votes: { member: string; stance: string; reason: string }[];
    kill_criteria: string[];
    panel: { id: string; name: string; focus: string }[];
  }>("/commerce/council/", body).then((r) => r.data);

export const getCommerceAgents = () =>
  api.get<{
    supervisors: { id: string; title: string }[];
    agents: { id: string; team: string; title: string; desc: string }[];
    integration: { chat_path: string; hint: string };
    counts: { agents: number; supervisors: number };
  }>("/commerce/agents/").then((r) => r.data);


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

// ---- ?????? ----
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

// ================= Loops ???? =================
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

export const listLoops = (params?: { status?: string; includeMembers?: boolean }) =>
  api.get<{ results: FeedbackLoop[] }>("/loops/", {
    params: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.includeMembers ? { include_members: 1 } : {}),
    },
  }).then((r) => r.data);
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

export interface BrandLoopEvidence {
  label: string;
  value?: string | number | null;
  unit?: string | null;
}

export interface BrandLoopNode {
  id: string;
  name: string;
  value?: string | number | null;
  unit?: string | null;
  status: string;
  data_status?: string | null;
  evidence?: BrandLoopEvidence[];
}

export interface BrandLoopLink {
  source: string;
  target: string;
  polarity?: string;
  label?: string;
}

export interface BrandManagementLoopData {
  brand: {
    id?: string;
    name: string;
    product_count?: number | null;
  };
  period: string;
  metrics: {
    sales_quantity?: number | null;
    inventory_cover_days?: number | null;
    [key: string]: unknown;
  };
  stocks: BrandLoopNode[];
  flows: BrandLoopNode[];
  links: BrandLoopLink[];
  data_status: Record<string, string>;
}

export const getBrandManagementLoop = (params?: { brand_id?: string; period?: string }) =>
  api.get<BrandManagementLoopData>("/loops/brand-management/", { params }).then((r) => r.data);

// ================= ???? =================
export interface CollabUserBrief {
  id: number;
  username: string;
  nickname?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  online?: boolean;
  last_seen?: string | null;
  date_joined?: string | null;
  kind?: "human" | "bot";
  bot_id?: string;
  last_read_message_id?: number;
}

export interface XiaoceRunSummary {
  id: string;
  status: "running" | "cancelled" | "completed" | "failed";
  room_id: string;
}

export interface CreatedSkillItem {
  asset_id: number;
  personal_id: number;
  skill_id: string;
  name: string;
  description?: string;
  visibility: "private" | "shared";
  enabled: boolean;
  package_kind?: "single" | "package";
  storage?: "cos" | "local";
}

export interface XiaoceProgressStep {
  code: string;
  label: string;
  status: "running" | "completed" | "cancelled" | "failed";
  tool_count: number;
  detail: string;
  started_at: string;
  finished_at: string;
}

export interface XiaoceRun {
  id: string;
  status: "running" | "cancelled" | "completed" | "failed";
  room_id: string;
  current_stage: string;
  progress_steps: XiaoceProgressStep[];
  error_code: string;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface CollabRoom {
  id: string;
  title: string;
  display_title?: string;
  room_kind?: "dm" | "group";
  status: "open" | "closed";
  risk_level: "green" | "yellow" | "red";
  summary?: string;
  interject_enabled?: boolean;
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
  has_more_before?: boolean;
  unread_count?: number;
  last_read_message_id?: number;
  active_xiaoce_run?: XiaoceRun | null;
}

export interface CollabContextRoomRef {
  id: string;
  title: string;
  message_count?: number;
  last_message_id?: number | null;
}

export interface CollabForwardBundleItem {
  message_id: number;
  room_id: string;
  room_title: string;
  sender: CollabUserBrief;
  content: string;
  attachments?: CollabMessage["attachments"];
  created_at: string;
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
  meta?: {
    run_id?: string;
    process_steps?: XiaoceProgressStep[];
    process_status?: XiaoceRun["status"];
    cancelled?: boolean;
    error_code?: string;
    error_message?: string;
    created_skill?: CreatedSkillItem;
    skill_generation_failed?: boolean;
    context_rooms?: CollabContextRoomRef[];
    forward_mode?: "merge" | "separate";
    forward_bundle?: CollabForwardBundleItem[];
    forwarded_from?: {
      message_id: number;
      room_id: string;
      room_title: string;
      sender: CollabUserBrief;
      created_at: string;
    };
    [key: string]: unknown;
  };
  msg_type?: "user" | "system" | "ai";
  ai_kind?: "" | "reply" | "interject" | "suggest" | "xiaoce";
  status?: "normal" | "recalled" | "deleted";
  risk_flag?: string;
  risk_flag_level?: "" | "yellow" | "red";
  reply_to?: {
    id: number;
    sender: Pick<CollabUserBrief, "id" | "username" | "display_name">;
    content: string;
    status?: "normal" | "recalled" | "deleted";
    attachment_count?: number;
  } | null;
  read_state?: {
    reader_count: number;
    unread_count: number;
    read_by: string[];
    unread_by: string[];
  };
  created_at: string;
  updated_at?: string;
}

export interface CollabTranslation {
  message_id: number;
  source_language: "zh" | "en" | string;
  target_language: "en" | "zh-CN" | string;
  translated_text: string;
}

export interface CollabSummary {
  id: number;
  room_id: string;
  range_mode: "auto" | "latest" | "time" | "custom";
  start_message_id?: number | null;
  end_message_id?: number | null;
  start_at?: string | null;
  end_at?: string | null;
  message_count: number;
  selection_reason: string;
  content: string;
  key_points: string[];
  decisions: string[];
  action_items: string[];
  participants: string[];
  generated_by: "llm" | "local";
  model_name?: string;
  model_source?: "personal" | "platform" | "platform_fallback" | "";
  created_by: string;
  created_at: string;
}

export interface CollabSummaryModel {
  configured: boolean;
  model: string;
  source: "personal" | "platform";
  missing: ("api_key" | "base_url" | "model")[];
}

export interface CollabSummarySuggestion {
  should_summarize: boolean;
  reason: string;
  pending_message_count: number;
  span_minutes: number;
  suggested_range: "auto";
  last_summary_message_id?: number | null;
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

export interface CollabRoomStats {
  ok: boolean;
  room_id: string;
  risk_level: "green" | "yellow" | "red";
  interject_enabled: boolean;
  message_count: number;
  user_message_count: number;
  ai_reply_count: number;
  ai_interject_count: number;
  attachment_count: number;
  risk_counts: { green: number; yellow: number; red: number };
  speaker_top: { name: string; count: number }[];
  hourly: { hour: string; label: string; count: number }[];
  alerts: {
    id: number;
    risk_level: string;
    title: string;
    advice: string;
    evidence_message_ids: number[];
    draft_reply: string;
    created_at: string;
  }[];
  messages_today?: number;
  messages_7d?: number;
  read_metrics?: {
    receipt_count: number;
    unique_readers: number;
    avg_read_latency_ms: number;
    total_active_read_ms: number;
    avg_session_read_ms: number;
    session_count: number;
  };
  summary_model?: CollabSummaryModel;
  latest_summary?: CollabSummary | null;
  summary_suggestion?: CollabSummarySuggestion;
}

export const listCollabRooms = (params?: { status?: string }) =>
  api.get<{ count: number; results: CollabRoom[] }>("/collab/rooms/", { params })
    .then((r) => r.data);

export const createCollabRoom = (body: {
  title?: string;
  peer_username?: string;
  peer_bot_id?: string;
  peer_usernames?: string[];
  room_kind?: "dm" | "group";
}) =>
  api.post<CollabRoom>("/collab/rooms/", body).then((r) => r.data);

export const createXiaoceTask = (body: { title?: string } = {}) =>
  api.post<CollabRoom>("/collab/xiaoce-tasks/", body).then((response) => response.data);

export const getCollabRoom = (id: string, opts?: { includeMessages?: boolean }) =>
  api.get<CollabRoom>(`/collab/rooms/${id}/`, {
    params: {
      include_messages: opts?.includeMessages ? "1" : "0",
    },
  }).then((r) => r.data);

export const updateCollabRoom = (
  id: string,
  body: { status?: string; title?: string; interject_enabled?: boolean },
) =>
  api.patch<CollabRoom>(`/collab/rooms/${id}/`, body).then((r) => r.data);

/** ???????? */
export const deleteCollabRoom = (id: string) =>
  api.delete<{ ok: boolean; deleted: string }>(`/collab/rooms/${id}/`).then((r) => r.data);

/** ???????????? */
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

/** ???? */
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

/** ???? / ?? */
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

/** ?????? */
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

export type CollabMessageQuery = {
  afterId?: number;
  beforeId?: number;
  aroundId?: number;
  limit?: number;
  lite?: boolean;
  includeParticipants?: boolean;
};

export type CollabMessagePage = {
  count: number;
  results: CollabMessage[];
  changed?: CollabMessage[];
  has_more_before?: boolean;
  has_more_after?: boolean;
  room: Partial<CollabRoom>;
};

/** ????? listCollabMessages(id, afterId) */
export const listCollabMessages = (id: string, opts: CollabMessageQuery | number = {}) => {
  const o: CollabMessageQuery = typeof opts === "number" ? { afterId: opts } : opts;
  const params: Record<string, string | number> = {};
  if (o.afterId) params.after_id = o.afterId;
  if (o.beforeId) params.before_id = o.beforeId;
  if (o.aroundId) params.around_id = o.aroundId;
  if (o.limit) params.limit = o.limit;
  if (o.lite) params.lite = "1";
  if (o.includeParticipants === false) params.include_participants = "0";
  if (o.includeParticipants === true) params.include_participants = "1";
  return api
    .get<CollabMessagePage>(`/collab/rooms/${id}/messages/`, { params })
    .then((r) => r.data);
};

export type CollabSearchRoom = {
  id: string;
  title: string;
  display_title: string;
  room_kind: "dm" | "group";
  status: "open" | "closed";
  is_xiaoce: boolean;
  updated_at: string;
};

export type CollabSearchMessage = {
  id: number;
  content: string;
  snippet: string;
  msg_type: "user" | "system" | "ai";
  ai_kind: "" | "reply" | "interject" | "suggest" | "xiaoce";
  sender: CollabUserBrief;
  created_at: string;
};

export type CollabSearchResult = {
  kind: "room" | "message";
  room: CollabSearchRoom;
  message: CollabSearchMessage | null;
  snippet: string;
  created_at: string;
};

export const searchCollabMessages = (query: string, limit = 40) =>
  api
    .get<{
      query: string;
      count: number;
      has_more: boolean;
      results: CollabSearchResult[];
    }>("/collab/search/", { params: { q: query, limit } })
    .then((r) => r.data);

export const getCollabRoomPresence = (id: string) =>
  api.get<{
    ok: boolean;
    id: string;
    status: string;
    risk_level: string;
    updated_at: string;
    online_count?: number;
    peer_online?: boolean | null;
    participants: CollabUserBrief[];
    member_count?: number;
    display_title?: string;
    active_xiaoce_run?: XiaoceRun | null;
  }>(`/collab/rooms/${id}/presence/`).then((r) => r.data);

export type CollabSyncEvent = {
  messages?: CollabMessage[];
  changed?: CollabMessage[];
  insights?: CollabInsight[];
  room?: Partial<CollabRoom>;
  xiaoce_runs?: XiaoceRun[];
  read_receipts?: CollabReadReceipt[];
  after_id?: number;
  after_insight_id?: number;
};

export type CollabReadReceipt = {
  user_id: number;
  last_read_message_id: number;
  read_at: string;
};

/** ???? WebSocket??????? :8000? */
export function openCollabRoomSocket(
  roomId: string,
  opts: {
    onSync?: (data: CollabSyncEvent) => void;
    onOpen?: () => void;
    onClose?: (ev: CloseEvent) => void;
    onError?: (err: Event) => void;
  },
): WebSocket {
  const token = getAuthToken() || "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.DEV
    ? `${window.location.hostname}:8000`
    : window.location.host;
  const url = `${proto}//${host}/ws/collab/rooms/${roomId}/?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  ws.onopen = () => opts.onOpen?.();
  ws.onerror = (e) => opts.onError?.(e);
  ws.onclose = (e) => opts.onClose?.(e);
  ws.onmessage = (ev) => {
    try {
      const packet = JSON.parse(ev.data) as { event?: string; data?: CollabSyncEvent };
      if (packet.event === "sync" && packet.data) opts.onSync?.(packet.data);
    } catch {
      /* ignore */
    }
  };
  return ws;
}

/** @deprecated ????????? WebSocket */
export function openCollabRoomEvents(
  roomId: string,
  opts: {
    afterId?: number;
    afterInsightId?: number;
    onSync?: (data: CollabSyncEvent) => void;
    onError?: (err: unknown) => void;
    onDone?: () => void;
    signal?: AbortSignal;
  },
) {
  const token = getAuthToken();
  const qs = new URLSearchParams();
  if (opts.afterId) qs.set("after_id", String(opts.afterId));
  if (opts.afterInsightId) qs.set("after_insight_id", String(opts.afterInsightId));
  const url = `/api/collab/rooms/${roomId}/events/${qs.toString() ? `?${qs}` : ""}`;

  const run = async () => {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        signal: opts.signal,
        credentials: "same-origin",
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split(/\n\n/);
        buf = parts.pop() || "";
        for (const block of parts) {
          const lines = block.split(/\n/);
          let dataLine = "";
          let eventName = "message";
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          let payload: CollabSyncEvent = {};
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }
          if (eventName === "sync") opts.onSync?.(payload);
          if (eventName === "error") opts.onError?.(payload);
          if (eventName === "reconnect") {
            try { await reader.cancel(); } catch { /* ignore */ }
            opts.onDone?.();
            return;
          }
        }
      }
      opts.onDone?.();
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      opts.onError?.(err);
    }
  };

  void run();
}

/** ????????2 ???? */
export const recallCollabMessage = (roomId: string, messageId: number) =>
  api
    .post<{ ok: boolean; action: string; message: CollabMessage; room: CollabRoom; error?: string }>(
      `/collab/rooms/${roomId}/messages/${messageId}/`,
      { action: "recall" },
    )
    .then((r) => r.data);

/** ??????????????? */
export const deleteCollabMessage = (roomId: string, messageId: number) =>
  api
    .delete<{ ok: boolean; action: string; message: CollabMessage; room: CollabRoom; error?: string }>(
      `/collab/rooms/${roomId}/messages/${messageId}/`,
    )
    .then((r) => r.data);

export const forwardCollabMessages = (
  targetRoomId: string,
  messageIds: number[],
  mode: "merge" | "separate",
) => api.post<{
  ok: boolean;
  mode: "merge" | "separate";
  messages: CollabMessage[];
  room: Partial<CollabRoom>;
  error?: string;
}>(`/collab/rooms/${targetRoomId}/messages/forward/`, {
  message_ids: messageIds,
  mode,
}).then((r) => r.data);

export const translateCollabMessages = (roomId: string, messageIds: number[]) =>
  api.post<{
    ok: boolean;
    model: string;
    translations: CollabTranslation[];
    error?: string;
  }>(`/collab/rooms/${roomId}/messages/translate/`, {
    message_ids: messageIds,
  }).then((r) => r.data);

export const sendCollabMessage = (
  id: string,
  content: string,
  analyze = true,
  files?: File[],
  replyToId?: number,
  runId?: string,
  contextRoomIds?: string[],
) => {
  if (files?.length) {
    const form = new FormData();
    form.append("content", content || "");
    form.append("analyze", analyze ? "1" : "0");
    if (replyToId) form.append("reply_to_id", String(replyToId));
    if (runId) form.append("run_id", runId);
    if (contextRoomIds?.length) form.append("context_room_ids", JSON.stringify(contextRoomIds));
    files.forEach((file) => form.append("files", file));
    return api
      .post<{
        ok: boolean;
        message: CollabMessage;
        ai_message?: CollabMessage;
        room: Partial<CollabRoom>;
        insight?: CollabInsight;
        analyze_pending?: boolean;
        ai_pending?: boolean;
        xiaoce_run?: XiaoceRun;
      }>(`/collab/rooms/${id}/messages/`, form, { timeout: 120_000 })
      .then((r) => r.data);
  }
  return api
    .post<{
      ok: boolean;
      message: CollabMessage;
      ai_message?: CollabMessage;
      room: Partial<CollabRoom>;
      insight?: CollabInsight;
      analyze_pending?: boolean;
      ai_pending?: boolean;
      xiaoce_run?: XiaoceRun;
    }>(
      `/collab/rooms/${id}/messages/`,
      {
        content,
        analyze: analyze ? "1" : "0",
        ...(replyToId ? { reply_to_id: replyToId } : {}),
        ...(runId ? { run_id: runId } : {}),
        ...(contextRoomIds?.length ? { context_room_ids: contextRoomIds } : {}),
      },
      { timeout: 120_000 },
    )
    .then((r) => r.data);
};

export const cancelXiaoceRun = (roomId: string, runId: string) =>
  api.post<{
    ok: boolean;
    xiaoce_run: XiaoceRun;
    active_xiaoce_run: null;
    message: CollabMessage;
    room: Partial<CollabRoom>;
    error?: string;
  }>(`/collab/rooms/${roomId}/xiaoce-runs/${runId}/cancel/`, {})
    .then((response) => response.data);

export const listCollabSummaries = (id: string) =>
  api
    .get<{
      ok: boolean;
      model: CollabSummaryModel;
      suggestion: CollabSummarySuggestion;
      latest: CollabSummary | null;
      results: CollabSummary[];
    }>(`/collab/rooms/${id}/summaries/`)
    .then((r) => r.data);

export const summarizeCollabRoom = (
  id: string,
  body: {
    range_mode?: "auto" | "latest" | "time" | "custom";
    message_count?: number;
    minutes?: number;
    start_message_id?: number;
    end_message_id?: number;
  } = {},
) =>
  api
    .post<{
      ok: boolean;
      summary: CollabSummary;
      model: CollabSummaryModel;
      suggestion: CollabSummarySuggestion;
      error?: string;
    }>(`/collab/rooms/${id}/summaries/`, body, { timeout: 60_000 })
    .then((r) => r.data);

export const listCollabInsights = (id: string, afterId = 0) =>
  api.get<{ count: number; results: CollabInsight[]; room_risk_level: string }>(
    `/collab/rooms/${id}/insights/`,
    { params: afterId ? { after_id: afterId } : {} },
  ).then((r) => r.data);

export const refreshCollabInsights = (id: string) =>
  api.post<{ ok: boolean; insight: CollabInsight; room: CollabRoom; ai_message?: CollabMessage }>(
    `/collab/rooms/${id}/insights/`,
    {},
  ).then((r) => r.data);

export type CollabDraftTip = {
  kind: "tip" | "optimize" | "warn" | "risk" | string;
  level: "info" | "yellow" | "red" | "green" | string;
  label: string;
  advice: string;
  /** ????????????? */
  example?: string;
};

export const checkCollabDraft = (id: string, text: string) =>
  api
    .post<{
      ok: boolean;
      level: string;
      tips: CollabDraftTip[];
      examples?: string[];
      label: string;
      advice: string;
      error?: string;
    }>(`/collab/rooms/${id}/draft-check/`, { text }, { timeout: 20_000 })
    .then((r) => r.data);

export const getCollabRoomStats = (id: string) =>
  api.get<CollabRoomStats>(`/collab/rooms/${id}/stats/`).then((r) => r.data);

export const listCollabUsers = (q?: string) =>
  api.get<{ count: number; results: CollabUserBrief[] }>("/collab/users/", {
    params: q ? { q } : {},
  }).then((r) => r.data);

/** ???????? */
export const collabPresenceHeartbeat = () =>
  api
    .post<{ ok: boolean; online: boolean; last_seen: string; window_seconds: number }>(
      "/collab/presence/",
      {},
    )
    .then((r) => r.data);

/** ???????????????????? */
export const collabPresenceQuery = (userIds: number[]) =>
  api
    .get<{
      ok: boolean;
      window_seconds: number;
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

/** ?????????????? */
export const getCollabUnread = () =>
  api
    .get<{
      ok: boolean;
      total_unread: number;
      count: number;
      results: CollabUnreadItem[];
    }>("/collab/unread/")
    .then((r) => r.data);

/** ?????? */
export const markCollabRoomRead = (
  id: string,
  upToId?: number,
  tracking?: {
    sessionId?: string;
    activeDurationMs?: number;
    ended?: boolean;
  },
) =>
  api
    .post<{
      ok: boolean;
      last_read_message_id: number;
      unread_count: number;
      room_id: string;
      session?: {
        session_id: string;
        active_duration_ms: number;
        ended: boolean;
      } | null;
    }>(
      `/collab/rooms/${id}/read/`,
      {
        ...(upToId ? { up_to_id: upToId } : {}),
        ...(tracking?.sessionId ? { session_id: tracking.sessionId } : {}),
        ...(tracking?.activeDurationMs
          ? { active_duration_ms: Math.round(tracking.activeDurationMs) }
          : {}),
        ...(tracking?.ended ? { ended: true } : {}),
      },
    )
    .then((r) => r.data);

export type WorkTodoItem = {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "completed" | "cancelled";
  userStatus?: number;
  priority?: "normal" | "high" | "urgent";
  dueAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  creatorName: string;
  assigneeNames: string[];
  remindTypes: number[];
  syncRequested?: boolean;
  syncStatus?: "not_requested" | "pending" | "synced" | "failed" | "partial";
  recipients?: Array<{
    name: string;
    type: "platform" | "wecom";
    avatar?: string;
    syncStatus: "not_requested" | "pending" | "synced" | "failed";
  }>;
  syncErrorReason?: string;
  lastSyncedAt?: string | null;
  source: "platform";
};

export type WeComTodoMember = { id: number; name: string; department: string; avatar: string; bound: boolean };
export type WeComCliConfig = {
  configured: boolean; enabled: boolean; botId: string; secretConfigured: boolean; canManage: boolean;
  canUse: boolean; accessScope: "organization" | "selected" | "owner"; allowedUserIds: number[];
  lastTestedAt?: string | null; lastErrorReason?: string; organizationName?: string;
};

export const getWeComCliConfig = () =>
  api.get<WeComCliConfig & { ok: boolean }>("/wecom/cli-config/").then((r) => r.data);
export const saveWeComCliConfig = (body: {
  botId: string; secret?: string; enabled?: boolean;
  accessScope?: "organization" | "selected" | "owner"; allowedUserIds?: number[];
}) =>
  api.patch<{ ok: boolean; detail: string }>("/wecom/cli-config/", body).then((r) => r.data);
export const testWeComCliConfig = () =>
  api.post<{ ok: boolean; detail: string }>("/wecom/cli-config/test/", {}).then((r) => r.data);
export const getWeComTodoMembers = () =>
  api.get<{ ok: boolean; results: WeComTodoMember[] }>("/wecom/todos/members/").then((r) => r.data);
export type WorkTodoListParams = {
  view: "assigned" | "created";
  status?: "pending" | "completed";
  q?: string;
  priority?: "normal" | "high" | "urgent";
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};
export const listWeComTodos = (params: WorkTodoListParams) =>
  api.get<{ ok: boolean; source: string; results: WorkTodoItem[]; count: number; page: number; pageSize: number }>("/wecom/todos/", {
    params,
  }).then((r) => r.data);
export const createWeComTodo = (body: {
  title: string; description?: string; platformAssigneeIds: number[]; wecomContactIds: number[];
  dueAt?: string; priority?: string; remindTypes?: number[];
  syncToWeCom?: boolean;
}) => api.post<{
  ok: boolean; ids: string[]; detail: string; syncStatus: WorkTodoItem["syncStatus"]; syncDetail: string;
  skippedPlatformAssigneeNames: string[];
}>("/wecom/todos/", body).then((r) => r.data);
export const setWeComTodoStatus = (id: string, status: "pending" | "completed") =>
  api.post<{ ok: boolean; detail: string; syncStatus: WorkTodoItem["syncStatus"] }>("/wecom/todos/status/", { id, status }).then((r) => r.data);
export const retryWeComTodoSync = (id: string) =>
  api.post<{ ok: boolean; detail: string; syncStatus: WorkTodoItem["syncStatus"] }>(`/wecom/todos/${id}/sync/`, {}).then((r) => r.data);
export const deleteWeComTodo = (id: string) =>
  api.delete<{ ok: boolean; detail: string; deletedCount: number; weComDeleted: boolean }>(`/wecom/todos/${id}/`).then((r) => r.data);
export const updateWeComTodo = (id: string, body: {
  title?: string; description?: string; dueAt?: string | null;
  priority?: "normal" | "high" | "urgent"; remindTypes?: number[];
}) => api.patch<{ ok: boolean; detail: string; syncStatus: WorkTodoItem["syncStatus"] }>(`/wecom/todos/${id}/`, body).then((r) => r.data);

export type WorkAutomationItem = {
  id: number;
  name: string;
  triggerType: "schedule" | "data" | "manual";
  triggerRule: string;
  action: string;
  channel: "none" | "in_app" | "wecom";
  recipientContactIds: number[];
  enabled: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string;
  lastError?: string;
  runCount: number;
  lastTestedAt?: string | null;
  lastTestStatus?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkAutomationInput = Omit<WorkAutomationItem, "id" | "nextRunAt" | "lastRunAt" | "lastRunStatus" | "lastError" | "runCount" | "lastTestedAt" | "lastTestStatus" | "createdAt" | "updatedAt">;

export type WorkAutomationStats = {
  saved: number;
  enabled: number;
  nextRunAt?: string | null;
  todayRuns: number;
};

export const listWorkAutomations = () =>
  api.get<{ ok: boolean; count: number; stats: WorkAutomationStats; results: WorkAutomationItem[] }>("/automations/").then((r) => r.data);
export const createWorkAutomation = (body: WorkAutomationInput) =>
  api.post<{ ok: boolean; automation: WorkAutomationItem }>("/automations/", body).then((r) => r.data);
export const updateWorkAutomation = (id: number, body: Partial<WorkAutomationInput>) =>
  api.patch<{ ok: boolean; automation: WorkAutomationItem }>(`/automations/${id}/`, body).then((r) => r.data);

/* ---------- Smart Table ---------- */

export type SmartFieldType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "checkbox"
  | "date"
  | "person";

export type SmartColumn = {
  id: number;
  key: string;
  title: string;
  field_type: SmartFieldType;
  options: string[];
  position: number;
};

export type SmartRow = {
  id: number;
  values: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
};

export type SmartSheetListItem = {
  id: number;
  name: string;
  description: string;
  owner_name?: string;
  organization_id?: number | null;
  knowledge_base?: number | null;
  can_manage?: boolean;
  is_mine?: boolean;
  column_count: number;
  row_count: number;
  created_at: string;
  updated_at: string;
};

export type SmartSheetDetail = {
  id: number;
  name: string;
  description: string;
  owner_name?: string;
  organization_id?: number | null;
  knowledge_base?: number | null;
  can_manage?: boolean;
  is_mine?: boolean;
  columns: SmartColumn[];
  rows: SmartRow[];
  views: SmartView[];
  automations: SmartAutomation[];
  created_at: string;
  updated_at: string;
};

export type SmartViewType = "grid" | "kanban" | "form" | "dashboard";

export type SmartView = {
  id: number;
  name: string;
  view_type: SmartViewType;
  config: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
};

export type SmartAutomation = {
  id: number;
  name: string;
  enabled: boolean;
  trigger: "row_created" | "row_updated";
  action: "set_field";
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const listSmartSheets = (params?: { knowledge_base?: number }) =>
  api.get<{ results: SmartSheetListItem[] }>("/smarttable/sheets/", { params }).then((r) => r.data);

export const createSmartSheet = (body: {
  name?: string;
  description?: string;
  knowledge_base?: number;
}) =>
  api.post<SmartSheetDetail>("/smarttable/sheets/", body).then((r) => r.data);

export const getSmartSheet = (id: number) =>
  api.get<SmartSheetDetail>(`/smarttable/sheets/${id}/`).then((r) => r.data);

export const updateSmartSheet = (id: number, body: { name?: string; description?: string }) =>
  api.patch<SmartSheetDetail>(`/smarttable/sheets/${id}/`, body).then((r) => r.data);

export const deleteSmartSheet = (id: number) =>
  api.delete<{ ok: boolean }>(`/smarttable/sheets/${id}/`).then((r) => r.data);

export const createSmartColumn = (
  sheetId: number,
  body: { title?: string; field_type?: SmartFieldType; options?: string[] },
) =>
  api.post<SmartColumn>(`/smarttable/sheets/${sheetId}/columns/`, body).then((r) => r.data);

export const updateSmartColumn = (
  sheetId: number,
  columnId: number,
  body: Partial<Pick<SmartColumn, "title" | "field_type" | "options" | "position">>,
) =>
  api.patch<SmartColumn>(`/smarttable/sheets/${sheetId}/columns/${columnId}/`, body).then((r) => r.data);

export const deleteSmartColumn = (sheetId: number, columnId: number) =>
  api.delete<{ ok: boolean }>(`/smarttable/sheets/${sheetId}/columns/${columnId}/`).then((r) => r.data);

export const createSmartRow = (sheetId: number, values?: Record<string, unknown>) =>
  api.post<SmartRow>(`/smarttable/sheets/${sheetId}/rows/`, { values: values || {} }).then((r) => r.data);

export const updateSmartRow = (
  sheetId: number,
  rowId: number,
  body: { values?: Record<string, unknown>; position?: number },
) =>
  api.patch<SmartRow>(`/smarttable/sheets/${sheetId}/rows/${rowId}/`, body).then((r) => r.data);

export const deleteSmartRow = (sheetId: number, rowId: number) =>
  api.delete<{ ok: boolean }>(`/smarttable/sheets/${sheetId}/rows/${rowId}/`).then((r) => r.data);

export const createSmartView = (
  sheetId: number,
  body: { name?: string; view_type?: SmartViewType; config?: Record<string, unknown> },
) =>
  api.post<SmartView>(`/smarttable/sheets/${sheetId}/views/`, body).then((r) => r.data);

export const updateSmartView = (
  sheetId: number,
  viewId: number,
  body: Partial<Pick<SmartView, "name" | "view_type" | "config" | "position">>,
) =>
  api.patch<SmartView>(`/smarttable/sheets/${sheetId}/views/${viewId}/`, body).then((r) => r.data);

export const deleteSmartView = (sheetId: number, viewId: number) =>
  api.delete<{ ok: boolean }>(`/smarttable/sheets/${sheetId}/views/${viewId}/`).then((r) => r.data);

export const createSmartAutomation = (
  sheetId: number,
  body: Partial<Pick<SmartAutomation, "name" | "enabled" | "trigger" | "action" | "config">>,
) =>
  api.post<SmartAutomation>(`/smarttable/sheets/${sheetId}/automations/`, body).then((r) => r.data);

export const updateSmartAutomation = (
  sheetId: number,
  automationId: number,
  body: Partial<Pick<SmartAutomation, "name" | "enabled" | "trigger" | "action" | "config">>,
) =>
  api.patch<SmartAutomation>(`/smarttable/sheets/${sheetId}/automations/${automationId}/`, body).then((r) => r.data);

export const deleteSmartAutomation = (sheetId: number, automationId: number) =>
  api.delete<{ ok: boolean }>(`/smarttable/sheets/${sheetId}/automations/${automationId}/`).then((r) => r.data);

export const exportSmartSheetCsv = (sheetId: number) =>
  api.get<Blob>(`/smarttable/sheets/${sheetId}/export.csv`, { responseType: "blob" }).then((r) => r.data);

export const importSmartSheetCsv = (sheetId: number, csvText: string) =>
  api.post<{ ok: boolean; created: number; source?: string }>(`/smarttable/sheets/${sheetId}/import.csv`, { csv: csvText }).then((r) => r.data);

export const importSmartSheetFile = (sheetId: number, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post<{ ok: boolean; created: number; source?: string; error?: string }>(
      `/smarttable/sheets/${sheetId}/import.csv`,
      form,
    )
    .then((r) => r.data);
};

export const importSmartSheetNew = (file: File, name?: string) => {
  const form = new FormData();
  form.append("file", file);
  if (name?.trim()) form.append("name", name.trim());
  return api
    .post<SmartSheetDetail & { import_meta?: { source?: string; row_count?: number; column_count?: number } }>(
      "/smarttable/sheets/import/",
      form,
    )
    .then((r) => r.data);
};
