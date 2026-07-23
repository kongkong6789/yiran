import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BranchesOutlined,
  CheckCircleFilled,
  CheckSquareOutlined,
  CloseCircleFilled,
  CodeOutlined,
  CommentOutlined,
  CopyOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LoadingOutlined,
  MoreOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  ShoppingOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { App, Avatar, Button, Dropdown, Empty, Image, Input, Modal, Select, Space, Spin, Table, Tabs, Tag, Tooltip } from "antd";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  analyzeSopEvolution,
  acceptSopEvolutionProposal,
  createSop,
  createSopVersion,
  deleteSop,
  draftSopEvolutionProposal,
  duplicateSop,
  getCatalog,
  getMe,
  getMetricContracts,
  getSop,
  getSopEvolutionMetrics,
  getSopRun,
  getSopVersion,
  getSourceSnapshots,
  listKnowledgeBases,
  listSopEvolutionProposals,
  listSopEvolutionSignals,
  listSopRuns,
  listSops,
  listSopVersions,
  publishSopVersion,
  rejectSopEvolutionProposal,
  rewriteSopWithAi,
  rewriteSopWithAiStream,
  trialSopEvolutionProposal,
  trialSopVersion,
  trialSopVersionStream,
  updateSop,
  updateSopVersion,
  type ActionContract,
  type AuthUser,
  type KnowledgeBaseItem,
  type SopDefinitionItem,
  type SopDraftPayload,
  type SopEvolutionProposalItem,
  type SopEvolutionSignalItem,
  type SopGraphNode,
  type SopRunItem,
  type SopVersionItem,
} from "../api/client";
import { authenticatedAvatarUrl } from "../utils/avatar";
import ChatMarkdown from "../components/ChatMarkdown";
import SopBusinessNodePanel, { buildDataAssetOptions, fieldLabel, normalizeFieldKeys, type DataAssetOption } from "./sopBusinessPanel";

const SOP_AI_AVATAR_URL =
  "https://yiran-1301008423.cos.ap-guangzhou.myqcloud.com/media/branding/sop-ai-avatar.png";
const SOP_AI_AVATAR_FALLBACK = "/sop-ai-avatar.png";

const EMPTY_BINDINGS = {
  snapshot_ids: [] as number[],
  metric_ids: [] as string[],
  asset_keys: [] as string[],
  scope: "",
  brand_ids: [] as string[],
};

const EMPTY_KNOWLEDGE = {
  knowledge_base_ids: [] as number[],
  retrieval_hint: "",
};

const SOP_RUN_STATUS_LABEL: Record<string, string> = {
  running: "运行中",
  need_input: "等待输入",
  completed: "已完成",
  failed: "失败",
  handoff: "转人工",
};

const SOP_SIGNAL_LABEL: Record<string, string> = {
  need_input_loop: "反复等待输入",
  checkpoint_reject: "确认驳回",
  action_fail: "动作失败",
  handoff: "转人工",
  slow_node: "节点偏慢",
  unused_branch: "冷门分支",
  missing_field_repeat: "字段反复缺失",
};

const SOP_PROPOSAL_STATUS: Record<string, string> = {
  proposed: "已提出",
  validated: "已校验",
  trial_passed: "试跑通过",
  trial_failed: "试跑失败",
  drafted: "已生成草稿",
  accepted: "已采纳",
  rejected: "已拒绝",
  expired: "已过期",
};

const EMPTY_NODE_CONFIG = (actionName = "report.generate") => ({
  instruction: "",
  expected_user_info: [] as string[],
  required_fields: [] as string[],
  allowed_actions: ["ask_user", "continue_flow"] as string[],
  knowledge_scope: { ...EMPTY_KNOWLEDGE },
  data_bindings: { ...EMPTY_BINDINGS },
  action_name: actionName,
  detail: "",
  message: "",
});

const EMPTY_GRAPH: SopDraftPayload["graph"] = {
  start: "collect.scope",
  terminals: ["finish"],
  nodes: [
    {
      key: "collect.scope",
      type: "collect_info",
      title: "确认任务所需信息",
      config: {
        ...EMPTY_NODE_CONFIG(),
        instruction: "确认任务日期、品牌和数据范围等必要信息",
        allowed_actions: ["ask_user", "continue_flow"],
      },
    },
    {
      key: "data.bind",
      type: "data_bind",
      title: "选用企业数据",
      config: {
        ...EMPTY_NODE_CONFIG(),
        instruction: "选择本流程要用的销售、库存等可信业务数据",
        allowed_actions: ["continue_flow"],
        action_name: "",
      },
    },
    {
      key: "execute",
      type: "execute_action",
      title: "生成业务结果",
      config: {
        ...EMPTY_NODE_CONFIG("report.generate"),
        instruction: "基于已选企业数据完成分析并产出结果",
        allowed_actions: ["continue_flow", "call_action:report.generate"],
        action_name: "report.generate",
      },
    },
    {
      key: "finish",
      type: "end",
      title: "完成并留存",
      config: {
        ...EMPTY_NODE_CONFIG(""),
        instruction: "把结果写回任务，并留存证据",
        allowed_actions: ["continue_flow"],
        action_name: "",
      },
    },
  ],
  edges: [
    { source: "collect.scope", target: "data.bind", condition: "always", priority: 1 },
    { source: "data.bind", target: "execute", condition: "always", priority: 1 },
    { source: "execute", target: "finish", condition: "decision:allow", priority: 1 },
    { source: "execute", target: "finish", condition: "decision:block", priority: 2 },
  ],
};

const EMPTY_DRAFT: SopDraftPayload = {
  key: "",
  name: "新建 SOP",
  businessDomain: "",
  description: "",
  actionName: "report.generate",
  version: "1.0.0",
  triggerIntents: [],
  utteranceExamples: [],
  graph: EMPTY_GRAPH,
};

type SopToolStep = { name: string; summary: string; status: "ok" | "failed" | "running" | "waiting" };
type TrialLog = { time: string; text: string; status: "ok" | "failed" | "running" | "waiting" };
type TrialArtifact = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  content: string;
};
type TrialPendingConfirm = {
  kind: string;
  nodeKey: string;
  title: string;
  instruction: string;
  missing?: string[];
};
type TrialRunState = {
  status: "running" | "completed" | "failed" | "awaiting_confirm";
  total: number;
  current: number;
  currentTitle: string;
  logs: TrialLog[];
  startedAt?: number;
  durationSec?: number;
  outputLabel?: string;
  artifacts?: TrialArtifact[];
  note?: string;
  pushedToUser?: boolean;
  involvesPush?: boolean;
  pendingConfirm?: TrialPendingConfirm;
};
type FlowChangeInfo = {
  added: string[];
  removed: string[];
  modified: string[];
  chain: string[];
  applied: boolean;
  undone?: boolean;
};
type RewriteTimelineKind = "hello" | "status" | "tool" | "stream" | "heartbeat" | "done" | "error";
type RewriteTimelineEvent = {
  id: string;
  kind: RewriteTimelineKind;
  time: string;
  title: string;
  detail?: string;
  status: "ok" | "running" | "failed" | "waiting";
};
type RewriteStreamState = {
  status: "running" | "completed" | "failed";
  startedAt: number;
  events: RewriteTimelineEvent[];
  streamChars?: number;
  currentHint?: string;
  tools?: SopToolStep[];
  durationSec?: number;
};
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  images?: string[];
  tools?: SopToolStep[];
  toolsLive?: boolean;
  rewrite?: RewriteStreamState;
  trial?: TrialRunState;
  flowChange?: FlowChangeInfo;
  undoDraft?: SopDraftPayload;
  createdAt?: number;
};
type FlowNodeData = {
  kind: "meta" | "step";
  draft: SopDraftPayload;
  step?: SopGraphNode;
  index?: number;
  selected?: boolean;
  connectable?: boolean;
  actionTitles?: Record<string, string>;
  onSelect?: (key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
};

function mapToolStatus(status?: string): SopToolStep["status"] {
  if (status === "failed" || status === "running" || status === "waiting") return status;
  return "ok";
}

function isTrialIntent(text: string): boolean {
  const value = text.trim().replace(/^【[^】]*】\s*/, "").trim();
  if (!value || value.length > 64) return false;
  // Explicit edit requests should not be hijacked by the word “试跑”.
  if (/(改成|增加步骤|删除步骤|修改流程|调整流程|重写流程|换成|加上一步|去掉一步)/.test(value)) {
    return false;
  }
  return /(试跑|试运行|跑一[下遍]|跑流程|执行(一下|一遍)?(这个|本|当前)?流程|帮我跑|直接跑|dry[\s-]?run|(^|\s)run(\s|$))/i.test(value);
}

function isConsultIntent(text: string): boolean {
  const value = text.trim().replace(/^【[^】]*】\s*/, "").trim();
  if (!value) return false;
  if (/(改成|修改流程|调整流程|重写流程|重建|增加步骤|添加步骤|删除步骤|去掉一步|加上一步|插入|换成|生成流程|创建流程|优化整条|帮我改|把步骤)/.test(value)) {
    return false;
  }
  if (/(有哪些|哪些技能|哪些能力|什么技能|什么能力|可用技能|可用能力|业务能力|怎么用|如何用|是什么|说明一下|解释一下|当前流程|支持哪些|能做什么|有没有|哪些动作|技能列表|能力列表|怎么试跑|什么意思|为什么)/.test(value)) {
    return true;
  }
  return /[吗呢么？?]\s*$/.test(value);
}

const SOP_TOOL_LABELS: Record<string, string> = {
  read_graph: "读取当前流程",
  read_intent: "理解你的意图",
  list_actions: "查阅可用业务能力",
  answer: "回答问题",
  rewrite_flow: "改写整条流程",
  rewrite_nodes: "修改选中步骤",
  llm_rewrite: "调用模型改写",
  validate_graph: "校验流程连线",
  bind_assets: "绑定企业数据",
  bind_actions: "绑定业务能力",
  apply_draft: "写入流程草稿",
  scaffold_flow: "搭建流程步骤",
  repair_json: "修复流程结构",
};

function formatSopToolLabel(tool: { name: string; summary?: string }): string {
  const friendly = SOP_TOOL_LABELS[tool.name] || tool.summary || tool.name;
  const summary = String(tool.summary || "").trim();
  if (summary && summary !== friendly && !friendly.includes(summary)) {
    return `${friendly} · ${summary}`;
  }
  return friendly;
}

function errorText(error: unknown, fallback: string, kind: "trial" | "rewrite" | "generic" = "generic") {
  const err = error as {
    code?: string;
    response?: { status?: number; data?: { error?: string; detail?: string; message?: string } };
    message?: string;
  };
  const data = err?.response?.data;
  const fromApi = data?.error || data?.detail || data?.message;
  if (fromApi) return String(fromApi);
  if (err?.code === "ECONNABORTED" || /timeout/i.test(String(err?.message || ""))) {
    if (kind === "trial") {
      return "试跑超时了。流程执行可能仍在后台完成，请稍后重试或简化流程后再跑。";
    }
    if (kind === "rewrite") {
      return "AI 改写超时了。整条流程改写耗时较长，可改为选中单个步骤再改，或把需求写得更具体后重试。";
    }
    return "请求超时，请稍后重试。";
  }
  if (err?.response?.status === 404) {
    return kind === "trial" ? "试跑接口不存在，请确认后端已重启。" : "接口不存在，请确认后端已重启。";
  }
  if (err?.message && /network|failed/i.test(err.message)) return `网络异常：${err.message}`;
  return fallback;
}

function defaultWelcome(name?: string, nodes: SopGraphNode[] = []): ChatMessage {
  const titles = nodes.map((node) => node.title).filter(Boolean);
  const list = titles.length
    ? titles.map((title, index) => `${index + 1}. ${title}`).join("\n")
    : "1. 先描述目标，我会帮你生成步骤";
  return {
    id: "welcome",
    role: "assistant",
    createdAt: Date.now(),
    content: name
      ? `已加载「${name}」。\n\n当前流程包含：\n${list}\n\n你可以：\n- 修改任意步骤\n- 直接描述需求\n- 上传流程截图\n- 说「跑一遍流程」试跑`
      : `你好，我是流程协作助手。\n\n当前还是空白流程，你可以：\n${list}\n\n也可以上传截图，或直接说「跑一遍流程」验证。`,
  };
}

function mainFlowChain(draft: SopDraftPayload): string[] {
  const nodes = draft.graph.nodes || [];
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of draft.graph.edges || []) {
    const list = outgoing.get(edge.source) || [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor = draft.graph.start || nodes[0]?.key || "";
  while (cursor && byKey.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byKey.get(cursor);
    chain.push(node?.title || cursor);
    const terminals = new Set(draft.graph.terminals || []);
    if (terminals.has(cursor) || node?.type === "end") break;
    const nexts = outgoing.get(cursor) || [];
    cursor = nexts[0] || "";
  }
  // Append any remaining nodes not on the main path so removals still show in diff,
  // but prefer the executable path first.
  for (const node of nodes) {
    if (!seen.has(node.key)) chain.push(node.title || node.key);
  }
  return chain;
}

function diffFlowChange(before: SopDraftPayload, after: SopDraftPayload): Omit<FlowChangeInfo, "applied" | "undone"> {
  const beforeMap = new Map(before.graph.nodes.map((node) => [node.key, node]));
  const afterMap = new Map(after.graph.nodes.map((node) => [node.key, node]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  after.graph.nodes.forEach((node) => {
    const prev = beforeMap.get(node.key);
    if (!prev) added.push(node.title || node.key);
    else if (JSON.stringify(prev) !== JSON.stringify(node)) modified.push(node.title || node.key);
  });
  before.graph.nodes.forEach((node) => {
    if (!afterMap.has(node.key)) removed.push(node.title || node.key);
  });
  return {
    added,
    removed,
    modified,
    chain: mainFlowChain(after),
  };
}

function chatFromVersion(version?: SopVersionItem, fallbackName?: string, nodes: SopGraphNode[] = []): ChatMessage[] {
  const rows = version?.editorChat;
  if (!Array.isArray(rows) || !rows.length) return [defaultWelcome(fallbackName, nodes)];
  const restored = rows
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && String(item.content || "").trim())
    .map((item, index): ChatMessage => {
      const rawTrial = (item as { trial?: TrialRunState }).trial;
      const rawChange = (item as { flowChange?: FlowChangeInfo }).flowChange;
      return {
        id: item.id || `restored-${index}`,
        role: item.role,
        content: item.content,
        model: item.model,
        images: item.images,
        tools: (item.tools || []).map((tool) => ({
          name: tool.name,
          summary: tool.summary,
          status: mapToolStatus(tool.status),
        })),
        trial: rawTrial && typeof rawTrial === "object"
          ? {
              status: (
                rawTrial.status === "running"
                  ? "completed"
                  : rawTrial.status === "awaiting_confirm"
                    ? "awaiting_confirm"
                    : rawTrial.status === "failed"
                      ? "failed"
                      : "completed"
              ) as TrialRunState["status"],
              total: Number(rawTrial.total) || 0,
              current: Number(rawTrial.current) || 0,
              currentTitle: String(rawTrial.currentTitle || ""),
              durationSec: Number(rawTrial.durationSec) || undefined,
              outputLabel: rawTrial.outputLabel ? String(rawTrial.outputLabel) : undefined,
              note: rawTrial.note ? String(rawTrial.note) : undefined,
              involvesPush: typeof rawTrial.involvesPush === "boolean" ? rawTrial.involvesPush : undefined,
              pushedToUser: typeof rawTrial.pushedToUser === "boolean" ? rawTrial.pushedToUser : undefined,
              pendingConfirm: rawTrial.pendingConfirm && typeof rawTrial.pendingConfirm === "object"
                ? {
                    kind: String(rawTrial.pendingConfirm.kind || "checkpoint"),
                    nodeKey: String(rawTrial.pendingConfirm.nodeKey || ""),
                    title: String(rawTrial.pendingConfirm.title || "人工确认"),
                    instruction: String(rawTrial.pendingConfirm.instruction || ""),
                    missing: Array.isArray(rawTrial.pendingConfirm.missing)
                      ? rawTrial.pendingConfirm.missing.map(String)
                      : undefined,
                  }
                : undefined,
              artifacts: Array.isArray(rawTrial.artifacts)
                ? rawTrial.artifacts.map((artifact) => ({
                    id: String(artifact.id || "artifact"),
                    kind: String(artifact.kind || "text"),
                    title: String(artifact.title || "产物"),
                    summary: String(artifact.summary || ""),
                    content: String(artifact.content || "").slice(0, 20000),
                  }))
                : undefined,
              logs: Array.isArray(rawTrial.logs)
                ? rawTrial.logs.map((log) => ({
                    time: String(log.time || ""),
                    text: String(log.text || ""),
                    status: mapToolStatus(log.status) as TrialLog["status"],
                  }))
                : [],
            }
          : undefined,
        flowChange: rawChange && typeof rawChange === "object"
          ? {
              added: Array.isArray(rawChange.added) ? rawChange.added.map(String) : [],
              removed: Array.isArray(rawChange.removed) ? rawChange.removed.map(String) : [],
              modified: Array.isArray(rawChange.modified) ? rawChange.modified.map(String) : [],
              chain: Array.isArray(rawChange.chain) ? rawChange.chain.map(String) : [],
              applied: Boolean(rawChange.applied),
              undone: Boolean(rawChange.undone),
            }
          : undefined,
      };
    });
  return restored.length ? restored : [defaultWelcome(fallbackName, nodes)];
}

function persistableChat(messages: ChatMessage[]) {
  return messages
    .filter((item) => item.id !== "welcome" || messages.length === 1)
    .slice(-60)
    .map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      model: item.model || "",
      tools: (item.tools || []).map((tool) => ({
        name: tool.name,
        summary: tool.summary,
        status: tool.status,
      })),
      images: (item.images || []).filter((url) => url.startsWith("http://") || url.startsWith("https://")).slice(0, 4),
      trial: item.trial
        ? {
            status: item.trial.status === "running" ? "completed" : item.trial.status,
            total: item.trial.total,
            current: item.trial.current,
            currentTitle: item.trial.currentTitle,
            durationSec: item.trial.durationSec,
            outputLabel: item.trial.outputLabel,
            note: item.trial.note,
            involvesPush: item.trial.involvesPush,
            pushedToUser: item.trial.pushedToUser,
            pendingConfirm: item.trial.pendingConfirm,
            artifacts: (item.trial.artifacts || []).map((artifact) => ({
              ...artifact,
              content: artifact.content.slice(0, 12000),
            })).slice(0, 4),
            logs: item.trial.logs.slice(-20),
          }
        : undefined,
      flowChange: item.flowChange
        ? {
            added: item.flowChange.added,
            removed: item.flowChange.removed,
            modified: item.flowChange.modified,
            chain: item.flowChange.chain,
            applied: item.flowChange.applied,
            undone: item.flowChange.undone,
          }
        : undefined,
    }));
}

function SopPreviewableAvatar({
  src,
  onError,
}: {
  src?: string;
  onError?: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const url = src || "";
  return (
    <>
      <Avatar
        size={32}
        className={`sop-chat-avatar${url ? " is-previewable" : ""}`}
        src={url || undefined}
        icon={!url ? <UserOutlined /> : undefined}
        onClick={() => {
          if (url) setOpen(true);
        }}
        onError={onError}
      />
      {url ? (
        <Image
          wrapperStyle={{ display: "none" }}
          src={url}
          preview={{
            visible: open,
            src: url,
            onVisibleChange: (visible) => setOpen(visible),
          }}
        />
      ) : null}
    </>
  );
}

function SopAiAvatar() {
  const [src, setSrc] = useState(SOP_AI_AVATAR_URL);
  return (
    <SopPreviewableAvatar
      src={src}
      onError={() => {
        setSrc(SOP_AI_AVATAR_FALLBACK);
        return true;
      }}
    />
  );
}

function formatChatClock(ts?: number) {
  return new Date(ts || Date.now()).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTrialClock(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function SopToolProcess({
  tools,
  live = false,
  liveHint = "",
}: {
  tools: SopToolStep[];
  live?: boolean;
  liveHint?: string;
}) {
  if (!tools.length && !liveHint) return null;
  const running = tools.find((tool) => tool.status === "running");
  return (
    <div className={`sop-tool-process-wrap${live ? " is-live" : ""}`}>
      {live && (
        <p className="sop-tool-live-hint">
          <LoadingOutlined spin />
          <span>{liveHint || (running ? `正在${formatSopToolLabel(running)}…` : "正在处理…")}</span>
        </p>
      )}
      {!!tools.length && (
        <ul className="sop-tool-process">
          {tools.map((tool, index) => {
            const label = formatSopToolLabel(tool);
            return (
              <li key={`${tool.name}-${index}`} className={`is-${tool.status}`}>
                {tool.status === "running" && <LoadingOutlined spin />}
                {tool.status === "ok" && <CheckCircleFilled />}
                {tool.status === "failed" && <CloseCircleFilled />}
                <span>{label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function rewriteTimelineIcon(status: RewriteTimelineEvent["status"]) {
  if (status === "running") return <LoadingOutlined spin />;
  if (status === "failed") return <CloseCircleFilled />;
  if (status === "waiting") return <HistoryOutlined />;
  return <CheckCircleFilled />;
}

function SopRewriteTimelinePanel({ rewrite }: { rewrite: RewriteStreamState }) {
  const [open, setOpen] = useState(rewrite.status === "running");
  const elapsed = rewrite.durationSec
    ?? Math.max(1, Math.round((Date.now() - rewrite.startedAt) / 1000));
  const heading = rewrite.status === "completed"
    ? "改写完成"
    : rewrite.status === "failed"
      ? "改写失败"
      : "AI 改写进行中";
  const hint = rewrite.currentHint
    || (rewrite.status === "running" ? "正在处理…" : "已记录完整过程");
  const tools = rewrite.tools || [];

  useEffect(() => {
    if (rewrite.status === "running") setOpen(true);
  }, [rewrite.status]);

  return (
    <div className={`sop-rewrite-timeline-card is-${rewrite.status}`}>
      <div className="sop-rewrite-timeline-head">
        <div>
          <strong>{heading}</strong>
          <p>{hint}</p>
        </div>
        <div className="sop-rewrite-timeline-meta">
          <span>{elapsed}s</span>
          {rewrite.streamChars ? <span>已生成 {rewrite.streamChars} 字</span> : null}
          <button type="button" onClick={() => setOpen((value) => !value)}>
            {open ? "收起过程" : "展开过程"}
          </button>
        </div>
      </div>
      {tools.length > 0 && (
        <ul className="sop-rewrite-tool-strip">
          {tools.map((tool, index) => (
            <li key={`${tool.name}-${index}`} className={`is-${tool.status}`}>
              {tool.status === "running" ? <LoadingOutlined spin /> : tool.status === "failed" ? <CloseCircleFilled /> : <CheckCircleFilled />}
              <span>{formatSopToolLabel(tool)}</span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ol className="sop-rewrite-timeline">
          {rewrite.events.map((event) => (
            <li key={event.id} className={`is-${event.status} kind-${event.kind}`}>
              <div className="sop-rewrite-timeline-dot">{rewriteTimelineIcon(event.status)}</div>
              <div className="sop-rewrite-timeline-body">
                <div className="sop-rewrite-timeline-row">
                  <strong>{event.title}</strong>
                  <time>{event.time}</time>
                </div>
                {event.detail ? <p>{event.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function appendRewriteEvent(
  rewrite: RewriteStreamState,
  event: Omit<RewriteTimelineEvent, "id" | "time"> & { id?: string; time?: string },
  mergeKind?: RewriteTimelineKind,
): RewriteStreamState {
  const next: RewriteTimelineEvent = {
    id: event.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: event.time || formatTrialClock(),
    kind: event.kind,
    title: event.title,
    detail: event.detail,
    status: event.status,
  };
  const events = [...rewrite.events];
  if (mergeKind) {
    const last = events[events.length - 1];
    if (last && last.kind === mergeKind) {
      events[events.length - 1] = { ...last, ...next, id: last.id };
      return { ...rewrite, events };
    }
  }
  return { ...rewrite, events: [...events, next].slice(-40) };
}

function finalizeRewriteEvents(rewrite: RewriteStreamState, status: "completed" | "failed"): RewriteStreamState {
  return {
    ...rewrite,
    status,
    events: rewrite.events.map((event) => (
      event.status === "running" || event.status === "waiting"
        ? { ...event, status: status === "completed" ? "ok" : "failed" }
        : event
    )),
  };
}

function looksLikeHtmlDocument(content: string): boolean {
  const trimmed = content.trim();
  return /^<!doctype html|<html[\s>]/i.test(trimmed);
}

function peelEmbeddedHtml(content: string): { html: string; markdown: string } {
  const text = String(content || "");
  if (!text.trim()) return { html: "", markdown: "" };

  const closed = text.match(/```html\s*([\s\S]*?)```/i);
  if (closed?.[1] && looksLikeHtmlDocument(closed[1])) {
    return {
      html: closed[1].trim(),
      markdown: `${text.slice(0, closed.index ?? 0)}${text.slice((closed.index ?? 0) + closed[0].length)}`.trim(),
    };
  }

  const open = text.match(/```html\s*([\s\S]*)$/i);
  if (open?.[1]) {
    const candidate = open[1].replace(/```\s*$/, "").trim();
    if (looksLikeHtmlDocument(candidate)) {
      return {
        html: candidate,
        markdown: text.slice(0, open.index ?? 0).trim(),
      };
    }
  }

  const doc = text.match(/(<!DOCTYPE\s+html[\s\S]*?<\/html>)/i);
  if (doc?.[1]) {
    return {
      html: doc[1].trim(),
      markdown: `${text.slice(0, doc.index ?? 0)}${text.slice((doc.index ?? 0) + doc[0].length)}`
        .replace(/```html\s*$/i, "")
        .replace(/^```\s*/, "")
        .trim(),
    };
  }

  if (looksLikeHtmlDocument(text)) {
    return { html: text.trim(), markdown: "" };
  }

  return { html: "", markdown: text };
}

function normalizeTrialArtifacts(artifacts: TrialArtifact[]): TrialArtifact[] {
  const next: TrialArtifact[] = [];
  const seen = new Set<string>();
  const push = (item: TrialArtifact) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    next.push(item);
  };

  artifacts.forEach((item) => {
    const content = String(item.content || "");
    const peeled = peelEmbeddedHtml(content);

    if (item.kind === "html") {
      const htmlContent = peeled.html || (looksLikeHtmlDocument(content) ? content.trim() : "");
      if (htmlContent) {
        push({
          ...item,
          kind: "html",
          title: item.title.includes("HTML") ? item.title : "经营分析报告（HTML）",
          content: htmlContent,
        });
      }
      if (peeled.markdown && !looksLikeHtmlDocument(peeled.markdown)) {
        push({
          id: `${item.id}_md`,
          kind: "markdown",
          title: "经营分析报告（Markdown）",
          summary: item.summary || "文字摘要",
          content: peeled.markdown,
        });
      }
      return;
    }

    if (peeled.html) {
      push({
        id: `${item.id}_html`,
        kind: "html",
        title: "经营分析报告（HTML）",
        summary: item.summary || "可网页预览",
        content: peeled.html,
      });
      if (peeled.markdown) {
        push({
          ...item,
          kind: "markdown",
          title: item.title.includes("Markdown") ? item.title : "经营分析报告（Markdown）",
          content: peeled.markdown,
        });
      }
      return;
    }

    push(item);
  });

  return next.sort((a, b) => Number(b.kind === "html") - Number(a.kind === "html"));
}

function extractTrialArtifacts(response: {
  artifacts?: TrialArtifact[];
  result?: Record<string, unknown>;
}): TrialArtifact[] {
  if (Array.isArray(response.artifacts) && response.artifacts.length) {
    return normalizeTrialArtifacts(response.artifacts.map((item) => ({
      id: String(item.id || "artifact"),
      kind: String(item.kind || "text"),
      title: String(item.title || "产物"),
      summary: String(item.summary || ""),
      content: String(item.content || ""),
    })));
  }
  const nested = (response.result?.result && typeof response.result.result === "object")
    ? response.result.result as Record<string, unknown>
    : {};
  const artifacts: TrialArtifact[] = [];
  const html = String(nested.report_html || "").trim();
  if (html) {
    artifacts.push({
      id: "report_html",
      kind: "html",
      title: "经营分析报告（HTML）",
      summary: String(nested.user_message || `共 ${html.length} 字`),
      content: html.slice(0, 120000),
    });
  }
  const report = String(nested.report_markdown || "").trim();
  if (report) {
    artifacts.push({
      id: "report_markdown",
      kind: "markdown",
      title: html ? "经营分析报告（Markdown）" : "经营分析报告",
      summary: String(nested.user_message || `共 ${report.length} 字`),
      content: report.slice(0, 20000),
    });
  }
  if (nested.evidence && typeof nested.evidence === "object") {
    artifacts.push({
      id: "evidence",
      kind: "evidence",
      title: "数据证据",
      summary: "已记录执行证据",
      content: JSON.stringify(nested.evidence, null, 2).slice(0, 8000),
    });
  }
  return normalizeTrialArtifacts(artifacts);
}

function SopTrialStatusIcon({ status }: { status: TrialRunState["status"] }) {
  return (
    <span className={`sop-trial-card-mark is-${status}`} aria-hidden>
      <svg viewBox="0 0 32 32" width="34" height="34" fill="none">
        <circle cx="16" cy="16" r="15" className="sop-trial-card-mark-bg" />
        {/* Clean flow-graph mark: three nodes + edges */}
        <circle cx="10.5" cy="12" r="2.35" fill="currentColor" />
        <circle cx="21.5" cy="12" r="2.35" fill="currentColor" />
        <circle cx="16" cy="21.2" r="2.5" fill="currentColor" />
        <path
          d="M12.6 13.2 14.8 18.4M19.4 13.2 17.2 18.4M12.9 12h6.2"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.88"
        />
      </svg>
    </span>
  );
}

function SopTrialRunCard({
  trial,
  onRerun,
  onStop,
  onConfirm,
  onReject,
}: {
  trial: TrialRunState;
  onRerun?: () => void;
  onStop?: () => void;
  onConfirm?: () => void;
  onReject?: () => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(true);
  const [showResult, setShowResult] = useState(Boolean(trial.artifacts?.length));
  const [activeArtifactId, setActiveArtifactId] = useState(trial.artifacts?.[0]?.id || "");
  const [confirming, setConfirming] = useState(false);
  const artifacts = normalizeTrialArtifacts(trial.artifacts || []);
  const active = artifacts.find((item) => item.id === activeArtifactId) || artifacts[0];
  const htmlReady = Boolean(
    active
    && active.kind === "html"
    && (trial.status === "completed" || /<\/html>/i.test(active.content) || active.content.length > 800),
  );

  useEffect(() => {
    if (trial.status !== "awaiting_confirm") setConfirming(false);
  }, [trial.status]);

  useEffect(() => {
    if (!artifacts.length) return;
    setShowResult(true);
    const preferred = artifacts.find((item) => item.kind === "html") || artifacts[0];
    if (!activeArtifactId || !artifacts.some((item) => item.id === activeArtifactId)) {
      setActiveArtifactId(preferred.id);
    }
  }, [artifacts, activeArtifactId]);
  const safeTotal = Math.max(trial.total, 1);
  const safeCurrent = Math.min(Math.max(trial.current, 0), safeTotal);
  // While running: show "in this step" progress, never hit 100% until completed.
  const progress = trial.status === "completed"
    ? 100
    : trial.status === "awaiting_confirm"
      ? Math.min(92, Math.round((Math.max(safeCurrent, 1) / safeTotal) * 100))
      : Math.min(94, Math.round(((Math.max(safeCurrent, 0.5) - 0.35) / safeTotal) * 100));
  const heading = trial.status === "completed"
    ? "流程执行完成"
    : trial.status === "failed"
      ? "流程执行失败"
      : trial.status === "awaiting_confirm"
        ? "等待人工确认"
        : "流程执行中";
  const summary = trial.status === "completed"
    ? `已完成画布流程（${trial.total} 个节点）`
    : trial.status === "failed"
      ? (trial.currentTitle || "执行中断")
      : trial.status === "awaiting_confirm"
        ? (trial.pendingConfirm?.title || trial.currentTitle || "请确认后继续")
        : `正在执行第 ${Math.max(safeCurrent, 1)} / ${safeTotal} 个步骤：${trial.currentTitle || "准备中"}`;
  const barWidth = trial.status === "completed"
    ? 100
    : trial.status === "failed"
      ? Math.max(progress, 8)
      : Math.max(progress, trial.status === "running" ? 8 : 12);
  const outputText = artifacts.length
    ? `${artifacts.length} 个产物`
    : (trial.outputLabel || "试跑结果已生成");

  const copyArtifact = async () => {
    if (!active?.content) return;
    try {
      await navigator.clipboard.writeText(active.content);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  };

  const downloadArtifact = () => {
    if (!active?.content) return;
    const ext = active.kind === "html" ? "html" : active.kind === "markdown" ? "md" : "txt";
    const mime = active.kind === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8";
    const blob = new Blob([active.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${active.title || "试跑产物"}.${ext}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openHtmlPreview = () => {
    if (!active?.content || active.kind !== "html") return;
    const blob = new Blob([active.content], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className={`sop-trial-card is-${trial.status}`}>
      <div className="sop-trial-card-head">
        <div className="sop-trial-card-title">
          <SopTrialStatusIcon status={trial.status} />
          <div>
            <strong>{heading}</strong>
            <p>{summary}</p>
          </div>
        </div>
        <div className="sop-trial-card-head-actions">
          {trial.status === "running" && onStop && (
            <Button size="small" danger icon={<StopOutlined />} onClick={onStop}>停止</Button>
          )}
          <button type="button" className="sop-trial-card-detail" onClick={() => setOpen((value) => !value)}>
            {open ? "收起详情" : "查看详情"}
          </button>
        </div>
      </div>

      <div className="sop-trial-card-progress">
        <div className="sop-trial-card-bar" aria-hidden>
          <i style={{ width: `${barWidth}%` }} />
        </div>
        <em>{barWidth}%</em>
      </div>

      {trial.status === "completed" && (
        <div className="sop-trial-result-meta">
          {typeof trial.durationSec === "number" && <span>耗时 {trial.durationSec}s</span>}
          <span>输出 {outputText}</span>
          {trial.pushedToUser === false && <span className="is-muted">未真实推送</span>}
        </div>
      )}

      {(trial.status === "completed" || trial.status === "awaiting_confirm") && trial.note && (
        <p className="sop-trial-note">{trial.note}</p>
      )}

      {trial.status === "awaiting_confirm" && trial.pendingConfirm && (
        <div className="sop-trial-confirm-box">
          <strong>{trial.pendingConfirm.title || "人工确认"}</strong>
          <p>{trial.pendingConfirm.instruction || "请确认后继续执行后续步骤。"}</p>
        </div>
      )}

      {open && (
        <ul className="sop-trial-card-logs">
          {trial.logs.map((log, index) => (
            <li key={`${log.text}-${index}`} className={`is-${log.status}`}>
              <em>{log.time}</em>
              <span>{log.text}</span>
              {log.status === "ok" && <CheckCircleFilled />}
              {log.status === "running" && (
                <b className="sop-trial-running-label"><i className="sop-trial-dot" aria-hidden />执行中</b>
              )}
              {log.status === "waiting" && (
                <b className="sop-trial-waiting-label">待确认</b>
              )}
              {log.status === "failed" && <CloseCircleFilled />}
            </li>
          ))}
        </ul>
      )}

      {showResult && (trial.status === "completed" || artifacts.length > 0) && (
        <div className="sop-trial-artifacts">
          <div className="sop-trial-artifacts-head">
            <strong>{trial.status === "running" ? "正在输出产物" : "试跑产物"}</strong>
            <button type="button" onClick={() => setShowResult(false)}>收起</button>
          </div>
          {artifacts.length === 0 ? (
            <p className="sop-trial-artifacts-empty">
              本次试跑没有可下载的报告正文。若流程未配置报告生成节点，就不会产出报告。
            </p>
          ) : (
            <>
              <div className="sop-trial-artifact-tabs">
                {artifacts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={active?.id === item.id ? "is-active" : undefined}
                    onClick={() => setActiveArtifactId(item.id)}
                  >
                    {item.kind === "html" ? "报告预览" : item.kind === "markdown" ? "文字摘要" : item.title}
                  </button>
                ))}
              </div>
              {active && (
                <div className="sop-trial-artifact-body">
                  <div className="sop-trial-artifact-meta">
                    <span>{active.summary}</span>
                    <Space size={8}>
                      {active.kind === "html" && htmlReady && (
                        <Button size="small" onClick={openHtmlPreview}>新窗口预览</Button>
                      )}
                      <Button size="small" icon={<CopyOutlined />} onClick={() => void copyArtifact()}>复制</Button>
                      <Button size="small" onClick={downloadArtifact}>下载</Button>
                    </Space>
                  </div>
                  {active.kind === "html" ? (
                    htmlReady ? (
                      <div className="sop-trial-artifact-html">
                        <iframe
                          title={active.title || "HTML 报告预览"}
                          sandbox="allow-scripts allow-popups"
                          srcDoc={active.content}
                        />
                      </div>
                    ) : (
                      <div className="sop-trial-artifact-html is-loading">
                        <LoadingOutlined /> 正在生成可预览的 HTML…
                      </div>
                    )
                  ) : active.kind === "markdown" || active.kind === "notify_preview" ? (
                    <div className="sop-trial-artifact-md">
                      <ChatMarkdown
                        content={active.content
                          .replace(/```html\s*[\s\S]*?```/gi, "\n\n> HTML 正文请切换到「报告预览」页签查看。\n")
                          .replace(/```html\s*[\s\S]*$/gi, "\n\n> HTML 正文请切换到「报告预览」页签查看。\n")}
                        variant="report"
                      />
                    </div>
                  ) : (
                    <pre className="sop-trial-artifact-raw">{active.content}</pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {(trial.status === "completed" || trial.status === "failed" || trial.status === "awaiting_confirm") && (
        <div className="sop-trial-card-actions">
          {trial.status === "awaiting_confirm" && onConfirm && (
            <Button
              size="small"
              type="primary"
              loading={confirming}
              onClick={() => {
                setConfirming(true);
                onConfirm();
              }}
            >
              确认并继续
            </Button>
          )}
          {trial.status === "awaiting_confirm" && onReject && (
            <Button
              size="small"
              disabled={confirming}
              onClick={onReject}
            >
              驳回
            </Button>
          )}
          {trial.status === "completed" && (
            <Button
              size="small"
              onClick={() => {
                setShowResult(true);
                setOpen(false);
                const preferred = artifacts.find((item) => item.kind === "html") || artifacts[0];
                if (preferred) setActiveArtifactId(preferred.id);
              }}
            >
              查看结果
            </Button>
          )}
          {onRerun && trial.status !== "awaiting_confirm" && (
            <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={onRerun}>再次运行</Button>
          )}
        </div>
      )}
    </div>
  );
}

function SopFlowChangeCard({
  change,
  onApply,
  onUndo,
}: {
  change: FlowChangeInfo;
  onApply: () => void;
  onUndo: () => void;
}) {
  return (
    <div className={`sop-flow-change-card${change.undone ? " is-undone" : ""}${change.applied ? " is-applied" : ""}`}>
      <div className="sop-flow-change-head">
        <strong>流程变更</strong>
        <span>{change.undone ? "已撤销" : change.applied ? "已应用" : "待确认"}</span>
      </div>
      {change.added.length > 0 && (
        <div className="sop-flow-change-block">
          <em>+ 新增节点</em>
          <ul>{change.added.map((item) => <li key={`a-${item}`}>{item}</li>)}</ul>
        </div>
      )}
      {change.removed.length > 0 && (
        <div className="sop-flow-change-block is-remove">
          <em>- 删除节点</em>
          <ul>{change.removed.map((item) => <li key={`r-${item}`}>{item}</li>)}</ul>
        </div>
      )}
      {change.modified.length > 0 && (
        <div className="sop-flow-change-block is-modify">
          <em>~ 调整节点</em>
          <ul>{change.modified.map((item) => <li key={`m-${item}`}>{item}</li>)}</ul>
        </div>
      )}
      {change.chain.length > 0 && (
        <div className="sop-flow-change-chain">
          {change.chain.map((title, index) => (
            <Fragment key={`${title}-${index}`}>
              {index > 0 && <span>↓</span>}
              <strong>{title}</strong>
            </Fragment>
          ))}
        </div>
      )}
      <div className="sop-flow-change-actions">
        <Button size="small" icon={<UndoOutlined />} disabled={change.undone || !change.applied} onClick={onUndo}>撤销</Button>
        <Button size="small" type="primary" disabled={change.applied && !change.undone} onClick={onApply}>
          {change.applied && !change.undone ? "已应用" : "应用修改"}
        </Button>
      </div>
    </div>
  );
}

const NODE_LABELS: Record<string, string> = {
  collect_info: "收集信息",
  data_bind: "企业数据",
  knowledge_query: "知识检索",
  checkpoint: "人工确认",
  execute_action: "执行动作",
  gate: "安全闸机",
  handoff: "转人工",
  end: "完成",
};

const BASE_ACTION_OPTIONS = [
  { value: "ask_user", label: "询问用户" },
  { value: "continue_flow", label: "继续流转" },
  { value: "query_knowledge", label: "检索知识" },
  { value: "confirm", label: "人工确认" },
  { value: "handoff_human", label: "转人工" },
];

function readExpectedFields(config: Record<string, unknown> | undefined): string[] {
  const expected = config?.expected_user_info;
  if (Array.isArray(expected)) return normalizeFieldKeys(expected.map(String));
  const legacy = config?.required_fields;
  if (Array.isArray(legacy)) return normalizeFieldKeys(legacy.map(String));
  return [];
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function readNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((item) => Number.isFinite(item));
}

function bindingSummary(config: Record<string, unknown> | undefined) {
  const data = (config?.data_bindings || {}) as Record<string, unknown>;
  const knowledge = (config?.knowledge_scope || {}) as Record<string, unknown>;
  const snapshots = readNumberList(data.snapshot_ids).length;
  const metrics = readStringList(data.metric_ids).length;
  const assets = readStringList(data.asset_keys).length;
  const kbs = readNumberList(knowledge.knowledge_base_ids).length;
  const actions = readStringList(config?.allowed_actions).length;
  return { snapshots, metrics, assets, kbs, actions };
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "published", label: "已发布" },
  { value: "draft", label: "草稿" },
];

const DOMAIN_META: Record<string, { label: string; icon: ReactNode; tone: string; tags: string[] }> = {
  "任务处理": { label: "任务处理", icon: <BarChartOutlined />, tone: "purple", tags: ["数据分析", "电商"] },
  "库存管理": { label: "库存管理", icon: <FileTextOutlined />, tone: "green", tags: ["库存", "风险控制"] },
  "采购管理": { label: "采购管理", icon: <CommentOutlined />, tone: "blue", tags: ["采购", "供应商"] },
  "客户服务": { label: "客户服务", icon: <CustomerServiceOutlined />, tone: "orange", tags: ["客服", "工单"] },
  "经营分析": { label: "经营分析", icon: <BarChartOutlined />, tone: "purple", tags: ["数据分析", "经营"] },
};

function sopMeta(row: SopDefinitionItem) {
  const domain = row.businessDomain?.trim();
  if (domain && DOMAIN_META[domain]) return DOMAIN_META[domain];
  if (row.actionName.includes("inventory")) {
    return { label: "库存管理", icon: <FileTextOutlined />, tone: "green", tags: ["库存", "补货"] };
  }
  if (row.actionName.includes("report")) {
    return { label: "任务处理", icon: <BarChartOutlined />, tone: "purple", tags: ["数据分析", "报告"] };
  }
  return { label: domain || "通用流程", icon: <ShoppingOutlined />, tone: "blue", tags: ["流程编排"] };
}

function sopStatusLabel(row: SopDefinitionItem) {
  if (row.hasDraft || row.status === "draft") return "draft";
  return "published";
}

function MetaNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const draft = data.draft;
  const fields = draft.graph.nodes
    .flatMap((node) => readExpectedFields(node.config))
    .filter((value, index, list) => list.indexOf(value) === index);
  return <article className="sop-canvas-node sop-canvas-meta-node">
    <div className="sop-canvas-eyebrow">基础信息</div>
    <strong>{draft.name || "未命名流程"}</strong>
    <p>{draft.description || "左边说目标，右边点步骤微调。"}</p>
    <small>业务域</small><span className="sop-node-field">{draft.businessDomain || "未分类"}</span>
    {fields.length > 0 && <><small>需要用户补充</small><div className="sop-node-tags">{fields.map((field) => <em key={field}>{fieldLabel(field)}</em>)}</div></>}
    <Handle type="source" position={Position.Bottom} isConnectable={Boolean(data.connectable)} />
  </article>;
}

function StepNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const step = data.step!;
  const config = step.config || {};
  const fields = readExpectedFields(config);
  const action = String(config.action_name || "");
  const actionTitle = (data.actionTitles && action && data.actionTitles[action]) || "";
  const summary = bindingSummary(config);
  const instruction = String(config.instruction || config.detail || config.message || "按流程配置执行并记录结果。");
  const connectable = Boolean(data.connectable);
  return (
    <article className={`sop-canvas-node sop-canvas-step-node is-${step.type}${data.selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={connectable} />
      <div className="sop-canvas-node-head">
        <span className={`sop-node-check${data.selected ? " is-on" : ""}`} aria-hidden>
          {data.selected ? <CheckSquareOutlined /> : <span className="sop-node-check-box" />}
        </span>
        <span>步骤 {(data.index || 0) + 1}</span>
        <Tag>{NODE_LABELS[step.type] || step.type}</Tag>
      </div>
      <strong>{step.title}</strong>
      <p>{instruction}</p>
      {fields.length > 0 && <div className="sop-node-tags">{fields.map((field) => <em key={field}>{fieldLabel(field)}</em>)}</div>}
      {action && <div className="sop-node-action">能力：{actionTitle || "未命名业务能力"}</div>}
      <div className="sop-node-tags">
        {summary.snapshots > 0 && <em>数据 {summary.snapshots}</em>}
        {summary.metrics > 0 && <em>指标 {summary.metrics}</em>}
        {summary.kbs > 0 && <em>知识 {summary.kbs}</em>}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={connectable} />
    </article>
  );
}

const NODE_TYPES = { meta: MetaNode, step: StepNode };

function readLayout(draft: SopDraftPayload): Record<string, { x: number; y: number }> {
  const layout = (draft.graph as { meta?: { layout?: Record<string, { x?: number; y?: number }> } }).meta?.layout;
  if (!layout || typeof layout !== "object") return {};
  const next: Record<string, { x: number; y: number }> = {};
  Object.entries(layout).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const x = Number(value.x);
    const y = Number(value.y);
    if (Number.isFinite(x) && Number.isFinite(y)) next[key] = { x, y };
  });
  return next;
}

function layoutGraph(
  draft: SopDraftPayload,
  selectedKeys: string[] = [],
  onSelect?: (key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void,
  connectable = false,
  draggable = false,
  actionTitles: Record<string, string> = {},
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const selected = new Set(selectedKeys);
  const graph = draft.graph;
  const saved = readLayout(draft);
  const depth = new Map<string, number>([[graph.start, 0]]);
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    graph.edges.forEach((edge) => {
      if (depth.has(edge.source)) depth.set(edge.target, Math.max(depth.get(edge.target) || 0, (depth.get(edge.source) || 0) + 1));
    });
  }
  const groups = new Map<number, SopGraphNode[]>();
  graph.nodes.forEach((node) => {
    const level = depth.get(node.key) || 0;
    groups.set(level, [...(groups.get(level) || []), node]);
  });
  const nodes: Node<FlowNodeData>[] = [{
    id: "__meta__", type: "meta", position: saved.__meta__ || { x: 360, y: 20 }, data: { kind: "meta", draft, connectable }, draggable: false, selectable: false,
  }];
  graph.nodes.forEach((step, index) => {
    const level = depth.get(step.key) || 0;
    const peers = groups.get(level) || [step];
    const peerIndex = peers.findIndex((item) => item.key === step.key);
    const totalWidth = (peers.length - 1) * 360;
    const autoPos = { x: 360 - totalWidth / 2 + peerIndex * 360, y: 300 + level * 300 };
    nodes.push({
      id: step.key,
      type: "step",
      position: saved[step.key] || autoPos,
      data: { kind: "step", draft, step, index, selected: selected.has(step.key), connectable, actionTitles, onSelect },
      draggable,
      selected: selected.has(step.key),
    });
  });
  const edges: Edge[] = [
    { id: "meta-start", source: "__meta__", target: graph.start, animated: false, label: "开始", className: "sop-flow-edge", selectable: false },
    ...graph.edges.map((edge, index) => ({
      id: `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.condition === "always" ? "" : edge.condition.replace("decision:", ""),
      className: "sop-flow-edge",
      selectable: true,
    })),
  ];
  return { nodes, edges };
}

function FlowToolbar() {
  const flow = useReactFlow();
  return <div className="sop-flow-quick-tools">
    <Button size="small" onClick={() => flow.zoomOut()}>−</Button>
    <Button size="small" onClick={() => flow.zoomIn()}>＋</Button>
    <Button size="small" onClick={() => flow.fitView({ padding: 0.16 })}>适配</Button>
    <Button size="small" onClick={() => flow.zoomTo(1)}>100%</Button>
  </div>;
}

function SopFlowCanvas({
  draft,
  selectedKeys,
  onSelect,
  onClear,
  readOnly = false,
  actionTitles = {},
  onConnectEdge,
  onDeleteEdge,
  onAddNode,
  onDeleteNodes,
  onMoveNodes,
  onResetLayout,
}: {
  draft: SopDraftPayload;
  selectedKeys: string[];
  onSelect: (key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  onClear: () => void;
  readOnly?: boolean;
  actionTitles?: Record<string, string>;
  onConnectEdge?: (source: string, target: string) => void;
  onDeleteEdge?: (source: string, target: string) => void;
  onAddNode?: () => void;
  onDeleteNodes?: (keys: string[]) => void;
  onMoveNodes?: (positions: Record<string, { x: number; y: number }>) => void;
  onResetLayout?: () => void;
}) {
  const { message } = App.useApp();
  const connectable = !readOnly;
  const draggable = !readOnly;
  const model = useMemo(
    () => layoutGraph(draft, selectedKeys, onSelect, connectable, draggable, actionTitles),
    [actionTitles, connectable, draft, draggable, onSelect, selectedKeys],
  );
  const [nodes, setNodes] = useState(model.nodes);
  const [edges, setEdges] = useState(model.edges);
  const dragMoved = useRef(false);

  useEffect(() => {
    setNodes(model.nodes);
    setEdges(model.edges);
  }, [model]);

  const handleConnect = useCallback((connection: Connection) => {
    const source = connection.source;
    const target = connection.target;
    if (!source || !target || source === target) return;
    if (source === "__meta__" || target === "__meta__") return;
    onConnectEdge?.(source, target);
  }, [onConnectEdge]);

  const onNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    if (readOnly) return;
    const meaningful = changes.filter((change) => change.type === "position" || change.type === "dimensions");
    if (!meaningful.length) return;
    if (meaningful.some((change) => change.type === "position" && "dragging" in change && change.dragging)) {
      dragMoved.current = true;
    }
    setNodes((current) => applyNodeChanges(meaningful, current));
  }, [readOnly]);

  const persistPositions = useCallback((list: Node<FlowNodeData>[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    list.forEach((node) => {
      if (node.id === "__meta__") return;
      positions[node.id] = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
    });
    onMoveNodes?.(positions);
  }, [onMoveNodes]);

  const deleteSelected = useCallback(() => {
    if (readOnly || !selectedKeys.length) return;
    onDeleteNodes?.(selectedKeys);
  }, [onDeleteNodes, readOnly, selectedKeys]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (readOnly) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedKeys.length) return;
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, readOnly, selectedKeys.length]);

  return <ReactFlowProvider><div className="sop-flow-canvas">
    <div className="sop-flow-edit-tools">
      <Button size="small" icon={<PlusOutlined />} disabled={readOnly} onClick={onAddNode}>添加步骤</Button>
      <Button size="small" danger icon={<DeleteOutlined />} disabled={readOnly || selectedKeys.length === 0} onClick={deleteSelected}>
        删除选中{selectedKeys.length > 1 ? `(${selectedKeys.length})` : ""}
      </Button>
      <Button size="small" disabled={readOnly} onClick={onResetLayout}>自动排布</Button>
      <span>拖动卡片移动 · 拖圆点连线 · Del 删除</span>
    </div>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onInit={(flow) => { void flow.setCenter(555, 150, { zoom: 0.72 }); }}
      onNodesChange={onNodesChange}
      onNodeClick={(event, node) => {
        if (dragMoved.current) {
          dragMoved.current = false;
          return;
        }
        if (node.id === "__meta__") {
          onClear();
          return;
        }
        onSelect(node.id, {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
      }}
      onNodeDragStop={(_, _node, currentNodes) => {
        dragMoved.current = true;
        persistPositions(currentNodes as Node<FlowNodeData>[]);
      }}
      onPaneClick={() => onClear()}
      onConnect={handleConnect}
      onEdgeClick={(_, edge) => {
        if (readOnly || edge.source === "__meta__") return;
        onDeleteEdge?.(edge.source, edge.target);
        message.success("已删除连线");
      }}
      minZoom={0.28}
      maxZoom={1.45}
      nodesConnectable={connectable}
      elementsSelectable
      nodesDraggable={draggable}
      selectNodesOnDrag={false}
      multiSelectionKeyCode={["Meta", "Control"]}
      deleteKeyCode={null}
    >
      <Background gap={28} size={1} color="rgba(84, 92, 113, .12)" />
      <Controls showInteractive={false} className="sop-native-controls" />
      <MiniMap pannable zoomable nodeStrokeWidth={3} className="sop-flow-minimap" />
      <FlowToolbar />
    </ReactFlow>
  </div></ReactFlowProvider>;
}

const NODE_TYPE_OPTIONS = Object.entries(NODE_LABELS).map(([value, label]) => ({ value, label }));
const CONDITION_OPTIONS = [
  { value: "always", label: "始终流转" },
  { value: "decision:allow", label: "执行通过" },
  { value: "decision:block", label: "执行阻断" },
  { value: "result_ok", label: "结果成功" },
  { value: "result_failed", label: "结果失败" },
];

function SopStructuredSource({ draft, disabled, onChange }: {
  draft: SopDraftPayload;
  disabled: boolean;
  onChange: (next: SopDraftPayload) => void;
}) {
  const [actions, setActions] = useState<ActionContract[]>([]);
  const [snapshots, setSnapshots] = useState<Array<{ id: number; label: string }>>([]);
  const [metrics, setMetrics] = useState<Array<{ value: string; label: string }>>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);

  useEffect(() => {
    getCatalog().then((data) => setActions(data.actions || [])).catch(() => setActions([]));
    getSourceSnapshots().then((data) => {
      const rows = (data as { results?: Array<Record<string, unknown>> }).results || [];
      setSnapshots(rows.map((row) => {
        const scope = (row.scope || {}) as Record<string, unknown>;
        const asset = String(scope.asset_key || row.source_system || row.snapshot_key || row.id);
        return { id: Number(row.id), label: `#${row.id} ${asset}` };
      }).filter((row) => Number.isFinite(row.id)));
    }).catch(() => setSnapshots([]));
    getMetricContracts().then((data) => {
      const rows = (data as { results?: Array<Record<string, unknown>> }).results || [];
      setMetrics(rows.map((row) => ({
        value: String(row.metric_id || ""),
        label: `${row.metric_id} · ${row.name || ""}`,
      })).filter((row) => row.value));
    }).catch(() => setMetrics([]));
    listKnowledgeBases().then((data) => {
      setKnowledgeBases(data);
    }).catch(() => setKnowledgeBases([]));
  }, []);

  const actionOptions = useMemo(
    () => [
      {
        label: "系统能力",
        options: actions
          .filter((action) => (action.group || action.source || "system") !== "skill")
          .map((action) => ({ value: action.name, label: `${action.title} (${action.name})` })),
      },
      {
        label: "我的技能",
        options: actions
          .filter((action) => action.group === "skill" || action.source === "skill")
          .map((action) => ({ value: action.name, label: `${action.title} (${action.name})` })),
      },
    ].filter((group) => group.options.length > 0),
    [actions],
  );
  const allowedActionOptions = useMemo(() => [
    ...BASE_ACTION_OPTIONS,
    ...actions.map((action) => ({ value: `call_action:${action.name}`, label: `调用动作：${action.title}` })),
  ], [actions]);

  const updateBase = (patch: Partial<SopDraftPayload>) => onChange({ ...draft, ...patch });
  const updateNode = (index: number, patch: Partial<SopGraphNode>, configPatch?: Record<string, unknown>) => {
    const nodes = draft.graph.nodes.map((node, nodeIndex) => {
      if (nodeIndex !== index) return node;
      const nextConfig = { ...node.config, ...(configPatch || {}) };
      if (configPatch?.expected_user_info) {
        nextConfig.required_fields = configPatch.expected_user_info;
      }
      if (typeof configPatch?.instruction === "string") {
        nextConfig.detail = configPatch.instruction;
        nextConfig.message = configPatch.instruction;
      }
      if (typeof configPatch?.action_name === "string") {
        const token = `call_action:${configPatch.action_name}`;
        const allowed = readStringList(nextConfig.allowed_actions);
        if (configPatch.action_name && !allowed.includes(token)) {
          nextConfig.allowed_actions = [...allowed, token];
        }
      }
      return { ...node, ...patch, config: nextConfig };
    });
    onChange({ ...draft, graph: { ...draft.graph, nodes } });
  };
  const patchDataBindings = (index: number, patch: Record<string, unknown>) => {
    const current = (draft.graph.nodes[index]?.config?.data_bindings || {}) as Record<string, unknown>;
    updateNode(index, {}, { data_bindings: { ...EMPTY_BINDINGS, ...current, ...patch } });
  };
  const patchKnowledgeScope = (index: number, patch: Record<string, unknown>) => {
    const current = (draft.graph.nodes[index]?.config?.knowledge_scope || {}) as Record<string, unknown>;
    updateNode(index, {}, { knowledge_scope: { ...EMPTY_KNOWLEDGE, ...current, ...patch } });
  };
  const addNode = (beforeIndex?: number) => {
    const terminalKey = draft.graph.terminals[0] || "finish";
    const terminalIndex = draft.graph.nodes.findIndex((node) => node.key === terminalKey);
    const insertIndex = beforeIndex ?? (terminalIndex >= 0 ? terminalIndex : draft.graph.nodes.length);
    let suffix = draft.graph.nodes.length + 1;
    let key = `step.${suffix}`;
    while (draft.graph.nodes.some((node) => node.key === key)) { suffix += 1; key = `step.${suffix}`; }
    const node: SopGraphNode = {
      key,
      type: "checkpoint",
      title: "新流程节点",
      config: {
        ...EMPTY_NODE_CONFIG(""),
        instruction: "说明这个节点要完成的工作",
        allowed_actions: ["confirm", "ask_user", "continue_flow"],
        action_name: "",
      },
    };
    const nodes = [...draft.graph.nodes];
    nodes.splice(insertIndex, 0, node);
    const incoming = draft.graph.edges.filter((edge) => edge.target === terminalKey);
    const edges = draft.graph.edges.map((edge) => edge.target === terminalKey ? { ...edge, target: key } : edge);
    if (incoming.length === 0 && nodes.length > 1) {
      const previous = nodes[Math.max(0, insertIndex - 1)];
      if (previous && previous.key !== key) edges.push({ source: previous.key, target: key, condition: "always", priority: 1 });
    }
    edges.push({ source: key, target: terminalKey, condition: "always", priority: 1 });
    onChange({ ...draft, graph: { ...draft.graph, nodes, edges } });
  };
  const deleteNode = (index: number) => {
    const node = draft.graph.nodes[index];
    if (node.key === draft.graph.start || draft.graph.terminals.includes(node.key)) return;
    const incoming = draft.graph.edges.filter((edge) => edge.target === node.key);
    const outgoing = draft.graph.edges.filter((edge) => edge.source === node.key);
    const fallbackTarget = outgoing[0]?.target || draft.graph.terminals[0];
    const edges = draft.graph.edges.filter((edge) => edge.source !== node.key && edge.target !== node.key);
    if (fallbackTarget) incoming.forEach((edge) => edges.push({ ...edge, target: fallbackTarget }));
    onChange({ ...draft, graph: { ...draft.graph, nodes: draft.graph.nodes.filter((_, nodeIndex) => nodeIndex !== index), edges } });
  };
  const updateEdge = (edgeIndex: number, patch: Partial<SopDraftPayload["graph"]["edges"][number]>) => {
    const edges = draft.graph.edges.map((edge, index) => index === edgeIndex ? { ...edge, ...patch } : edge);
    onChange({ ...draft, graph: { ...draft.graph, edges } });
  };
  const addEdge = (source: string) => {
    const fallback = draft.graph.terminals[0] || draft.graph.nodes[0]?.key;
    if (!fallback || fallback === source) return;
    onChange({ ...draft, graph: { ...draft.graph, edges: [...draft.graph.edges, { source, target: fallback, condition: "always", priority: 1 }] } });
  };

  return <div className="sop-structured-source">
    <section className="sop-source-section">
      <h4>基础信息</h4>
      <div className="sop-source-base-card">
        <label><span>SOP 名称</span><Input value={draft.name} disabled={disabled} onChange={(event) => updateBase({ name: event.target.value })} /></label>
        <label><span>SOP ID</span><Input value={draft.key} disabled={disabled || Boolean(draft.key)} onChange={(event) => updateBase({ key: event.target.value })} /></label>
        <label><span>版本</span><Input value={draft.version} disabled /></label>
        <label><span>业务域</span><Input value={draft.businessDomain} disabled={disabled} onChange={(event) => updateBase({ businessDomain: event.target.value })} /></label>
        <label className="is-wide"><span>描述</span><Input.TextArea rows={2} value={draft.description} disabled={disabled} onChange={(event) => updateBase({ description: event.target.value })} /></label>
        <label className="is-wide"><span>触发意图</span><Input value={draft.triggerIntents.join("，")} disabled={disabled} onChange={(event) => updateBase({ triggerIntents: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="is-wide"><span>示例话术</span><Input value={draft.utteranceExamples.join("；")} disabled={disabled} onChange={(event) => updateBase({ utteranceExamples: event.target.value.split(/[；;]/).map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="is-wide"><span>目标动作</span>
          <Select
            value={draft.actionName || undefined}
            disabled={disabled}
            options={actionOptions}
            showSearch
            optionFilterProp="label"
            placeholder="选择动作契约"
            onChange={(value) => updateBase({ actionName: value })}
          />
        </label>
      </div>
    </section>

    <section className="sop-source-section">
      <div className="sop-source-section-head"><h4>高级节点配置</h4><span className="sop-panel-hint">日常请点流程图步骤；这里只给需要细调的人用</span>{!disabled && <Button size="small" icon={<PlusOutlined />} onClick={() => addNode()}>新增节点</Button>}</div>
      <div className="sop-source-node-list">
        {draft.graph.nodes.map((node, index) => {
          const fields = readExpectedFields(node.config);
          const allowed = readStringList(node.config.allowed_actions);
          const dataBindings = (node.config.data_bindings || {}) as Record<string, unknown>;
          const knowledgeScope = (node.config.knowledge_scope || {}) as Record<string, unknown>;
          const outgoing = draft.graph.edges.map((edge, edgeIndex) => ({ edge, edgeIndex })).filter(({ edge }) => edge.source === node.key);
          const protectedNode = node.key === draft.graph.start || draft.graph.terminals.includes(node.key);
          return <article className="sop-source-node-card" key={`${node.key}-${index}`}>
            <div className="sop-source-node-title">
              <strong>Node {index + 1}：{node.title}</strong>
              {!disabled && !protectedNode && <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => deleteNode(index)}>删除节点</Button>}
            </div>
            <div className="sop-source-node-fields">
              <label><span>节点 ID</span><Input value={node.key} disabled /></label>
              <label><span>节点类型</span><Select value={node.type} disabled={disabled} options={NODE_TYPE_OPTIONS} onChange={(value) => updateNode(index, { type: value as SopGraphNode["type"] })} /></label>
              <label className="is-wide"><span>节点名称</span><Input value={node.title} disabled={disabled} onChange={(event) => updateNode(index, { title: event.target.value })} /></label>
              <label className="is-wide"><span>AI 指令</span><Input.TextArea rows={2} value={String(node.config.instruction || node.config.detail || node.config.message || "")} disabled={disabled} placeholder="告诉 AI 这一步要达成什么目标" onChange={(event) => updateNode(index, {}, { instruction: event.target.value })} /></label>
              <label className="is-wide"><span>需要用户补充</span><Select
                mode="multiple"
                value={fields}
                disabled={disabled}
                options={[
                  { value: "date_range", label: "日期范围" },
                  { value: "brand", label: "品牌" },
                  { value: "scope", label: "数据范围" },
                  { value: "dt", label: "截止日期" },
                  { value: "shop", label: "店铺" },
                  { value: "snapshot_id", label: "库存快照" },
                  { value: "output_type", label: "报告类型" },
                ]}
                optionFilterProp="label"
                optionLabelProp="label"
                placeholder="选择要向用户确认的信息"
                tagRender={(props) => (
                  <Tag closable={props.closable} onClose={props.onClose} style={{ marginInlineEnd: 4 }}>
                    {fieldLabel(String(props.value))}
                  </Tag>
                )}
                onChange={(value) => {
                  const normalized = normalizeFieldKeys(value);
                  updateNode(index, {}, { expected_user_info: normalized, required_fields: normalized });
                }}
              /></label>
              <label className="is-wide"><span>允许动作</span><Select mode="multiple" value={allowed} disabled={disabled} options={allowedActionOptions} placeholder="限制本节点可用能力" onChange={(value) => updateNode(index, {}, { allowed_actions: value })} /></label>
              <label className="is-wide"><span>企业数据 Snapshot</span>
                <Select
                  mode="multiple"
                  value={readNumberList(dataBindings.snapshot_ids)}
                  disabled={disabled}
                  options={snapshots.map((item) => ({ value: item.id, label: item.label }))}
                  placeholder="绑定可信企业数据版本"
                  optionFilterProp="label"
                  onChange={(value) => patchDataBindings(index, { snapshot_ids: value })}
                />
              </label>
              <label className="is-wide"><span>指标契约</span>
                <Select
                  mode="multiple"
                  value={readStringList(dataBindings.metric_ids)}
                  disabled={disabled}
                  options={metrics}
                  placeholder="可选指标"
                  optionFilterProp="label"
                  onChange={(value) => patchDataBindings(index, { metric_ids: value })}
                />
              </label>
              <label className="is-wide"><span>资产 Key</span>
                <Select
                  mode="tags"
                  value={readStringList(dataBindings.asset_keys)}
                  disabled={disabled}
                  placeholder="例如 sales.ledger"
                  tokenSeparators={[",", "，", " "]}
                  onChange={(value) => patchDataBindings(index, { asset_keys: value })}
                />
              </label>
              <label><span>数据范围</span>
                <Input
                  value={String(dataBindings.scope || "")}
                  disabled={disabled}
                  placeholder="all / brand ..."
                  onChange={(event) => patchDataBindings(index, { scope: event.target.value })}
                />
              </label>
              <label><span>品牌</span>
                <Select
                  mode="tags"
                  value={readStringList(dataBindings.brand_ids)}
                  disabled={disabled}
                  placeholder="brand_ids"
                  tokenSeparators={[",", "，", " "]}
                  onChange={(value) => patchDataBindings(index, { brand_ids: value })}
                />
              </label>
              <label className="is-wide"><span>知识库</span>
                <Select
                  mode="multiple"
                  value={readNumberList(knowledgeScope.knowledge_base_ids)}
                  disabled={disabled}
                  options={knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name }))}
                  placeholder="绑定可检索知识库"
                  optionFilterProp="label"
                  onChange={(value) => patchKnowledgeScope(index, { knowledge_base_ids: value })}
                />
              </label>
              <label className="is-wide"><span>检索提示</span>
                <Input
                  value={String(knowledgeScope.retrieval_hint || "")}
                  disabled={disabled}
                  placeholder="给知识检索的提示词"
                  onChange={(event) => patchKnowledgeScope(index, { retrieval_hint: event.target.value })}
                />
              </label>
              {(node.type === "execute_action" || node.type === "gate") && (
                <label className="is-wide"><span>调用动作</span>
                  <Select
                    value={String(node.config.action_name || "") || undefined}
                    disabled={disabled}
                    options={actionOptions}
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择动作契约"
                    onChange={(value) => updateNode(index, {}, { action_name: value })}
                  />
                </label>
              )}
            </div>
            <div className="sop-source-rules">
              <div className="sop-source-rules-head"><span>流转规则</span>{!disabled && <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => addEdge(node.key)}>新增规则</Button>}</div>
              {outgoing.length === 0 ? <p>当前节点为终止节点，流程到此结束。</p> : outgoing.map(({ edge, edgeIndex }) => <div className="sop-source-rule-row" key={`${edge.source}-${edge.target}-${edgeIndex}`}>
                <span>从本节点流转到</span>
                <Select value={edge.target} disabled={disabled} options={draft.graph.nodes.filter((item) => item.key !== node.key).map((item) => ({ value: item.key, label: item.title }))} onChange={(value) => updateEdge(edgeIndex, { target: value })} />
                <Select value={edge.condition} disabled={disabled} options={CONDITION_OPTIONS} onChange={(value) => updateEdge(edgeIndex, { condition: value })} />
                {!disabled && <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => onChange({ ...draft, graph: { ...draft.graph, edges: draft.graph.edges.filter((_, itemIndex) => itemIndex !== edgeIndex) } })} />}
              </div>)}
            </div>
          </article>;
        })}
      </div>
    </section>
  </div>;
}

const QUICK_ACTIONS: Array<{ text: string; icon: "play" | "plus" | "optimize" | "structure" | "edit"; accent?: boolean }> = [
  { text: "跑一遍流程", icon: "play", accent: true },
  { text: "生成报告前增加一步人工确认", icon: "plus" },
  { text: "优化整条流程，让步骤更清晰可执行", icon: "optimize" },
  { text: "用文字说明当前流程结构", icon: "structure" },
  { text: "帮我修改选中节点的目标与能力", icon: "edit" },
];

const NODE_PROMPT_CHIPS = [
  { text: "把这一步改成先确认品牌和日期", icon: "edit" as const },
  { text: "这一步改用销售台账数据", icon: "structure" as const },
  { text: "这一步需要人工确认后再继续", icon: "plus" as const },
  { text: "写清楚这一步要完成的目标", icon: "edit" as const },
];

const MULTI_PROMPT_CHIPS = [
  { text: "这几步都改成需要确认品牌和日期", icon: "edit" as const },
  { text: "这几步统一改用企业销售数据", icon: "structure" as const },
  { text: "这几步都加上人工确认", icon: "plus" as const },
];

function chipIcon(kind: "play" | "plus" | "optimize" | "structure" | "edit") {
  if (kind === "play") return <PlayCircleOutlined />;
  if (kind === "plus") return <PlusOutlined />;
  if (kind === "optimize") return <ThunderboltOutlined />;
  if (kind === "structure") return <BranchesOutlined />;
  return <FileTextOutlined />;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function SopEditor({ initial, record, openVersionsOnMount = false, autoTrialOnMount = false, onBack, onSaved }: {
  initial: SopDraftPayload;
  record?: SopDefinitionItem;
  openVersionsOnMount?: boolean;
  autoTrialOnMount?: boolean;
  onBack: () => void;
  onSaved: (item: SopDefinitionItem) => void;
}) {
  const { message, modal } = App.useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => chatFromVersion(record?.version, initial.name, initial.graph.nodes));
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, SopDraftPayload>>({});
  const chatSaveTimer = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const autoTrialDone = useRef(false);
  const trialAbortRef = useRef<AbortController | null>(null);
  const activeTrialMessageIdRef = useRef<string | null>(null);
  messagesRef.current = messages;
  const [view, setView] = useState<"flow" | "source">("flow");
  const [selectedNodeKeys, setSelectedNodeKeys] = useState<string[]>([]);
  const [versions, setVersions] = useState<SopVersionItem[]>(record?.version ? [record.version] : []);
  const [selectedVersion, setSelectedVersion] = useState<SopVersionItem | undefined>(record?.version);
  const [versionOpen, setVersionOpen] = useState(Boolean(openVersionsOnMount && record));
  const [runsOpen, setRunsOpen] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runRows, setRunRows] = useState<SopRunItem[]>([]);
  const [signalRows, setSignalRows] = useState<SopEvolutionSignalItem[]>([]);
  const [proposalRows, setProposalRows] = useState<SopEvolutionProposalItem[]>([]);
  const [evolutionMetrics, setEvolutionMetrics] = useState<{
    enabled: boolean;
    definition: { callCount: number; trialCount: number; successRate: number };
    signalCount: number;
    pendingProposals: number;
    acceptedComparisons: Array<{
      proposalId: number;
      title: string;
      before: { version?: string | null; callCount: number; successRate: number };
      after: { version?: string | null; callCount: number; successRate: number };
      deltaSuccessRate: number;
    }>;
  } | null>(null);
  const [analyzingEvolution, setAnalyzingEvolution] = useState(false);
  const [proposalBusyId, setProposalBusyId] = useState<number | null>(null);
  const [runDetail, setRunDetail] = useState<SopRunItem | null>(null);
  const [runFilter, setRunFilter] = useState<"all" | "live" | "trial">("all");
  const [evolutionTab, setEvolutionTab] = useState<"runs" | "evolve">("evolve");
  const [actions, setActions] = useState<ActionContract[]>([]);
  const [assets, setAssets] = useState<DataAssetOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const readOnly = Boolean(record && (record.system || selectedVersion?.status !== "draft" || !record.canEdit));
  const selectedNodes = draft.graph.nodes.filter((node) => selectedNodeKeys.includes(node.key));
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const editMode = selectedNodeKeys.length === 0 ? "flow" : selectedNodeKeys.length === 1 ? "node" : "nodes";
  const activeChips: typeof QUICK_ACTIONS = editMode === "flow" ? QUICK_ACTIONS : editMode === "node" ? NODE_PROMPT_CHIPS : MULTI_PROMPT_CHIPS;

  const actionTitles = useMemo(
    () => Object.fromEntries(actions.map((action) => [action.name, action.title])),
    [actions],
  );

  const clearSelection = useCallback(() => setSelectedNodeKeys([]), []);
  const selectNode = useCallback((key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    const multi = Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey);
    setSelectedNodeKeys((current) => {
      if (multi) return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      return current.length === 1 && current[0] === key ? [] : [key];
    });
  }, []);

  const connectEdge = useCallback((source: string, target: string) => {
    setDirty(true);
    setDraft((cur) => {
      if (cur.graph.edges.some((edge) => edge.source === source && edge.target === target)) return cur;
      return {
        ...cur,
        graph: {
          ...cur.graph,
          edges: [...cur.graph.edges, { source, target, condition: "always", priority: 1 }],
        },
      };
    });
  }, []);

  const deleteEdge = useCallback((source: string, target: string) => {
    setDraft((cur) => ({
      ...cur,
      graph: {
        ...cur.graph,
        edges: cur.graph.edges.filter((edge) => !(edge.source === source && edge.target === target)),
      },
    }));
  }, []);

  const moveCanvasNodes = useCallback((positions: Record<string, { x: number; y: number }>) => {
    setDraft((cur) => {
      const prevMeta = cur.graph.meta || {};
      const prevLayout = { ...(prevMeta.layout || {}) };
      return {
        ...cur,
        graph: {
          ...cur.graph,
          meta: {
            ...prevMeta,
            layout: { ...prevLayout, ...positions },
          },
        },
      };
    });
  }, []);

  const resetCanvasLayout = useCallback(() => {
    setDraft((cur) => ({
      ...cur,
      graph: {
        ...cur.graph,
        meta: {
          ...(cur.graph.meta || {}),
          layout: {},
        },
      },
    }));
    message.success("已按流程层级重新排布");
  }, [message]);

  const deleteCanvasNodes = useCallback((keys: string[]) => {
    let blocked = false;
    let removed = false;
    setDraft((cur) => {
      const protectedKeys = new Set([cur.graph.start, ...(cur.graph.terminals || [])]);
      const removing = keys.filter((key) => !protectedKeys.has(key));
      if (!removing.length) {
        blocked = true;
        return cur;
      }
      const removeSet = new Set(removing);
      const nodes = cur.graph.nodes.filter((node) => !removeSet.has(node.key));
      if (nodes.length === 0) {
        blocked = true;
        return cur;
      }
      let edges = cur.graph.edges.filter((edge) => !removeSet.has(edge.source) && !removeSet.has(edge.target));
      removing.forEach((key) => {
        const incoming = cur.graph.edges.filter((edge) => edge.target === key && !removeSet.has(edge.source));
        const outgoing = cur.graph.edges.filter((edge) => edge.source === key && !removeSet.has(edge.target));
        const fallbackTarget = outgoing[0]?.target || cur.graph.terminals[0];
        if (fallbackTarget && !removeSet.has(fallbackTarget)) {
          incoming.forEach((edge) => {
            if (!edges.some((item) => item.source === edge.source && item.target === fallbackTarget)) {
              edges.push({ ...edge, target: fallbackTarget });
            }
          });
        }
      });
      const prevMeta = ((cur.graph as { meta?: Record<string, unknown> }).meta || {}) as Record<string, unknown>;
      const prevLayout = {
        ...((prevMeta.layout && typeof prevMeta.layout === "object"
          ? prevMeta.layout
          : {}) as Record<string, { x: number; y: number }>),
      };
      removing.forEach((key) => { delete prevLayout[key]; });
      removed = true;
      return {
        ...cur,
        graph: {
          ...cur.graph,
          nodes,
          edges,
          meta: {
            goal: Array.isArray(prevMeta.goal) ? prevMeta.goal.map(String) : [],
            required_info: Array.isArray(prevMeta.required_info) ? prevMeta.required_info.map(String) : [],
            slot_filling_policy: (prevMeta.slot_filling_policy && typeof prevMeta.slot_filling_policy === "object"
              ? prevMeta.slot_filling_policy
              : {}) as Record<string, unknown>,
            layout: prevLayout,
          },
        },
      };
    });
    if (blocked) message.warning("起始/结束步骤不能删除，且流程至少保留一个步骤");
    if (removed) {
      setSelectedNodeKeys((current) => current.filter((key) => !keys.includes(key)));
      message.success("已删除选中步骤");
    }
  }, [message]);

  const addCanvasNode = useCallback(() => {
    let createdKey = "";
    setDraft((cur) => {
      const terminalKey = cur.graph.terminals[0] || "finish";
      const terminalIndex = cur.graph.nodes.findIndex((node) => node.key === terminalKey);
      const insertIndex = terminalIndex >= 0 ? terminalIndex : cur.graph.nodes.length;
      let suffix = cur.graph.nodes.length + 1;
      let key = `step.${suffix}`;
      while (cur.graph.nodes.some((node) => node.key === key)) {
        suffix += 1;
        key = `step.${suffix}`;
      }
      createdKey = key;
      const node: SopGraphNode = {
        key,
        type: "checkpoint",
        title: "新流程节点",
        config: {
          ...EMPTY_NODE_CONFIG(""),
          instruction: "说明这个节点要完成的工作",
          allowed_actions: ["confirm", "ask_user", "continue_flow"],
          action_name: "",
        },
      };
      const nodes = [...cur.graph.nodes];
      nodes.splice(insertIndex, 0, node);
      const incoming = cur.graph.edges.filter((edge) => edge.target === terminalKey);
      const edges = cur.graph.edges.map((edge) => (edge.target === terminalKey ? { ...edge, target: key } : edge));
      if (incoming.length === 0 && nodes.length > 1) {
        const previous = nodes[Math.max(0, insertIndex - 1)];
        if (previous && previous.key !== key) {
          edges.push({ source: previous.key, target: key, condition: "always", priority: 1 });
        }
      }
      edges.push({ source: key, target: terminalKey, condition: "always", priority: 1 });
      return { ...cur, graph: { ...cur.graph, nodes, edges } };
    });
    if (createdKey) setSelectedNodeKeys([createdKey]);
  }, []);

  const addImageFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/")).slice(0, 4);
    if (!images.length) return;
    try {
      const urls = await Promise.all(images.map((file) => fileToDataUrl(file)));
      setPendingImages((current) => [...current, ...urls.filter(Boolean)].slice(0, 4));
    } catch {
      message.error("图片读取失败");
    }
  }, [message]);

  useEffect(() => {
    getMe().then((data) => setUser(data.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    getCatalog().then((data) => setActions(data.actions || [])).catch(() => setActions([]));
    getSourceSnapshots().then((data) => {
      const rows = (data as { results?: Array<Record<string, unknown>> }).results || [];
      setAssets(buildDataAssetOptions(rows));
    }).catch(() => setAssets([]));
    listKnowledgeBases().then((data) => {
      setKnowledgeBases(data);
    }).catch(() => setKnowledgeBases([]));
  }, []);

  const refreshVersions = useCallback(async () => {
    if (!record) return;
    try { setVersions((await listSopVersions(record.key)).results || []); }
    catch (error) { message.error(errorText(error, "版本历史加载失败")); }
  }, [message, record]);

  const refreshRuns = useCallback(async (filter: "all" | "live" | "trial" = runFilter) => {
    if (!record) return;
    setRunsLoading(true);
    try {
      const [runs, signals, proposals, metrics] = await Promise.all([
        listSopRuns(record.key, {
          limit: 40,
          ...(filter === "trial" ? { trial: true } : filter === "live" ? { trial: false } : {}),
        }),
        listSopEvolutionSignals(record.key, { limit: 20 }),
        listSopEvolutionProposals(record.key, { limit: 30 }),
        getSopEvolutionMetrics(record.key).catch(() => null),
      ]);
      setRunRows(runs.results || []);
      setSignalRows(signals.results || []);
      setProposalRows(proposals.results || []);
      setEvolutionMetrics(metrics);
    } catch (error) {
      message.error(errorText(error, "运行记录加载失败"));
    } finally {
      setRunsLoading(false);
    }
  }, [message, record, runFilter]);

  const runAnalyzeEvolution = useCallback(async () => {
    if (!record) return;
    setAnalyzingEvolution(true);
    try {
      const result = await analyzeSopEvolution(record.key);
      message.success(
        result.count
          ? `已生成 ${result.count} 条进化提案${result.autoDraftedIds?.length ? `，其中 ${result.autoDraftedIds.length} 条低风险已自动开草稿` : ""}`
          : "暂无足够可进化信号。试跑里的「等待确认」是正常暂停，不会当成缺陷；需要反复缺字段、失败或转人工才会出提案。",
      );
      await refreshRuns();
      await refreshVersions();
    } catch (error) {
      message.error(errorText(error, "进化分析失败"));
    } finally {
      setAnalyzingEvolution(false);
    }
  }, [message, record, refreshRuns, refreshVersions]);

  const handleProposalAction = useCallback(async (
    action: "trial" | "draft" | "accept" | "reject",
    proposalId: number,
  ) => {
    if (!record) return;
    setProposalBusyId(proposalId);
    try {
      if (action === "trial") await trialSopEvolutionProposal(record.key, proposalId);
      if (action === "draft") await draftSopEvolutionProposal(record.key, proposalId);
      if (action === "accept") await acceptSopEvolutionProposal(record.key, proposalId);
      if (action === "reject") await rejectSopEvolutionProposal(record.key, proposalId);
      message.success(
        action === "trial" ? "提案试跑完成"
          : action === "draft" ? "已生成草稿版本"
            : action === "accept" ? "已采纳为草稿，请手动发布"
              : "已拒绝提案",
      );
      await refreshRuns();
      await refreshVersions();
    } catch (error) {
      message.error(errorText(error, "提案操作失败"));
    } finally {
      setProposalBusyId(null);
    }
  }, [message, record, refreshRuns, refreshVersions]);

  const openRuns = useCallback(() => {
    setRunsOpen(true);
    setRunDetail(null);
    void refreshRuns(runFilter);
  }, [refreshRuns, runFilter]);

  const openRunDetail = useCallback(async (runKey: string) => {
    try {
      setRunDetail(await getSopRun(runKey));
    } catch (error) {
      message.error(errorText(error, "运行详情加载失败"));
    }
  }, [message]);

  useEffect(() => { void refreshVersions(); }, [refreshVersions]);

  useEffect(() => {
    if (openVersionsOnMount && record) setVersionOpen(true);
  }, [openVersionsOnMount, record]);

  useEffect(() => {
    if (!record || !selectedVersion?.version) return;
    if (chatSaveTimer.current) window.clearTimeout(chatSaveTimer.current);
    chatSaveTimer.current = window.setTimeout(() => {
      const payload = persistableChat(messagesRef.current);
      void updateSopVersion(record.key, selectedVersion.version, { editorChat: payload }).catch(() => undefined);
    }, 800);
    return () => {
      if (chatSaveTimer.current) window.clearTimeout(chatSaveTimer.current);
    };
  }, [messages, record, selectedVersion?.version]);

  const updateSelectedNode = (next: SopGraphNode) => {
    setDraft((current) => ({
      ...current,
      graph: {
        ...current.graph,
        nodes: current.graph.nodes.map((node) => node.key === next.key ? next : node),
      },
    }));
  };

  const selectVersion = async (version: string) => {
    if (!record) return;
    try {
      const detail = await getSopVersion(record.key, version);
      setSelectedVersion(detail);
      setDraft({ ...draft, version: detail.version, triggerIntents: detail.triggerIntents || [], utteranceExamples: detail.utteranceExamples || [], graph: detail.graph });
      setMessages(chatFromVersion(detail, draft.name || record.name, detail.graph.nodes));
      setSelectedNodeKeys([]);
      setVersionOpen(false);
    } catch (error) { message.error(errorText(error, "版本内容加载失败")); }
  };

  const createEditorVersion = async () => {
    if (!record) return;
    const base = record.currentVersion || selectedVersion?.version || "1.0.0";
    const parts = base.split(".").map(Number);
    const next = `${parts[0] || 1}.${(parts[1] || 0) + 1}.0`;
    try {
      const created = await createSopVersion(record.key, { version: next, changeSummary: `基于 ${base} 创建` });
      setSelectedVersion(created);
      setDraft({ ...draft, version: created.version, graph: created.graph, triggerIntents: created.triggerIntents || [], utteranceExamples: created.utteranceExamples || [] });
      setMessages([defaultWelcome(draft.name || record.name, created.graph.nodes || draft.graph.nodes)]);
      await refreshVersions();
      setVersionOpen(false);
      message.success(`已创建可编辑草稿 ${next}`);
    } catch (error) { message.error(errorText(error, "创建新版本失败")); }
  };

  const runTrialInChat = async (
    text: string,
    assistantId: string,
    override?: {
      key?: string;
      version?: string;
      graph?: SopDraftPayload["graph"];
      payload?: Record<string, unknown>;
    },
  ) => {
    const key = override?.key || record?.key || draft.key;
    const version = override?.version || selectedVersion?.version || draft.version || record?.version?.version;
    const graph = override?.graph || draft.graph;
    const trialPayload = override?.payload;
    if ((!record && !override?.key) || !key || !version) {
      setMessages((current) => current.map((item) => (
        item.id === assistantId
          ? {
              ...item,
              content: "请先保存 SOP，再在对话里说「跑一遍流程」或点右上角「试跑」。",
              toolsLive: false,
              trial: {
                status: "failed",
                total: draft.graph.nodes.length || 1,
                current: 0,
                currentTitle: "需要先保存",
                logs: [{ time: formatTrialClock(), text: "试跑前请先保存当前流程", status: "failed" }],
              },
            }
          : item
      )));
      return;
    }

    const nodes = graph.nodes;
    const total = Math.max(nodes.length, 1);
    const startedMs = Date.now();
    const startedAt = formatTrialClock(new Date(startedMs));
    const isConfirmResume = Boolean(
      trialPayload
      && (
        trialPayload._checkpoint_confirm
        || (Array.isArray(trialPayload._confirmed_nodes) && trialPayload._confirmed_nodes.length > 0)
        || Object.keys(trialPayload).some((key) => key.startsWith("_confirm_"))
      ),
    );
    let resumeFromStep = 0;
    const patchTrial = (updater: (trial: TrialRunState) => TrialRunState, content?: string) => {
      setMessages((current) => current.map((item) => {
        if (item.id !== assistantId || !item.trial) return item;
        return {
          ...item,
          content: content ?? item.content,
          trial: updater(item.trial),
        };
      }));
    };

    setMessages((current) => current.map((item): ChatMessage => {
      if (item.id !== assistantId) return item;
      if (isConfirmResume && item.trial) {
        resumeFromStep = Math.max(1, Math.min(item.trial.current || 1, item.trial.total || total));
        const prevLogs = item.trial.logs.filter(
          (log) => log.status !== "running" && log.status !== "waiting",
        );
        return {
          ...item,
          content: `已确认，继续执行「${draft.name || "当前流程"}」后续步骤…`,
          toolsLive: true,
          trial: {
            ...item.trial,
            status: "running",
            current: resumeFromStep,
            currentTitle: "正在执行后续业务能力",
            pendingConfirm: undefined,
            startedAt: item.trial.startedAt || startedMs,
            note: "确认后继续真实执行后续节点（如报告生成）；前序收集/确认步骤会快速复核。",
            logs: [
              ...prevLogs,
              { time: startedAt, text: "已确认，继续执行后续步骤", status: "ok" as const },
              { time: startedAt, text: "正在执行后续业务节点（报告生成可能需要数十秒）…", status: "running" as const },
            ].slice(-28),
          },
        };
      }
      return {
        ...item,
        content: `好的，正在为您执行「${draft.name || "当前流程"}」整条流程，结果会边跑边出来…`,
        toolsLive: true,
        trial: {
          status: "running",
          total,
          current: 0,
          currentTitle: "准备执行",
          startedAt: startedMs,
          note: "试跑会真实跑画布节点；收集信息用演示参数即时填入，报告生成等业务能力会真实调用。",
          logs: [{ time: startedAt, text: "开始执行流程", status: "ok" }],
          pendingConfirm: undefined,
        },
      };
    }));

    const appendRunning = (label: string) => {
      patchTrial((trial) => {
        const logs = trial.logs
          .filter((log) => log.status !== "running")
          .concat({ time: formatTrialClock(), text: label, status: "running" });
        return {
          ...trial,
          currentTitle: label.replace(/^步骤\s*\d+\/\d+\s*/, "") || trial.currentTitle,
          logs: logs.slice(-24),
        };
      });
    };

    trialAbortRef.current?.abort();
    const controller = new AbortController();
    trialAbortRef.current = controller;
    activeTrialMessageIdRef.current = assistantId;

    try {
      await trialSopVersionStream(key, version, { text, graph, payload: trialPayload }, {
        signal: controller.signal,
        onHello: (data) => {
          if (controller.signal.aborted) return;
          patchTrial((trial) => ({
            ...trial,
            total: Math.max(Number(data.total) || trial.total, 1),
            currentTitle: "连接试跑通道",
          }));
        },
        onProgress: (data) => {
          if (controller.signal.aborted) return;
          const title = String(data.title || data.detail || "执行中");
          const detail = String(data.detail || title);
          // Resume after confirm: ignore the fresh "start" heartbeat so logs don't jump back.
          if (isConfirmResume && data.kind === "start") return;
          const status = mapToolStatus(data.status);
          const index = Number(data.index) || 0;
          const stepTotal = Math.max(Number(data.total) || total, 1);
          // Skip replaying early completed steps after confirm — only show work from the pause point onward.
          if (isConfirmResume && resumeFromStep > 0 && index > 0 && index < resumeFromStep && status === "ok") {
            return;
          }
          patchTrial((trial) => {
            const canvasTotal = Math.max(trial.total, stepTotal, 1);
            // Never treat the last canvas node as "done" while still running.
            const nextCurrent = status === "running" || status === "waiting"
              ? Math.min(Math.max(index, 1), canvasTotal)
              : Math.min(Math.max(index, trial.current), canvasTotal);
            const logs = trial.logs
              .filter((log) => log.status !== "running" && !log.text.startsWith("正在生成结果"))
              .concat({
                time: formatTrialClock(),
                text: data.kind === "start"
                  ? detail
                  : data.kind === "finish" && status === "waiting"
                    ? `等待确认：${title}`
                    : `步骤 ${Math.max(index, 1)}/${canvasTotal} ${detail}`,
                status: status === "failed" ? "failed" : status === "waiting" ? "waiting" : status === "running" ? "running" : "ok",
              });
            return {
              ...trial,
              total: canvasTotal,
              current: nextCurrent,
              currentTitle: title,
              logs: logs.slice(-24),
            };
          });
        },
        onHeartbeat: (data) => {
          if (controller.signal.aborted) return;
          const messageText = String(data.message || "正在生成结果，请稍候…");
          appendRunning(messageText);
          patchTrial((trial) => ({
            ...trial,
            // Keep bar below 100% while LLM / report work is in flight.
            current: Math.min(trial.current || resumeFromStep || 1, Math.max(trial.total - 1, 1)),
            currentTitle: trial.currentTitle?.includes("确认后") ? "正在生成报告" : trial.currentTitle,
          }));
        },
        onArtifactDelta: (data) => {
          if (controller.signal.aborted) return;
          patchTrial((trial) => {
            const artifacts = [...(trial.artifacts || [])];
            const existing = artifacts.find((item) => item.id === data.id);
            if (existing) {
              existing.content = `${existing.content || ""}${data.delta || ""}`;
              existing.summary = data.summary || existing.summary;
              existing.title = data.title || existing.title;
              existing.kind = data.kind || existing.kind;
            } else {
              artifacts.push({
                id: data.id,
                kind: data.kind || "markdown",
                title: data.title || "产物",
                summary: data.summary || "生成中…",
                content: data.delta || "",
              });
            }
            const normalized = normalizeTrialArtifacts(artifacts);
            const logs = trial.logs
              .filter((log) => log.status !== "running")
              .concat({
                time: formatTrialClock(),
                text: data.done ? `产物已生成：${data.title || "报告"}` : `正在输出：${data.title || "报告"}…`,
                status: data.done ? "ok" : "running",
              });
            return {
              ...trial,
              outputLabel: `已生成 ${normalized.length} 个产物`,
              artifacts: normalized,
              logs: logs.slice(-24),
            };
          });
        },
        onDone: (response) => {
          if (controller.signal.aborted) return;
          const tools = (response.tools || []).map((tool) => ({
            name: tool.name,
            summary: tool.summary,
            status: mapToolStatus(tool.status),
          }));
          const decision = String((response.result || {}).decision || "");
          const awaitingRaw = response.trialMeta?.awaitingConfirm;
          const pendingConfirm = awaitingRaw && typeof awaitingRaw === "object" && String(awaitingRaw.nodeKey || "").trim()
            ? {
                kind: String(awaitingRaw.kind || "checkpoint"),
                nodeKey: String(awaitingRaw.nodeKey),
                title: String(awaitingRaw.title || "人工确认"),
                instruction: String(awaitingRaw.instruction || "请确认后继续执行后续步骤"),
                missing: Array.isArray(awaitingRaw.missing) ? awaitingRaw.missing.map(String) : undefined,
              }
            : undefined;
          const awaitingConfirm = decision === "need_input" && Boolean(pendingConfirm);
          const failed = !awaitingConfirm && (
            decision === "block" || decision === "failed" || tools.some((tool) => tool.status === "failed")
          );
          const needMore = !awaitingConfirm && (decision === "need_input" || decision === "handoff");
          const artifacts = extractTrialArtifacts(response);
          const trialMeta = response.trialMeta || {};
          setMessages((current) => current.map((item) => {
            if (item.id !== assistantId) return item;
            // Keep streamed timestamps; rewriting with fake 400ms gaps made it look like
            // the run froze on "开始执行流程" then dumped every step at once.
            const liveLogs = (item.trial?.logs || []).filter(
              (log) => log.status !== "running" && !log.text.startsWith("正在生成结果"),
            );
            const finishLog: TrialLog = awaitingConfirm
              ? {
                  time: formatTrialClock(),
                  text: `等待确认：${pendingConfirm?.title || "人工确认"}`,
                  status: "waiting",
                }
              : {
                  time: formatTrialClock(),
                  text: failed ? "流程执行中断" : needMore ? "等待补充信息" : "流程执行完成",
                  status: failed ? "failed" : needMore ? "waiting" : "ok",
                };
            const logs = liveLogs.length > 0
              ? [...liveLogs, finishLog].slice(-28)
              : [
                  { time: startedAt, text: "开始执行流程", status: "ok" as const },
                  ...tools.map((tool, index) => ({
                    time: formatTrialClock(new Date(
                      startedMs + Math.round(((index + 1) / Math.max(tools.length, 1)) * (Date.now() - startedMs)),
                    )),
                    text: `步骤 ${index + 1}/${Math.max(tools.length, 1)} ${tool.summary || tool.name}`,
                    status: (tool.status === "failed" ? "failed" : tool.status === "waiting" ? "waiting" : "ok") as TrialLog["status"],
                  })),
                  finishLog,
                ];
            return {
              ...item,
              content: response.assistant || (awaitingConfirm
                ? "流程已停在人工确认节点，请确认后继续。"
                : failed
                  ? "试跑未完成。"
                  : "试跑已完成。"),
              model: response.model || "trial-runtime",
              tools,
              toolsLive: false,
              trial: {
                status: awaitingConfirm ? "awaiting_confirm" : failed ? "failed" : "completed",
                total: Math.max(
                  Number(trialMeta.canvasNodeCount) || 0,
                  item.trial?.total || 0,
                  total,
                  1,
                ),
                current: awaitingConfirm
                  ? Math.max(
                    1,
                    Math.min(
                      tools.findIndex((tool) => tool.status === "waiting") + 1 || tools.filter((tool) => tool.status === "ok" || tool.status === "waiting").length,
                      Number(trialMeta.canvasNodeCount) || total || 1,
                    ),
                  )
                  : Math.max(
                    Number(trialMeta.canvasNodeCount) || 0,
                    item.trial?.current || 0,
                    total,
                  ),
                currentTitle: awaitingConfirm
                  ? (pendingConfirm?.title || "等待人工确认")
                  : failed
                    ? "执行中断"
                    : needMore
                      ? "等待补充"
                      : "全部完成",
                durationSec: Math.max(1, Math.round((Date.now() - (item.trial?.startedAt || startedMs)) / 1000)),
                startedAt: item.trial?.startedAt || startedMs,
                outputLabel: awaitingConfirm
                  ? "等待确认后继续"
                  : failed
                    ? undefined
                    : needMore
                      ? "需要补充信息"
                      : (artifacts.length ? `已生成 ${artifacts.length} 个产物` : "试跑结果已生成"),
                artifacts: failed ? undefined : artifacts,
                involvesPush: Boolean(trialMeta.involvesPush),
                pushedToUser: trialMeta.involvesPush ? false : undefined,
                note: trialMeta.note
                  ? String(trialMeta.note)
                  : awaitingConfirm
                    ? "流程含人工确认节点：试跑会在此处暂停，确认后继续执行。"
                    : "试跑已按当前画布节点执行（缺失信息用演示参数自动填入），不会改动外部系统。",
                pendingConfirm,
                logs,
              },
            };
          }));
        },
        onError: (messageText) => {
          if (controller.signal.aborted) return;
          patchTrial((trial) => ({
            ...trial,
            status: "failed",
            currentTitle: "执行中断",
            logs: [
              ...trial.logs.filter((log) => log.status !== "running"),
              { time: formatTrialClock(), text: messageText, status: "failed" },
            ],
          }), messageText);
        },
      });
      if (controller.signal.aborted) return;
    } catch (error) {
      if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") {
        return;
      }
      try {
        const response = await trialSopVersion(key, version, { text, graph, payload: trialPayload });
        if (controller.signal.aborted) return;
        const tools = (response.tools || []).map((tool) => ({
          name: tool.name,
          summary: tool.summary,
          status: mapToolStatus(tool.status),
        }));
        const decision = String((response.result || {}).decision || "");
        const awaitingRaw = response.trialMeta?.awaitingConfirm;
        const pendingConfirm = awaitingRaw && typeof awaitingRaw === "object" && String(awaitingRaw.nodeKey || "").trim()
          ? {
              kind: String(awaitingRaw.kind || "checkpoint"),
              nodeKey: String(awaitingRaw.nodeKey),
              title: String(awaitingRaw.title || "人工确认"),
              instruction: String(awaitingRaw.instruction || "请确认后继续执行后续步骤"),
              missing: Array.isArray(awaitingRaw.missing) ? awaitingRaw.missing.map(String) : undefined,
            }
          : undefined;
        const awaitingConfirm = decision === "need_input" && Boolean(pendingConfirm);
        const failed = !awaitingConfirm && (
          decision === "block" || decision === "failed" || tools.some((tool) => tool.status === "failed")
        );
        const needMore = !awaitingConfirm && (decision === "need_input" || decision === "handoff");
        const artifacts = extractTrialArtifacts(response);
        const trialMeta = response.trialMeta || {};
        setMessages((current) => current.map((item) => (
          item.id === assistantId
            ? {
                ...item,
                content: response.assistant || (awaitingConfirm
                  ? "流程已停在人工确认节点，请确认后继续。"
                  : failed
                    ? "试跑未完成。"
                    : "试跑已完成。"),
                model: response.model || "trial-runtime",
                tools,
                toolsLive: false,
                trial: {
                  status: awaitingConfirm ? "awaiting_confirm" : failed ? "failed" : "completed",
                  total: Math.max(Number(trialMeta.canvasNodeCount) || 0, total, 1),
                  current: awaitingConfirm
                    ? Math.max(1, tools.filter((tool) => tool.status === "ok" || tool.status === "waiting").length)
                    : Math.max(Number(trialMeta.canvasNodeCount) || 0, total),
                  currentTitle: awaitingConfirm
                    ? (pendingConfirm?.title || "等待人工确认")
                    : failed
                      ? "执行中断"
                      : needMore
                        ? "等待补充"
                        : "全部完成",
                  durationSec: Math.max(1, Math.round((Date.now() - startedMs) / 1000)),
                  outputLabel: awaitingConfirm
                    ? "等待确认后继续"
                    : failed
                      ? undefined
                      : needMore
                        ? "需要补充信息"
                        : (artifacts.length ? `已生成 ${artifacts.length} 个产物` : "试跑结果已生成"),
                  artifacts: failed ? undefined : artifacts,
                  involvesPush: Boolean(trialMeta.involvesPush),
                  pushedToUser: trialMeta.involvesPush ? false : undefined,
                  note: trialMeta.note
                    ? String(trialMeta.note)
                    : awaitingConfirm
                      ? "流程含人工确认节点：试跑会在此处暂停，确认后继续执行。"
                      : "试跑已按当前画布节点执行（缺失信息用演示参数自动填入），不会改动外部系统。",
                  pendingConfirm,
                  logs: [
                    { time: startedAt, text: "开始执行流程", status: "ok" as const },
                    ...tools.map((tool, index) => ({
                      time: formatTrialClock(new Date(
                        startedMs + Math.round(((index + 1) / Math.max(tools.length, 1)) * (Date.now() - startedMs)),
                      )),
                      text: `步骤 ${index + 1}/${Math.max(tools.length, 1)} ${tool.summary || tool.name}`,
                      status: (tool.status === "failed" ? "failed" : tool.status === "waiting" ? "waiting" : "ok") as TrialLog["status"],
                    })),
                    {
                      time: formatTrialClock(),
                      text: awaitingConfirm
                        ? `等待确认：${pendingConfirm?.title || "人工确认"}`
                        : failed
                          ? "流程执行中断"
                          : "流程执行完成",
                      status: (awaitingConfirm ? "waiting" : failed ? "failed" : "ok") as TrialLog["status"],
                    },
                  ],
                },
              }
            : item
        )));
      } catch {
        throw error;
      }
    } finally {
      if (trialAbortRef.current === controller) trialAbortRef.current = null;
      if (activeTrialMessageIdRef.current === assistantId) activeTrialMessageIdRef.current = null;
    }
  };

  const stopTrialRun = (messageId?: string) => {
    const targetId = messageId || activeTrialMessageIdRef.current;
    trialAbortRef.current?.abort();
    trialAbortRef.current = null;
    if (!targetId) return;
    setMessages((current) => current.map((item) => {
      if (item.id !== targetId || !item.trial || item.trial.status !== "running") return item;
      return {
        ...item,
        content: "已停止本次试跑。",
        toolsLive: false,
        trial: {
          ...item.trial,
          status: "failed",
          currentTitle: "已停止",
          durationSec: item.trial.startedAt
            ? Math.max(1, Math.round((Date.now() - item.trial.startedAt) / 1000))
            : item.trial.durationSec,
          logs: [
            ...item.trial.logs.filter((log) => log.status !== "running"),
            { time: formatTrialClock(), text: "用户停止了试跑", status: "failed" },
          ],
        },
      };
    }));
    setSending(false);
  };

  const send = async (preset?: string) => {
    const text = (preset || input).trim();
    if ((!text && pendingImages.length === 0) || sending) return;
    const trial = isTrialIntent(text) && pendingImages.length === 0;
    const consult = !trial && pendingImages.length === 0 && isConsultIntent(text);
    if (!trial && readOnly) return;
    const scopedKeys = trial || consult ? [] : [...selectedNodeKeys];
    const scopeLabel = trial
      ? ""
      : consult
        ? "咨询"
        : scopedKeys.length === 0
          ? "整条流程"
          : scopedKeys.length === 1
            ? `步骤：${selectedNodes[0]?.title || scopedKeys[0]}`
            : `${scopedKeys.length} 个步骤`;
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: scopeLabel ? `【${scopeLabel === "咨询" ? "咨询" : `编辑范围：${scopeLabel}`}】${text || "（见附图）"}` : (text || "（见附图）"),
      images: pendingImages,
      createdAt: Date.now(),
    };
    const assistantId = `a-${Date.now()}`;
    const rewriteName = consult ? "list_actions" : scopedKeys.length ? "rewrite_nodes" : "rewrite_flow";
    const rewriteSummary = consult
      ? "查阅可用业务能力"
      : scopedKeys.length
        ? "修改选中步骤"
        : "改写整条流程";
    const rewriteStartedAt = Date.now();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: trial
        ? `好的，正在为您执行「${draft.name || "当前流程"}」整条流程，请稍候…`
        : "",
      tools: trial ? undefined : [{ name: "read_graph", summary: "读取当前流程", status: "running" }],
      toolsLive: !trial,
      createdAt: Date.now(),
      rewrite: trial
        ? undefined
        : {
            status: "running",
            startedAt: rewriteStartedAt,
            currentHint: consult
              ? "正在查阅可用能力…"
              : scopedKeys.length
                ? "正在读取选中步骤…"
                : "正在读取当前流程…",
            tools: [{ name: "read_graph", summary: "读取当前流程", status: "running" }],
            events: [
              {
                id: `hello-${rewriteStartedAt}`,
                kind: "hello",
                time: formatTrialClock(),
                title: "已发起改写请求",
                detail: consult
                  ? "咨询模式：只回答问题，不改流程"
                  : scopedKeys.length
                    ? `编辑范围：${scopedKeys.length} 个步骤`
                    : "编辑范围：整条流程",
                status: "ok",
              },
              {
                id: `status-${rewriteStartedAt}`,
                kind: "status",
                time: formatTrialClock(),
                title: "读取流程",
                detail: "准备调用模型…",
                status: "running",
              },
            ],
          },
      trial: trial
        ? {
            status: "running",
            total: Math.max(draft.graph.nodes.length, 1),
            current: 0,
            currentTitle: "准备执行",
            logs: [{ time: formatTrialClock(), text: "开始执行流程", status: "ok" }],
          }
        : undefined,
    };
    setMessages([...messages, userMessage, placeholder]);
    if (!preset) setInput("");
    const images = [...pendingImages];
    setPendingImages([]);
    setSending(true);

    if (trial) {
      try {
        await runTrialInChat(text, assistantId);
      } catch (error) {
        setMessages((current) => current.map((item) => (
          item.id === assistantId
            ? {
                ...item,
                content: errorText(error, "试跑失败，请稍后重试。", "trial"),
                toolsLive: false,
                trial: {
                  status: "failed",
                  total: Math.max(draft.graph.nodes.length, 1),
                  current: item.trial?.current || 0,
                  currentTitle: "试跑失败",
                  logs: [
                    ...(item.trial?.logs || []).filter((log) => log.status !== "running"),
                    { time: formatTrialClock(), text: errorText(error, "试跑失败", "trial"), status: "failed" },
                  ],
                },
              }
            : item
        )));
      } finally {
        setSending(false);
      }
      return;
    }

    const patchRewrite = (updater: (rewrite: RewriteStreamState) => RewriteStreamState) => {
      setMessages((current) => current.map((item) => {
        if (item.id !== assistantId || !item.rewrite || !item.toolsLive) return item;
        const next = updater(item.rewrite);
        return {
          ...item,
          rewrite: next,
          tools: next.tools || item.tools,
          content: "",
        };
      }));
    };

    // Fallback staged progress only if stream stays silent (e.g. non-SSE fallback path).
    const timers: number[] = [];
    timers.push(window.setTimeout(() => {
      patchRewrite((rewrite) => {
        if (rewrite.events.some((event) => event.kind === "stream" || event.kind === "heartbeat")) {
          return rewrite;
        }
        const tools = [
          { name: "read_graph", summary: "读取当前流程", status: "ok" as const },
          { name: rewriteName, summary: rewriteSummary, status: "running" as const },
        ];
        return appendRewriteEvent(
          { ...rewrite, tools, currentHint: consult ? "正在整理能力目录…" : "已读取流程，正在调用模型…" },
          {
            kind: "status",
            title: consult ? "整理能力目录" : "调用模型",
            detail: consult ? "正在整理可用业务能力…" : "模型开始处理改写请求…",
            status: "running",
          },
          "status",
        );
      });
    }, 800));

    try {
      const beforeDraft = draft;
      const requestBody = {
        instruction: text || "请根据附图修改",
        draft,
        history: messages.map(({ role, content }) => ({ role, content })),
        targetNodeKeys: scopedKeys,
        images,
        mode: consult ? "consult" as const : "edit" as const,
      };
      let response:
        | Awaited<ReturnType<typeof rewriteSopWithAi>>
        | null = null;
      let streamChars = 0;
      let usedStream = false;
      try {
        await rewriteSopWithAiStream(requestBody, {
          onHello: () => {
            usedStream = true;
            patchRewrite((rewrite) => appendRewriteEvent(
              rewrite,
              {
                kind: "hello",
                title: "流式通道已建立",
                detail: "开始接收状态与模型输出",
                status: "ok",
              },
              "hello",
            ));
          },
          onStatus: (payload) => {
            usedStream = true;
            const tools = (payload.tools || []).map((tool) => ({
              name: tool.name,
              summary: tool.summary,
              status: mapToolStatus(tool.status),
            }));
            const messageText = String(payload.message || "正在处理…");
            patchRewrite((rewrite) => appendRewriteEvent(
              {
                ...rewrite,
                tools: tools.length ? tools : rewrite.tools,
                currentHint: messageText,
              },
              {
                kind: "status",
                title: messageText.replace(/…$/, "") || "状态更新",
                detail: tools.length
                  ? tools.map((tool) => formatSopToolLabel(tool)).join(" → ")
                  : undefined,
                status: tools.some((tool) => tool.status === "failed")
                  ? "failed"
                  : tools.some((tool) => tool.status === "running")
                    ? "running"
                    : "ok",
              },
              "status",
            ));
          },
          onAssistantDelta: (payload) => {
            usedStream = true;
            const delta = String(payload.delta || "");
            if (!delta) return;
            streamChars += delta.length;
            patchRewrite((rewrite) => appendRewriteEvent(
              {
                ...rewrite,
                streamChars,
                currentHint: `模型正在输出…（已 ${streamChars} 字）`,
                tools: (rewrite.tools || []).map((tool) => (
                  ["rewrite_flow", "rewrite_nodes", "list_actions"].includes(tool.name)
                    ? { ...tool, status: "running" as const }
                    : tool
                )),
              },
              {
                kind: "stream",
                title: "模型输出中",
                detail: `已接收 ${streamChars} 字（结构草稿流式生成中，完成后会整理成可读说明）`,
                status: "running",
              },
              "stream",
            ));
          },
          onHeartbeat: (payload) => {
            usedStream = true;
            const messageText = String(payload.message || "仍在处理，请稍候…");
            patchRewrite((rewrite) => appendRewriteEvent(
              { ...rewrite, currentHint: messageText },
              {
                kind: "heartbeat",
                title: "保持连接",
                detail: messageText,
                status: "waiting",
              },
              "heartbeat",
            ));
          },
          onDone: (payload) => {
            usedStream = true;
            response = payload as Awaited<ReturnType<typeof rewriteSopWithAi>>;
          },
          onError: (messageText) => {
            throw new Error(messageText || "SOP 改写失败");
          },
        });
        if (!response) {
          throw new Error("流式改写未返回结果");
        }
      } catch {
        if (!usedStream) {
          patchRewrite((rewrite) => appendRewriteEvent(
            { ...rewrite, currentHint: "流式通道不可用，改用整包请求…" },
            {
              kind: "status",
              title: "回退到同步改写",
              detail: "SSE 不可用或中断，改用一次性请求",
              status: "waiting",
            },
          ));
        }
        response = await rewriteSopWithAi(requestBody);
      }
      timers.forEach((timer) => window.clearTimeout(timer));
      const finalResponse = response;
      if (!finalResponse) {
        throw new Error("SOP 改写未返回结果");
      }
      const unchanged = finalResponse.changed === false || finalResponse.scope === "consult";
      const tools = (finalResponse.tools || []).map((tool) => ({
        name: tool.name,
        summary: tool.summary,
        status: mapToolStatus(tool.status),
      }));
      const durationSec = Math.max(1, Math.round((Date.now() - rewriteStartedAt) / 1000));
      if (unchanged) {
        setMessages((current) => current.map((item) => (
          item.id === assistantId
            ? {
                ...item,
                content: finalResponse.assistant || "已回答，未修改流程。",
                model: finalResponse.model,
                tools: tools.length ? tools : item.tools?.map((tool) => ({ ...tool, status: "ok" as const })),
                toolsLive: false,
                rewrite: item.rewrite
                  ? {
                      ...appendRewriteEvent(
                        {
                          ...finalizeRewriteEvents(item.rewrite, "completed"),
                          durationSec,
                          tools: tools.length ? tools : item.rewrite.tools,
                          currentHint: "已完成咨询，未修改流程",
                          streamChars: item.rewrite.streamChars,
                        },
                        {
                          kind: "done",
                          title: "改写结束",
                          detail: "咨询完成，流程保持不变",
                          status: "ok",
                        },
                      ),
                      status: "completed",
                      durationSec,
                    }
                  : undefined,
              }
            : item
        )));
        return;
      }
      const change = diffFlowChange(beforeDraft, finalResponse.draft);
      setPendingDrafts((current) => ({ ...current, [assistantId]: finalResponse.draft }));
      // Preview on canvas immediately; user can still undo via the change card.
      setDraft(finalResponse.draft);
      setDirty(true);
      if (scopedKeys.length) setSelectedNodeKeys(scopedKeys);
      const chainText = change.chain.length
        ? `\n\n修改后的流程：\n${change.chain.join("\n ↓\n")}`
        : "";
      setMessages((current) => current.map((item) => (
        item.id === assistantId
          ? {
              ...item,
              content: `${finalResponse.assistant}${chainText}`,
              model: finalResponse.model,
              tools: tools.length ? tools : item.tools?.map((tool) => ({ ...tool, status: "ok" as const })),
              toolsLive: false,
              undoDraft: beforeDraft,
              flowChange: { ...change, applied: true, undone: false },
              rewrite: item.rewrite
                ? {
                    ...appendRewriteEvent(
                      {
                        ...finalizeRewriteEvents(item.rewrite, "completed"),
                        durationSec,
                        tools: tools.length ? tools : item.rewrite.tools,
                        currentHint: "改写完成，已预览到画布",
                        streamChars: item.rewrite.streamChars,
                      },
                      {
                        kind: "done",
                        title: "改写完成",
                        detail: `耗时 ${durationSec}s · 已写入 ${finalResponse.draft.graph.nodes.length} 个步骤`,
                        status: "ok",
                      },
                    ),
                    status: "completed",
                    durationSec,
                  }
                : undefined,
            }
          : item
      )));
    } catch (error) {
      timers.forEach((timer) => window.clearTimeout(timer));
      setMessages((current) => current.map((item) => {
        if (item.id !== assistantId) return item;
        const tools = [...(item.tools || [])];
        if (tools.length) {
          const last = tools.length - 1;
          tools[last] = { ...tools[last], status: "failed" };
        } else {
          tools.push({ name: rewriteName, summary: rewriteSummary, status: "failed" });
        }
        const errText = errorText(
          error,
          consult ? "暂时无法回答，请稍后重试。" : "AI 暂时无法修改这个流程，请稍后重试。",
          "rewrite",
        );
        return {
          ...item,
          content: errText,
          tools,
          toolsLive: false,
          rewrite: item.rewrite
            ? {
                ...appendRewriteEvent(
                  {
                    ...finalizeRewriteEvents(item.rewrite, "failed"),
                    durationSec: Math.max(1, Math.round((Date.now() - rewriteStartedAt) / 1000)),
                    tools,
                    currentHint: errText,
                  },
                  {
                    kind: "error",
                    title: "改写失败",
                    detail: errText,
                    status: "failed",
                  },
                ),
                status: "failed",
              }
            : undefined,
        };
      }));
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async (): Promise<SopDefinitionItem | null> => {
    if (!draft.key.trim()) {
      message.warning("请先用左侧对话生成流程，或补全 SOP 名称后再保存");
      return null;
    }
    setSaving(true);
    const payload = { ...draft, inputSchema: {}, outputSchema: {} };
    try {
      let saved: SopDefinitionItem;
      if (!record) saved = await createSop(payload);
      else {
        await updateSop(record.key, payload);
        saved = selectedVersion?.status === "draft"
          ? await updateSopVersion(record.key, selectedVersion.version, {
              ...payload,
              editorChat: persistableChat(messagesRef.current),
            }).then(() => getSop(record.key))
          : await getSop(record.key);
      }
      message.success("SOP 草稿已保存");
      setDirty(false);
      setSelectedVersion(saved.version);
      await refreshVersions();
      onSaved(saved);
      return saved;
    } catch (error) {
      message.error(errorText(error, "SOP 草稿保存失败"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publishCurrent = async () => {
    if (!record || selectedVersion?.status !== "draft") return;
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const published = await publishSopVersion(record.key, selectedVersion.version);
      setSelectedVersion(published.version);
      await refreshVersions();
      message.success(`SOP ${selectedVersion.version} 已发布`);
      onSaved(published);
    } catch (error) { message.error(errorText(error, "版本发布失败")); }
  };

  const trialRun = async () => {
    if (sending) return;
    if (!record) {
      const saved = await saveDraft();
      const savedVersion = saved?.version;
      if (!savedVersion) return;
      if (!saved?.version) return;
      const savedVersion = saved.version;
      const text = "跑一遍流程";
      const assistantId = `a-${Date.now()}`;
      setMessages((current) => [
        ...current,
        { id: `u-${Date.now()}`, role: "user", content: text },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          toolsLive: true,
          trial: {
            status: "running",
            total: Math.max((savedVersion.graph?.nodes || draft.graph.nodes).length, 1),
            current: 0,
            currentTitle: "准备执行",
            logs: [{ time: formatTrialClock(), text: "开始执行流程", status: "ok" }],
          },
        },
      ]);
      setSending(true);
      try {
        await runTrialInChat(text, assistantId, {
          key: saved.key,
          version: savedVersion.version,
          graph: savedVersion.graph || draft.graph,
          key: saved!.key,
          version: savedVersion.version,
          graph: savedVersion.graph || draft.graph,
        });
      } catch (error) {
        setMessages((current) => current.map((item) => (
          item.id === assistantId
            ? {
                ...item,
                content: errorText(error, "试跑失败，请稍后重试。", "trial"),
                toolsLive: false,
                trial: {
                  status: "failed",
                  total: Math.max(draft.graph.nodes.length, 1),
                  current: 0,
                  currentTitle: "试跑失败",
                  logs: [{ time: formatTrialClock(), text: errorText(error, "试跑失败", "trial"), status: "failed" }],
                },
              }
            : item
        )));
      } finally {
        setSending(false);
      }
      return;
    }
    await send("跑一遍流程");
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const applyFlowChange = (messageId: string) => {
    const next = pendingDrafts[messageId];
    if (next) {
      setDraft(next);
      setDirty(true);
    }
    setMessages((current) => current.map((item) => (
      item.id === messageId && item.flowChange
        ? { ...item, flowChange: { ...item.flowChange, applied: true, undone: false } }
        : item
    )));
  };

  const undoFlowChange = (messageId: string) => {
    setMessages((current) => {
      const target = current.find((item) => item.id === messageId);
      if (target?.undoDraft) {
        setDraft(target.undoDraft);
        setDirty(true);
      }
      return current.map((item) => (
        item.id === messageId && item.flowChange
          ? { ...item, flowChange: { ...item.flowChange, applied: false, undone: true } }
          : item
      ));
    });
  };

  useEffect(() => {
    if (!autoTrialOnMount || autoTrialDone.current || !record) return;
    autoTrialDone.current = true;
    const timer = window.setTimeout(() => { void trialRun(); }, 200);
    return () => window.clearTimeout(timer);
    // Only auto-trigger once when opening from list "试跑".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrialOnMount, record?.key]);

  return <section className="sop-distill-page is-agent-chat">
    <header className="sop-agent-topbar">
      <div className="sop-agent-topbar-left">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
        <span className="sop-agent-topbar-icon" aria-hidden><BranchesOutlined /></span>
        <div>
          <strong>整条流程编辑</strong>
          <p>通过自然语言持续调整你的 AI 工作流程</p>
        </div>
      </div>
      <div className="sop-agent-topbar-right">
        <button type="button" className={editMode === "flow" ? "is-active" : ""} onClick={clearSelection}>整条流程</button>
        <button type="button" onClick={() => record && setVersionOpen(true)}>
          当前版本 v{selectedVersion?.version || draft.version}
        </button>
        {record && (
          <Button icon={<ThunderboltOutlined />} onClick={() => { setEvolutionTab("evolve"); void openRuns(); }}>
            自我进化
          </Button>
        )}
        <Button icon={<SaveOutlined />} loading={saving} disabled={readOnly} onClick={() => void saveDraft()}>保存流程</Button>
        {record?.canEdit && selectedVersion?.status === "draft" && <Button type="primary" onClick={() => void publishCurrent()}>发布</Button>}
        {record?.canEdit && !record.system && (
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              modal.confirm({
                title: `删除「${draft.name || record.name}」？`,
                content: "将永久删除该 SOP 及其版本与试跑记录，此操作不可恢复。",
                okText: "删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: async () => {
                  try {
                    await deleteSop(record.key);
                    message.success("已删除");
                    onBack();
                  } catch (error) {
                    message.error(errorText(error, "删除失败"));
                    throw error;
                  }
                },
              });
            }}
          >
            删除
          </Button>
        )}
        <em className={`sop-agent-save-state${dirty ? " is-dirty" : ""}`}>
          <i />
          {dirty ? "未保存" : "已保存"}
        </em>
      </div>
    </header>
    <div className="sop-distill-workbench">
      <section className="sop-chat-panel is-agent">
        <div className="sop-chat-panel-head">
          <div className="sop-chat-panel-brand">
            <span className="sop-chat-panel-icon" aria-hidden><BranchesOutlined /></span>
            <div>
              <strong>{draft.name || "未命名流程"}</strong>
              <p>
                {editMode === "flow"
                  ? "对话式编辑您的整条流程"
                  : editMode === "node"
                    ? `正在聚焦「${selectedNode?.title || "当前步骤"}」`
                    : `已选中 ${selectedNodeKeys.length} 个步骤，可统一修改`}
              </p>
            </div>
          </div>
          <div className="sop-chat-mode-switch">
            <button type="button" className={editMode === "flow" ? "is-active" : ""} onClick={clearSelection}>整条流程</button>
            <span className={editMode === "flow" ? "" : "is-active"}>
              {editMode === "flow" ? "未选步骤" : editMode === "node" ? "已选 1 步" : `已选 ${selectedNodeKeys.length} 步`}
            </span>
          </div>
        </div>

        <div className="sop-chat-messages is-agent">
          {messages.map((item) => (
            <div key={item.id} className={`sop-chat-row is-${item.role}`}>
              {item.role === "assistant" ? <SopAiAvatar /> : (
                <SopPreviewableAvatar src={authenticatedAvatarUrl(user?.avatar_url)} />
              )}
              <div className="sop-chat-col">
                <div className="sop-chat-meta">
                  <span>{item.role === "assistant" ? "小助手" : "我"}</span>
                  <time>{formatChatClock(item.createdAt)}</time>
                </div>
                {item.content && !(item.toolsLive && item.rewrite) ? (
                  <div className={`sop-chat-bubble${item.toolsLive && !item.trial && !item.flowChange && !item.rewrite ? " is-thinking" : ""}`}>
                    {item.role === "assistant" ? (
                      <ChatMarkdown content={item.content} />
                    ) : (
                      <p>{item.content}</p>
                    )}
                    {!!item.images?.length && (
                      <div className="sop-chat-images">
                        <Image.PreviewGroup>
                          {item.images.map((url) => (
                            <Image key={url.slice(0, 48)} src={url} alt="附件" width={72} height={72} />
                          ))}
                        </Image.PreviewGroup>
                      </div>
                    )}
                    {item.model && !item.trial && <small>{item.model}</small>}
                  </div>
                ) : null}
                {item.rewrite ? <SopRewriteTimelinePanel rewrite={item.rewrite} /> : null}
                {item.trial ? (
                  <SopTrialRunCard
                    trial={item.trial}
                    onRerun={() => void send("跑一遍流程")}
                    onStop={() => stopTrialRun(item.id)}
                    onConfirm={() => {
                      const confirm = item.trial?.pendingConfirm;
                      if (!confirm?.nodeKey) return;
                      void runTrialInChat("确认后继续试跑", item.id, {
                        payload: {
                          _confirmed_nodes: [confirm.nodeKey],
                          [`_confirm_${confirm.nodeKey}`]: true,
                        },
                      });
                    }}
                    onReject={() => {
                      setMessages((current) => current.map((row) => {
                        if (row.id !== item.id || !row.trial) return row;
                        return {
                          ...row,
                          content: "已驳回人工确认，试跑结束。",
                          trial: {
                            ...row.trial,
                            status: "failed",
                            currentTitle: "已驳回确认",
                            pendingConfirm: undefined,
                            logs: [
                              ...row.trial.logs.filter((log) => log.status !== "running" && log.status !== "waiting"),
                              { time: formatTrialClock(), text: "用户驳回了人工确认", status: "failed" },
                            ],
                          },
                        };
                      }));
                    }}
                  />
                ) : null}
                {item.flowChange ? (
                  <SopFlowChangeCard
                    change={item.flowChange}
                    onApply={() => applyFlowChange(item.id)}
                    onUndo={() => undoFlowChange(item.id)}
                  />
                ) : null}
                {!item.trial && !item.flowChange && !item.rewrite && (!!item.tools?.length || item.toolsLive) && (
                  <div className={`sop-chat-bubble${item.toolsLive ? " is-thinking" : ""}`}>
                    <SopToolProcess
                      tools={item.tools || []}
                      live={Boolean(item.toolsLive)}
                      liveHint={item.toolsLive ? (item.content || "正在处理…") : ""}
                    />
                  </div>
                )}
                {!item.content && item.toolsLive && !item.trial && !item.rewrite && !(item.tools?.length) && (
                  <div className="sop-chat-bubble is-thinking"><p>正在思考…</p></div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="sop-chat-composer is-agent">
          <div className="sop-quick-label">快速操作</div>
          <div className="sop-prompt-chips is-agent">
            {(readOnly ? QUICK_ACTIONS.filter((chip) => chip.accent) : activeChips).map((chip) => (
              <button
                type="button"
                key={chip.text}
                className={"accent" in chip && chip.accent ? "is-accent" : ""}
                disabled={sending}
                onClick={() => setInput(chip.text)}
              >
                {chipIcon(chip.icon)}
                <span>{chip.text}</span>
              </button>
            ))}
          </div>
          {pendingImages.length > 0 && (
            <div className="sop-pending-images">
              <Image.PreviewGroup>
                {pendingImages.map((url, index) => (
                  <div className="sop-pending-image" key={`${index}-${url.slice(0, 24)}`}>
                    <Image src={url} alt={`待发送图片 ${index + 1}`} width={72} height={72} />
                    <button
                      type="button"
                      className="sop-pending-image-remove"
                      aria-label="移除图片"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </Image.PreviewGroup>
            </div>
          )}
          <div className="sop-agent-input">
            <Input.TextArea
              value={input}
              maxLength={2000}
              onChange={(event) => setInput(event.target.value)}
              onPaste={(event) => {
                if (readOnly) return;
                const items = event.clipboardData?.items;
                if (!items) return;
                const files: File[] = [];
                for (let index = 0; index < items.length; index += 1) {
                  const clip = items[index];
                  if (clip.type.startsWith("image/")) {
                    const file = clip.getAsFile();
                    if (file) files.push(file);
                  }
                }
                if (!files.length) return;
                event.preventDefault();
                void addImageFiles(files);
              }}
              onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send(); } }}
              placeholder="输入你的需求… 支持 Ctrl+V 粘贴截图、上传图片、描述修改要求"
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
            <div className="sop-agent-input-footer">
              <div className="sop-agent-input-left">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    void addImageFiles(files);
                  }}
                />
                <button type="button" disabled={readOnly || sending} onClick={() => fileInputRef.current?.click()}>
                  <PaperClipOutlined /> 上传
                </button>
                <button
                  type="button"
                  disabled={sending || readOnly}
                  onClick={() => setInput("优化整条流程，让步骤更清晰可执行")}
                >
                  <ThunderboltOutlined /> AI 优化
                </button>
              </div>
              <div className="sop-agent-input-right">
                <span>{input.length} / 2000</span>
                <Button
                  type="primary"
                  className="sop-chat-send-btn"
                  icon={sending ? <LoadingOutlined /> : <SendOutlined />}
                  disabled={
                    sending
                    || (!input.trim() && pendingImages.length === 0)
                    || (readOnly && !isTrialIntent(input.trim()))
                  }
                  onClick={() => void send()}
                >
                  {sending ? "处理中" : "发送"}
                </Button>
              </div>
            </div>
          </div>
          <p className="sop-chat-tip">小贴士：支持拖拽/粘贴截图；按住 Ctrl/⌘ 多选步骤；验证无误后再试跑。</p>
        </div>
      </section>

      <section className={`sop-design-panel${selectedNode && view === "flow" ? " has-biz-panel" : ""}`}>
        <div className="sop-panel-title">
          <strong>{view === "flow" ? "流程预览" : "高级配置"}</strong>
          <Space>
            <span className="sop-panel-hint">{view === "flow" ? "拖动移动 · 单击选中 · Del 删除" : "仅在需要时打开"}</span>
            <Button icon={view === "flow" ? <CodeOutlined /> : <BranchesOutlined />} onClick={() => { setView(view === "flow" ? "source" : "flow"); clearSelection(); }}>
              {view === "flow" ? "高级配置" : "回到流程"}
            </Button>
          </Space>
        </div>
        <div className="sop-design-body">
          {view === "flow" ? (
            <>
              <SopFlowCanvas
                draft={draft}
                selectedKeys={selectedNodeKeys}
                onSelect={selectNode}
                onClear={clearSelection}
                readOnly={readOnly}
                actionTitles={actionTitles}
                onConnectEdge={connectEdge}
                onDeleteEdge={deleteEdge}
                onAddNode={addCanvasNode}
                onDeleteNodes={deleteCanvasNodes}
                onMoveNodes={moveCanvasNodes}
                onResetLayout={resetCanvasLayout}
              />
              {selectedNode && (
                <SopBusinessNodePanel
                  node={selectedNode}
                  disabled={readOnly}
                  actions={actions}
                  assets={assets}
                  knowledgeBases={knowledgeBases}
                  onChange={updateSelectedNode}
                  onClose={clearSelection}
                  onDelete={
                    readOnly || selectedNode.key === draft.graph.start || draft.graph.terminals.includes(selectedNode.key)
                      ? undefined
                      : () => deleteCanvasNodes([selectedNode.key])
                  }
                />
              )}
            </>
          ) : (
            <SopStructuredSource draft={draft} disabled={readOnly} onChange={setDraft} />
          )}
        </div>
      </section>
    </div>
    <Modal open={versionOpen} title="版本管理" footer={null} width={720} onCancel={() => setVersionOpen(false)}>
      <div className="sop-version-manager">
        <div className="sop-version-manager-head">
          <div><strong>{record?.name}</strong><span>已发布版本不可修改；创建新版本后可继续编辑。</span></div>
          {record?.canEdit && !versions.some((version) => version.status === "draft") && <Button type="primary" icon={<PlusOutlined />} onClick={() => void createEditorVersion()}>创建新版本</Button>}
        </div>
        <div className="sop-version-list">
          {versions.map((version) => <button type="button" className={version.version === selectedVersion?.version ? "is-active" : ""} key={version.id} onClick={() => void selectVersion(version.version)}>
            <span><strong>v{version.version}</strong><Tag color={version.status === "draft" ? "gold" : version.status === "published" ? "green" : "default"}>{version.status === "draft" ? "草稿" : version.status === "published" ? "当前发布" : "历史"}</Tag></span>
            <span>{version.changeSummary || "版本内容更新"}</span>
            <small>{version.publishedAt ? `发布于 ${new Date(version.publishedAt).toLocaleString()}` : `创建于 ${new Date(version.createdAt).toLocaleString()}`}</small>
          </button>)}
        </div>
      </div>
    </Modal>
    <Modal
      open={runsOpen}
      title="自我进化"
      footer={null}
      width={920}
      onCancel={() => { setRunsOpen(false); setRunDetail(null); }}
    >
      <div className="sop-evo-shell">
        <div className="sop-evo-hero">
          <div>
            <strong>{record?.name}</strong>
            <p>从运行结果学习 → 生成可校验的改流程提案 → 你确认后写入草稿 → 手动发布。系统不会偷偷改线上版本。</p>
            {evolutionMetrics && evolutionMetrics.enabled === false && (
              <p style={{ color: "#b45309" }}>当前企业已关闭 SOP 自我进化，请到「企业与成员 → 企业设置」开启。</p>
            )}
          </div>
          {record?.canEdit && !record.system && (
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={analyzingEvolution}
              disabled={evolutionMetrics?.enabled === false}
              onClick={() => {
                setEvolutionTab("evolve");
                void runAnalyzeEvolution();
              }}
            >
              分析并生成提案
            </Button>
          )}
        </div>
        <Tabs
          activeKey={evolutionTab}
          onChange={(key) => setEvolutionTab(key as "runs" | "evolve")}
          items={[
            {
              key: "evolve",
              label: `进化提案${proposalRows.length ? ` (${proposalRows.length})` : ""}`,
              children: (
                <div className="sop-evo-pane">
                  <div className="sop-evo-metrics">
                    <div>
                      <em>{evolutionMetrics?.definition.successRate ?? record?.successRate ?? 0}%</em>
                      <span>正式成功率</span>
                    </div>
                    <div>
                      <em>{evolutionMetrics?.signalCount ?? signalRows.length}</em>
                      <span>信号条目</span>
                    </div>
                    <div>
                      <em>{evolutionMetrics?.pendingProposals ?? proposalRows.filter((row) => !["accepted", "rejected", "expired"].includes(row.status)).length}</em>
                      <span>待处理提案</span>
                    </div>
                    <div>
                      <em>{runRows.filter((row) => !row.isTrial).length}/{runRows.filter((row) => row.isTrial).length}</em>
                      <span>正式 / 试跑</span>
                    </div>
                  </div>
                  {!!evolutionMetrics?.acceptedComparisons?.length && (
                    <div className="sop-run-signals">
                      <strong>采纳前后成功率对比</strong>
                      <div className="sop-proposal-list">
                        {evolutionMetrics.acceptedComparisons.slice(0, 5).map((row) => (
                          <div key={row.proposalId} className="sop-proposal-card">
                            <div className="sop-proposal-card-head">
                              <strong>{row.title}</strong>
                              <Tag color={row.deltaSuccessRate >= 0 ? "green" : "red"}>
                                {row.deltaSuccessRate >= 0 ? "+" : ""}{row.deltaSuccessRate}%
                              </Tag>
                            </div>
                            <p>
                              基线 v{row.before.version || "—"}：{row.before.successRate}%（{row.before.callCount} 次）
                              {" → "}
                              进化稿 v{row.after.version || "—"}：{row.after.successRate}%（{row.after.callCount} 次）
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!!signalRows.length && (
                    <div className="sop-run-signals">
                      <strong>当前学到的信号</strong>
                      <div className="sop-run-signal-chips">
                        {signalRows.slice(0, 10).map((signal) => (
                          <Tag key={signal.id} color={(signal.payloadSummary as { from_trial?: boolean })?.from_trial ? "blue" : "default"}>
                            {SOP_SIGNAL_LABEL[signal.signalType] || signal.signalType}
                            {signal.nodeKey ? ` · ${signal.nodeKey}` : ""} ×{signal.count}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  )}
                  {!proposalRows.length ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        evolutionMetrics?.enabled === false
                          ? "企业已关闭自我进化。"
                          : signalRows.length
                            ? "已有信号，点击右上角「分析并生成提案」。"
                            : "还没有可学习的信号。先在编辑器里多试跑几次（确认点暂停是正常的），或等正式执行产生卡点/失败后再分析。"
                      }
                    />
                  ) : (
                    <div className="sop-proposal-list">
                      {proposalRows.map((proposal) => (
                        <div key={proposal.id} className="sop-proposal-card">
                          <div className="sop-proposal-card-head">
                            <strong>{proposal.title}</strong>
                            <Space size={4}>
                              <Tag>{SOP_PROPOSAL_STATUS[proposal.status] || proposal.status}</Tag>
                              <Tag color={proposal.riskLevel === "high" ? "red" : proposal.riskLevel === "medium" ? "orange" : "green"}>
                                {proposal.riskLevel === "high" ? "高风险" : proposal.riskLevel === "medium" ? "中风险" : "低风险"}
                              </Tag>
                            </Space>
                          </div>
                          <p>{proposal.rationale || "—"}</p>
                          {proposal.draftVersion && <small>已落到草稿 v{proposal.draftVersion}（发布后才会影响正式执行）</small>}
                          {(proposal.evidence as { skillId?: string })?.skillId && (
                            <small>草稿技能：{(proposal.evidence as { skillId?: string }).skillId}</small>
                          )}
                          {record?.canEdit && !record.system && !["accepted", "rejected", "expired"].includes(proposal.status) && (
                            <Space wrap size={6} style={{ marginTop: 8 }}>
                              <Button size="small" loading={proposalBusyId === proposal.id} onClick={() => void handleProposalAction("trial", proposal.id)}>验证试跑</Button>
                              <Button size="small" loading={proposalBusyId === proposal.id} onClick={() => void handleProposalAction("draft", proposal.id)}>写入草稿</Button>
                              <Button size="small" type="primary" loading={proposalBusyId === proposal.id} onClick={() => void handleProposalAction("accept", proposal.id)}>采纳</Button>
                              <Button size="small" danger loading={proposalBusyId === proposal.id} onClick={() => void handleProposalAction("reject", proposal.id)}>忽略</Button>
                            </Space>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: "runs",
              label: "运行记录",
              children: (
                <div className="sop-evo-pane">
                  <div className="sop-evo-runs-toolbar">
                    <Select
                      size="small"
                      value={runFilter}
                      style={{ width: 120 }}
                      options={[
                        { value: "all", label: "全部" },
                        { value: "live", label: "正式" },
                        { value: "trial", label: "试跑" },
                      ]}
                      onChange={(value: "all" | "live" | "trial") => {
                        setRunFilter(value);
                        void refreshRuns(value);
                      }}
                    />
                    <Button size="small" icon={<ReloadOutlined />} loading={runsLoading} onClick={() => void refreshRuns()}>刷新</Button>
                  </div>
                  <Spin spinning={runsLoading}>
                    {!runRows.length ? (
                      <Empty description="暂无运行记录" />
                    ) : (
                      <div className="sop-version-list sop-run-list">
                        {runRows.map((run) => (
                          <button
                            type="button"
                            key={run.runKey}
                            className={runDetail?.runKey === run.runKey ? "is-active" : ""}
                            onClick={() => void openRunDetail(run.runKey)}
                          >
                            <span>
                              <strong>{SOP_RUN_STATUS_LABEL[run.status] || run.status}</strong>
                              <Tag color={run.isTrial ? "blue" : "default"}>{run.isTrial ? "试跑" : run.source === "resume" ? "续跑" : "正式"}</Tag>
                              <Tag>v{run.version}</Tag>
                            </span>
                            <span>
                              {run.currentNode ? `节点 ${run.currentNode}` : "—"}
                              {run.error ? ` · ${run.error}` : ""}
                              {run.missingFields?.length ? ` · 缺少 ${run.missingFields.slice(0, 3).join("、")}` : ""}
                            </span>
                            <small>{run.startedAt ? new Date(run.startedAt).toLocaleString() : ""}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </Spin>
                  {runDetail && (
                    <div className="sop-run-detail">
                      <strong>步骤明细 · {runDetail.traceId}</strong>
                      <div className="sop-run-detail-nodes">
                        {(runDetail.nodes || []).map((node) => (
                          <div key={`${node.sequence}-${node.nodeKey}`}>
                            <span>#{node.sequence} {node.title || node.nodeKey}</span>
                            <Tag>{SOP_RUN_STATUS_LABEL[node.status] || node.status}</Tag>
                            <em>{node.error || node.nodeType}</em>
                          </div>
                        ))}
                        {!runDetail.nodes?.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无节点明细" />}
                      </div>
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    </Modal>
  </section>;
}

export default function SopCenter() {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<SopDefinitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<{
    draft: SopDraftPayload;
    record?: SopDefinitionItem;
    openVersions?: boolean;
    autoTrial?: boolean;
  }>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems((await listSops()).results || []); }
    catch (error) { message.error(errorText(error, "SOP 加载失败")); }
    finally { setLoading(false); }
  }, [message]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toDraft = (detail: SopDefinitionItem): SopDraftPayload => ({
    key: detail.key,
    name: detail.name,
    businessDomain: detail.businessDomain,
    description: detail.description,
    actionName: detail.actionName,
    version: detail.version?.version || detail.currentVersion || "1.0.0",
    triggerIntents: detail.version?.triggerIntents || [],
    utteranceExamples: detail.version?.utteranceExamples || [],
    graph: detail.version?.graph || EMPTY_GRAPH,
  });

  const copySystem = async (item: SopDefinitionItem) => {
    try {
      const copy = await duplicateSop(item.key);
      const detail = await getSop(copy.key);
      message.success(`已复制为「${detail.name}」`);
      await refresh();
      setEditor({ draft: toDraft(detail), record: detail });
    } catch (error) { message.error(errorText(error, "复制失败")); }
  };

  const openEdit = async (item: SopDefinitionItem, options?: { openVersions?: boolean }) => {
    if (item.system && !options?.openVersions) {
      message.info("系统画廊模板不可原地编辑，请先复制到当前工作区");
      await copySystem(item);
      return;
    }
    try {
      const detail = await getSop(item.key);
      setEditor({ draft: toDraft(detail), record: detail, openVersions: options?.openVersions });
    }
    catch (error) { message.error(errorText(error, "SOP 详情加载失败")); }
  };

  const createNextVersion = async (item: SopDefinitionItem) => {
    const parts = (item.currentVersion || "1.0.0").split(".").map(Number);
    const next = `${parts[0] || 1}.${(parts[1] || 0) + 1}.0`;
    try { await createSopVersion(item.key, { version: next, changeSummary: `基于 ${item.currentVersion} 创建` }); await refresh(); await openEdit(item); }
    catch (error) { message.error(errorText(error, "创建新版本失败")); }
  };

  const publish = async (item: SopDefinitionItem) => {
    try {
      const detail = await getSop(item.key);
      if (!detail.version || detail.version.status !== "draft") return message.warning("当前没有可发布的草稿版本");
      await publishSopVersion(item.key, detail.version.version);
      message.success(`SOP ${detail.version.version} 已发布`);
      await refresh();
    } catch (error) { message.error(errorText(error, "SOP 发布失败")); }
  };

  const removeSop = (item: SopDefinitionItem) => {
    if (item.system) {
      message.warning("系统画廊模板不能删除，可复制到工作区后再管理");
      return;
    }
    modal.confirm({
      title: `删除「${item.name}」？`,
      content: "将永久删除该 SOP 及其版本与试跑记录，此操作不可恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteSop(item.key);
          message.success("已删除");
          if (editor?.record?.key === item.key) setEditor(undefined);
          await refresh();
        } catch (error) {
          message.error(errorText(error, "删除失败"));
          throw error;
        }
      },
    });
  };

  const runSopTemplate = async (row: SopDefinitionItem) => {
    try {
      const detail = await getSop(row.key);
      setEditor({ draft: toDraft(detail), record: detail, autoTrial: true });
    } catch (error) {
      message.error(errorText(error, "SOP 详情加载失败"));
    }
  };

  const visibleItems = useMemo(() => items.filter((row) => {
    if (statusFilter === "published" && sopStatusLabel(row) !== "published") return false;
    if (statusFilter === "draft" && sopStatusLabel(row) !== "draft") return false;
    if (!keyword.trim()) return true;
    const q = keyword.trim().toLowerCase();
    const meta = sopMeta(row);
    return `${row.name} ${row.description} ${row.key} ${meta.label} ${meta.tags.join(" ")}`.toLowerCase().includes(q);
  }), [items, keyword, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visibleItems.slice(start, start + pageSize);
  }, [page, pageSize, visibleItems]);

  const columns = [
    {
      title: "模板名称",
      key: "name",
      width: "34%",
      render: (_: unknown, row: SopDefinitionItem) => {
        const meta = sopMeta(row);
        return (
          <div className="sop-template-name-cell">
            <span className={`sop-template-icon is-${meta.tone}`}>{meta.icon}</span>
            <div>
              <strong>{row.name}</strong>
              <p>{row.description || "暂无描述"}</p>
              <div className="sop-template-tags">
                {row.system && <span>画廊模板</span>}
                {meta.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </div>
          </div>
        );
      },
    },
    { title: "分类", key: "category", width: 110, render: (_: unknown, row: SopDefinitionItem) => sopMeta(row).label },
    { title: "版本", dataIndex: "currentVersion", width: 90 },
    { title: "节点数", dataIndex: "nodeCount", width: 90, render: (value: number) => `${value || 0} 个` },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_: unknown, row: SopDefinitionItem) => (
        <span className={`sop-template-status is-${sopStatusLabel(row)}`}>
          {sopStatusLabel(row) === "draft" ? "草稿" : "已发布"}
        </span>
      ),
    },
    { title: "执行次数", dataIndex: "callCount", width: 100, render: (value: number) => `${value || 0} 次` },
    { title: "试跑", dataIndex: "trialCount", width: 80, render: (value: number) => `${value || 0}` },
    { title: "成功率", dataIndex: "successRate", width: 90, render: (value: number) => `${value || 0}%` },
    {
      title: "进化",
      dataIndex: "pendingEvolutionCount",
      width: 80,
      render: (value: number) => (value ? <Tag color="purple">{value}</Tag> : "—"),
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_: unknown, row: SopDefinitionItem) => {
        const moreItems = row.system
          ? [
            { key: "versions", label: "版本管理", onClick: () => void openEdit(row, { openVersions: true }) },
            { key: "copy", label: "复制后编辑", onClick: () => void copySystem(row) },
          ]
          : [
            { key: "edit", label: row.hasDraft ? "AI 编辑草稿" : "查看流程", onClick: () => void openEdit(row) },
            { key: "versions", label: "版本管理", onClick: () => void openEdit(row, { openVersions: true }) },
            ...(row.status === "published" && !row.hasDraft
              ? [{ key: "version", label: "创建新版本", onClick: () => void createNextVersion(row) }]
              : [{
                key: "publish",
                label: "发布草稿",
                onClick: () => {
                  modal.confirm({
                    title: "发布这个 SOP 草稿？",
                    content: "发布后版本内容与 Hash 将固定。",
                    okText: "发布",
                    onOk: () => publish(row),
                  });
                },
              }]),
            { key: "duplicate", label: "复制模板", onClick: () => void copySystem(row) },
            { key: "delete", label: "删除", danger: true, onClick: () => removeSop(row) },
          ];
        return (
          <div className="sop-template-actions">
            <Button className="sop-template-run-btn" size="small" icon={<PlayCircleOutlined />} onClick={() => void runSopTemplate(row)}>
              试跑
            </Button>
            <Tooltip title="复制">
              <Button
                className="sop-template-copy-btn"
                size="small"
                icon={<CopyOutlined />}
                aria-label={`复制${row.name}`}
                onClick={() => void copySystem(row)}
              />
            </Tooltip>
            <Tooltip title="版本管理">
              <Button
                className="sop-template-version-btn"
                size="small"
                icon={<HistoryOutlined />}
                aria-label={`版本管理${row.name}`}
                onClick={() => void openEdit(row, { openVersions: true })}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: moreItems.map((item) => ({
                  key: item.key,
                  label: item.label,
                  danger: Boolean((item as { danger?: boolean }).danger),
                  onClick: () => item.onClick(),
                })),
              }}
              trigger={["click"]}
            >
              <Tooltip title="更多操作">
                <Button className="sop-template-more-btn" size="small" icon={<MoreOutlined />} aria-label="更多操作" />
              </Tooltip>
            </Dropdown>
          </div>
        );
      },
    },
  ];

  if (editor) {
    return (
      <SopEditor
        initial={editor.draft}
        record={editor.record}
        openVersionsOnMount={editor.openVersions}
        autoTrialOnMount={editor.autoTrial}
        onBack={() => { setEditor(undefined); void refresh(); }}
        onSaved={(item) => { setEditor({ draft: toDraft(item), record: item }); void refresh(); }}
      />
    );
  }

  return (
    <div className="sop-center">
      <section className="sop-create-banner">
        <div className="sop-create-banner-copy">
          <span className="sop-create-banner-icon"><PlusOutlined /></span>
          <div>
            <strong>创建空白 SOP</strong>
            <p>从零开始创建，完全自定义每个步骤和规则</p>
          </div>
        </div>
        <Button type="primary" className="sop-create-banner-btn" icon={<PlusOutlined />} onClick={() => setEditor({ draft: EMPTY_DRAFT })}>
          创建 SOP
        </Button>
      </section>

      <section className="sop-list-panel">
        <div className="sop-list-toolbar">
          <h3>SOP 列表</h3>
          <div className="sop-list-toolbar-actions">
            <Input.Search
              allowClear
              value={keyword}
              placeholder="搜索模板名称或描述"
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(value) => setStatusFilter(value)}
            />
          </div>
        </div>

        <Spin spinning={loading}>
          {visibleItems.length || loading ? (
            <Table
              className="sop-template-table"
              rowKey="id"
              columns={columns}
              dataSource={pagedItems}
              pagination={{
                current: page,
                pageSize,
                total: visibleItems.length,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (total) => `共 ${total} 条记录`,
                onChange: (nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                },
              }}
              scroll={{ x: 1080 }}
              locale={{ emptyText: "暂无 SOP" }}
            />
          ) : (
            <Empty description="没有匹配的 SOP 模板" className="sop-template-empty" />
          )}
        </Spin>
      </section>
    </div>
  );
}
