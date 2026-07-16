export type TaskBusinessStatus = "success" | "partial_success" | "failed";

export interface TaskBusinessResult {
  status: TaskBusinessStatus;
  title: string;
  description: string;
  completedAt?: string;
  duration?: string;
  executor?: { agentName: string; ownerName?: string };
  summary: Array<{ id: string; text: string; type?: "success" | "info" | "warning" }>;
  metrics?: Array<{ label: string; value: string | number; unit?: string }>;
  deliverables?: Array<{
    id: string;
    name: string;
    filename?: string;
    type: "file" | "document" | "link" | "data";
    format?: string;
    size?: string;
    createdAt?: string;
    previewUrl?: string;
    downloadUrl?: string;
  }>;
  attentionItems?: Array<{
    id: string;
    title: string;
    description?: string;
    severity: "notice" | "important" | "urgent";
    suggestedAction?: string;
  }>;
  notification?: {
    recordId?: number;
    channel: "wecom_person" | "wecom_group";
    targetName: string;
    status: "pending" | "retry_waiting" | "accepted" | "partial" | "sent" | "delivered" | "failed";
    sentAt?: string;
    failureReason?: string;
  };
  availableActions?: Array<{ key: string; label: string; type: "primary" | "secondary" }>;
  technicalDetails?: {
    taskId?: string;
    sopId?: string;
    traceId?: string;
    rawResult?: unknown;
    logs?: string[];
    errorCode?: string;
  };
}

export interface TaskBusinessResultContext {
  decision?: string;
  action?: string;
  traceId?: string;
  agentName?: string;
  ownerName?: string;
  completedAt?: number;
  startedAt?: number;
  notification?: TaskBusinessResult["notification"];
}

const ERROR_MESSAGES: Record<string, string> = {
  WEWORK_USER_NOT_BOUND: "任务负责人尚未绑定企业微信账号。",
  WEWORK_NO_PERMISSION: "企业微信应用没有向该成员发送消息的权限。",
  DATA_SOURCE_TIMEOUT: "数据源响应时间过长，本次未能获取完整数据。",
  DATA_EMPTY: "所选时间范围内没有找到可处理的数据。",
  SOP_NODE_FAILED: "任务执行到数据处理环节时出现问题。",
  FILE_GENERATE_FAILED: "任务数据已经处理完成，但交付文件生成失败。",
};

const ACTION_NAMES: Record<string, string> = {
  "report.generate": "运营日报",
  "price_change.apply": "商品调价任务",
  "purchase.create": "采购任务",
  "jackyun.sync": "业务数据同步",
};

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

function formatDateTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(startedAt?: number, completedAt?: number) {
  if (!startedAt || !completedAt || completedAt < startedAt) return undefined;
  const seconds = Math.max(1, Math.round((completedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function errorMessage(code: string, raw: Record<string, unknown>) {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  const safeMessage = String(raw.user_message || raw.failure_reason || "");
  return safeMessage || "任务执行过程中出现异常，请稍后重试；如多次失败，请联系技术人员。";
}

function extractMetrics(raw: Record<string, unknown>) {
  const mappings = [
    [["cleaned_count", "processed_count", "order_count"], "处理记录", "条"],
    [["platform_count"], "涉及平台", "个"],
    [["abnormal_count", "warning_count"], "发现异常", "项"],
    [["file_count"], "生成文件", "份"],
  ] as const;
  return mappings.flatMap(([keys, label, unit]) => {
    const key = keys.find((candidate) => typeof raw[candidate] === "number");
    return key ? [{ label, value: Number(raw[key]).toLocaleString("zh-CN"), unit }] : [];
  }).slice(0, 4);
}

function extractDeliverables(raw: Record<string, unknown>, createdAt: string): TaskBusinessResult["deliverables"] {
  const collection = Array.isArray(raw.deliverables) ? raw.deliverables
    : Array.isArray(raw.files) ? raw.files : [];
  const deliverables = collection.map((item, index) => {
    const file = asRecord(item);
    return {
      id: String(file.id || `deliverable-${index}`),
      name: String(file.name || file.filename || `任务交付文件 ${index + 1}`),
      filename: file.filename ? String(file.filename) : undefined,
      type: (file.type === "document" || file.type === "link" || file.type === "data" ? file.type : "file") as "file" | "document" | "link" | "data",
      format: String(file.format || file.file_type || "文件"),
      size: file.size ? String(file.size) : undefined,
      createdAt: String(file.created_at || createdAt),
      previewUrl: file.preview_url ? String(file.preview_url) : undefined,
      downloadUrl: file.download_url ? String(file.download_url) : undefined,
    };
  });
  const outputUrl = raw.download_url || raw.file_url;
  if (!deliverables.length && (outputUrl || raw.output_file_name)) {
    deliverables.push({
      id: "output-file",
      name: String(raw.output_file_name || "任务交付文件"),
      filename: raw.output_file_name ? String(raw.output_file_name) : undefined,
      type: "file",
      format: String(raw.file_type || "文件"),
      size: raw.file_size ? String(raw.file_size) : undefined,
      createdAt,
      previewUrl: raw.preview_url ? String(raw.preview_url) : undefined,
      downloadUrl: outputUrl ? String(outputUrl) : undefined,
    });
  }
  return deliverables;
}

export function formatTaskBusinessResult(rawResult: unknown, context: TaskBusinessResultContext = {}): TaskBusinessResult {
  const raw = asRecord(rawResult);
  const errorCode = String(raw.error_code || raw.code || "");
  const failed = context.decision === "block" || raw.ok === false || Boolean(errorCode);
  const notificationFailed = context.notification?.status === "failed" || context.notification?.status === "partial";
  const partial = !failed && (notificationFailed || raw.partial_success === true || raw.status === "partial_success");
  const status: TaskBusinessStatus = failed ? "failed" : partial ? "partial_success" : "success";
  const businessName = ACTION_NAMES[context.action || ""] || "任务";
  const completedAt = context.completedAt || Date.now();
  const completedAtLabel = formatDateTime(completedAt);
  const description = status === "failed"
    ? errorMessage(errorCode, raw)
    : status === "partial_success"
      ? `${businessName}主要内容已完成，但仍有事项需要处理。`
      : `${businessName}已完成${context.ownerName ? `，结果已通知${context.ownerName}` : ""}。`;

  const rawSummary = Array.isArray(raw.business_summary) ? raw.business_summary.map(String) : [];
  const summary = rawSummary.length ? rawSummary.map((text, index) => ({ id: `summary-${index}`, text, type: "info" as const })) : [
    {
      id: "execution",
      text: status === "failed" ? `${businessName}未能完成，请根据下方提示处理。` : `${businessName}已完成业务处理。`,
      type: status === "failed" ? "warning" as const : "success" as const,
    },
    ...(context.notification ? [{
      id: "notification",
      text: context.notification.status === "failed"
        ? `向${context.notification.targetName}发送企业微信通知失败。`
        : context.notification.status === "partial"
          ? `企业微信已受理通知，但部分接收人无效。`
          : `企业微信已受理发给${context.notification.targetName}的通知。`,
      type: context.notification.status === "failed" || context.notification.status === "partial" ? "warning" as const : "success" as const,
    }] : []),
  ];

  return {
    status,
    title: status === "success" ? "任务已完成" : status === "partial_success" ? "任务部分完成" : "任务执行失败",
    description,
    completedAt: completedAtLabel,
    duration: formatDuration(context.startedAt, completedAt),
    executor: { agentName: context.agentName || "执行智能体", ownerName: context.ownerName },
    summary,
    metrics: extractMetrics(raw),
    deliverables: extractDeliverables(raw, completedAtLabel),
    attentionItems: failed ? [{
      id: "execution-error",
      title: errorMessage(errorCode, raw),
      severity: "important",
      suggestedAction: "检查任务参数或数据源状态后重新执行。",
    }] : [],
    notification: context.notification,
    availableActions: status === "failed"
      ? [{ key: "retry", label: "修改参数后重试", type: "primary" }]
      : status === "partial_success"
        ? [{ key: "handle", label: "处理未完成事项", type: "primary" }, { key: "retry-notification", label: "重新发送通知", type: "secondary" }]
        : [{ key: "view", label: "查看完整结果", type: "primary" }, { key: "export", label: "导出结果", type: "secondary" }, { key: "notify", label: "发送给其他人", type: "secondary" }, { key: "follow", label: "创建跟进任务", type: "secondary" }],
    technicalDetails: {
      traceId: context.traceId,
      sopId: context.action,
      rawResult,
      errorCode: errorCode || undefined,
    },
  };
}

const previewCommon = {
  completedAt: "2026年7月16日 10:32",
  duration: "2 分 18 秒",
  executor: { agentName: "运营智能体", ownerName: "谢依萍" },
  metrics: [
    { label: "处理订单", value: "12,568", unit: "条" },
    { label: "涉及平台", value: 3, unit: "个" },
    { label: "发现异常", value: 3, unit: "项" },
    { label: "生成文件", value: 1, unit: "份" },
  ],
  deliverables: [{ id: "report", name: "昨日运营日报", type: "file" as const, format: "Excel 报表", size: "2.4 MB", createdAt: "今天 10:32" }],
  technicalDetails: { taskId: "TASK-20260716-0188", sopId: "report.generate", traceId: "e8d1a35c92b7", rawResult: { ok: true, cleaned_count: 12568, output_file_id: "file-0188", wecom_send_status: "delivered" }, logs: ["数据读取完成", "日报文件生成完成", "企业微信通知发送完成"] },
};

export const TASK_RESULT_PREVIEWS: Record<TaskBusinessStatus, TaskBusinessResult> = {
  success: {
    ...previewCommon,
    status: "success", title: "任务已完成", description: "昨日运营日报已生成，并成功发送给谢依萍。",
    summary: ["已获取天猫、抖音和唯品会昨日经营数据", "共处理 12,568 条订单记录", "已生成昨日运营日报", "发现 3 项需要关注的数据异常", "报告已保存至“运营日报”文件夹", "企业微信通知已发送给谢依萍"].map((text, index) => ({ id: `s-${index}`, text, type: "success" })),
    attentionItems: [
      { id: "a1", title: "抖音昨日退款率上升", description: "退款率为 8.6%，较前一日上升 2.1%", severity: "important", suggestedAction: "检查退款订单原因并联系渠道负责人。" },
      { id: "a2", title: "唯品会库存需要补充", description: "17 个商品库存低于安全库存", severity: "notice", suggestedAction: "生成补货清单并确认采购计划。" },
      { id: "a3", title: "天猫订单待对账", description: "6 笔订单尚未完成对账", severity: "notice", suggestedAction: "通知财务负责人跟进。" },
    ],
    notification: { channel: "wecom_person", targetName: "谢依萍", status: "delivered", sentAt: "今天 10:32" },
    availableActions: [{ key: "view", label: "查看完整日报", type: "primary" }, { key: "notify", label: "通知负责人", type: "secondary" }, { key: "follow", label: "创建跟进任务", type: "secondary" }],
  },
  partial_success: {
    ...previewCommon,
    status: "partial_success", title: "任务部分完成", description: "日报已经生成，但企业微信通知发送失败。",
    summary: [
      { id: "p1", text: "已完成昨日经营数据处理并生成运营日报。", type: "success" },
      { id: "p2", text: "企业微信通知未能发送给谢依萍。", type: "warning" },
    ],
    attentionItems: [{ id: "p3", title: "负责人通知未送达", description: "企业微信应用没有向该成员发送消息的权限。", severity: "important", suggestedAction: "调整应用可见范围后重新发送。" }],
    notification: { channel: "wecom_person", targetName: "谢依萍", status: "failed", failureReason: ERROR_MESSAGES.WEWORK_NO_PERMISSION },
    availableActions: [{ key: "handle", label: "处理未完成事项", type: "primary" }, { key: "retry-notification", label: "重新发送", type: "secondary" }],
  },
  failed: {
    ...previewCommon,
    status: "failed", title: "任务执行失败", description: "未能获取昨日的抖音数据，因此无法生成完整日报。",
    metrics: [], deliverables: [],
    summary: [{ id: "f1", text: "天猫和唯品会数据已读取，抖音数据获取失败。", type: "warning" }, { id: "f2", text: "运营日报未生成，企业微信通知未发送。", type: "warning" }],
    attentionItems: [{ id: "f3", title: "抖音数据源响应超时", description: ERROR_MESSAGES.DATA_SOURCE_TIMEOUT, severity: "urgent", suggestedAction: "确认数据源恢复后修改参数并重试。" }],
    notification: { channel: "wecom_person", targetName: "谢依萍", status: "failed", failureReason: "任务未完成，因此未发送通知。" },
    availableActions: [{ key: "retry", label: "修改参数后重试", type: "primary" }, { key: "export", label: "导出错误信息", type: "secondary" }],
    technicalDetails: { ...previewCommon.technicalDetails, rawResult: { ok: false, error_code: "DATA_SOURCE_TIMEOUT", node: "fetch_douyin", status: 500 }, errorCode: "DATA_SOURCE_TIMEOUT" },
  },
};
