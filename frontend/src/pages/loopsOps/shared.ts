import "./loopsOps.css";

export const PHASE_META: Record<string, { label: string; tone: string }> = {
  observe: { label: "观察", tone: "obs" },
  orient: { label: "理解", tone: "ori" },
  decide: { label: "决策", tone: "dec" },
  act: { label: "执行", tone: "act" },
  learn: { label: "学习", tone: "learn" },
  idle: { label: "空闲", tone: "idle" },
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  candidate: "候选",
  active: "运行中",
  paused: "暂停",
  error: "异常",
  archived: "已归档",
  pending: "排队",
  running: "运行中",
  awaiting_confirm: "待确认",
  completed: "完成",
  failed: "失败",
};

export function statusClass(status?: string) {
  if (!status) return "";
  if (status === "active" || status === "running" || status === "completed") return "ok";
  if (status === "error" || status === "failed") return "bad";
  if (status === "paused" || status === "awaiting_confirm" || status === "pending") return "warn";
  return "";
}
