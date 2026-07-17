import axios from "axios";
import { api } from "../../api/client";

export type NotificationMode = "person" | "group" | "none";
export type TaskPriority = "normal" | "high" | "urgent";

export interface WeComMember {
  contactId: number;
  key: string;
  name: string;
  department: string;
  departmentIds: number[];
  weComUserId: string;
  position: string;
  avatar: string;
  available: boolean;
  source: "wecom";
}

export interface WeComGroup {
  key: string;
  id: number;
  name: string;
  groupId: string;
  available: boolean;
  maskedWebhook: string;
  enabled: boolean;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastErrorReason?: string;
  accessScope: "organization" | "selected" | "owner";
  allowedUserIds: number[];
  canManage: boolean;
}

export interface TaskAssignmentValue {
  assigneeIds: string[];
  deadline: string;
  priority: TaskPriority;
  notificationMode: NotificationMode;
  groupId: string;
}

export interface WeComConfigValue {
  corpId: string;
  agentId: string;
  secret: string;
  callbackUrl: string;
  token: string;
  encodingAesKey: string;
  callbackVerified?: boolean;
  callbackVerifiedAt?: string | null;
  lastEventAt?: string | null;
  configured?: boolean;
  canManage?: boolean;
  detail?: string;
  organization?: { id: number; name: string } | null;
  ownerName?: string;
  accessScope: "organization" | "selected" | "owner";
  allowedUserIds: number[];
}

let weComMemberCache: WeComMember[] = [];
let weComGroupCache: WeComGroup[] = [];

export function getCachedWeComUsers() {
  return weComMemberCache;
}

export function getCachedWeComGroups() { return weComGroupCache; }

export async function getWeComUsers(forceRefresh = false) {
  const response = await api.request<{
    ok: boolean;
    configured: boolean;
    dataSource: "database" | "wecom_sync";
    syncedAt: string | null;
    count: number;
    results: WeComMember[];
  }>({ url: "/wecom/contacts/", method: forceRefresh ? "POST" : "GET" });
  weComMemberCache = response.data.results;
  return weComMemberCache;
}

export function getWeComApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return String(error.response?.data?.detail || "企业微信通讯录同步失败，请稍后重试。");
  }
  return error instanceof Error ? error.message : "企业微信通讯录同步失败，请稍后重试。";
}

export async function getWeComGroups() {
  const response = await api.get<{ ok: boolean; count: number; results: Array<{ id: number; name: string; maskedWebhook: string; enabled: boolean; accessScope: "organization" | "selected" | "owner"; allowedUserIds: number[]; canManage: boolean; last_success_at?: string | null; last_failure_at?: string | null; last_error_reason?: string }> }>("/wecom/group-webhooks/");
  weComGroupCache = response.data.results.map((item) => ({
    key: `webhook:${item.id}`, id: item.id, name: item.name, groupId: String(item.id),
    maskedWebhook: item.maskedWebhook, available: item.enabled, enabled: item.enabled,
    accessScope: item.accessScope, allowedUserIds: item.allowedUserIds || [], canManage: item.canManage,
    lastSuccessAt: item.last_success_at, lastFailureAt: item.last_failure_at, lastErrorReason: item.last_error_reason,
  }));
  return weComGroupCache;
}

export const createWeComGroupWebhook = (name: string, webhookUrl: string, accessScope: WeComGroup["accessScope"], allowedUserIds: number[]) =>
  api.post("/wecom/group-webhooks/", { name, webhookUrl, accessScope, allowedUserIds }).then((response) => response.data);
export const deleteWeComGroupWebhook = (id: number) =>
  api.delete(`/wecom/group-webhooks/${id}/`).then((response) => response.data);
export const updateWeComGroupWebhook = (id: number, body: { name?: string; webhookUrl?: string; enabled?: boolean; accessScope?: WeComGroup["accessScope"]; allowedUserIds?: number[] }) =>
  api.patch(`/wecom/group-webhooks/${id}/`, body).then((response) => response.data);
export const testWeComGroupWebhook = (id: number) =>
  api.post(`/wecom/group-webhooks/${id}/test/`, {}).then((response) => response.data);

export async function testWeComConfig(_config: WeComConfigValue) {
  return api.post<{ ok: boolean; appName: string; visibleMembers: number; permission: string }>(
    "/wecom/config/test/",
    { corpId: _config.corpId, agentId: _config.agentId, secret: _config.secret },
  ).then((response) => response.data);
}

export async function saveWeComConfig(_config: WeComConfigValue) {
  return api
    .put<WeComConfigValue & { ok: boolean; configured: boolean; updatedAt: string | null }>(
      "/wecom/config/",
      {
        corpId: _config.corpId,
        agentId: _config.agentId,
        secret: _config.secret,
        accessScope: _config.accessScope,
        allowedUserIds: _config.allowedUserIds,
      },
    )
    .then((response) => response.data);
}

export async function getWeComConfig() {
  return api
    .get<WeComConfigValue & { ok: boolean; configured: boolean; updatedAt: string | null }>(
      "/wecom/config/",
    )
    .then((response) => response.data);
}

export async function sendTaskNotification(assignment: TaskAssignmentValue, context: { task: string; agentName: string; targetLabel: string; taskTraceId?: string }) {
  const recipientUserIds = weComMemberCache
    .filter((member) => assignment.assigneeIds.includes(member.key))
    .map((member) => member.weComUserId);
  const group = weComGroupCache.find((item) => item.key === assignment.groupId);
  return api.post<{ ok: boolean; notification: { id: number; status: "accepted" | "partial" | "failed"; statusLabel: string; wecom_msgid: string; invalid_users: string[]; error_reason: string; accepted_at: string | null } }>(
    "/wecom/notifications/",
    {
      mode: assignment.notificationMode,
      recipientUserIds,
      groupWebhookId: group?.id,
      task: context.task,
      agentName: context.agentName,
      deadline: assignment.deadline,
      priority: assignment.priority,
      targetLabel: context.targetLabel,
      taskTraceId: context.taskTraceId,
      idempotencyKey: context.taskTraceId ? `${context.taskTraceId}:${assignment.notificationMode}` : undefined,
    },
  ).then((response) => response.data);
}

export const DEFAULT_WECOM_CONFIG: WeComConfigValue = {
  corpId: "",
  agentId: "",
  secret: "",
  callbackUrl: "",
  token: "",
  encodingAesKey: "",
  accessScope: "organization",
  allowedUserIds: [],
};
