/**
 * CPD 节点数据源自动接入：本地启发式 + AI JSON 补全。
 */
import type { KnowledgeBaseItem } from "../api/client";
import {
  normalizeNodeBinding,
  type CpdDraftNode,
  type CpdNodeBinding,
  type CpdNodeConnectorKey,
} from "./cpdDraftStore";

export type MetricContractOption = {
  id: number;
  metric_id: string;
  name: string;
  unit?: string;
  version?: string;
};

export type AutoBindResult = {
  nodes: CpdDraftNode[];
  bound: number;
  skipped: number;
  source: "local" | "ai" | "mixed";
  summary: string[];
};

function findMetric(
  metrics: MetricContractOption[],
  ...patterns: RegExp[]
): MetricContractOption | undefined {
  return metrics.find((m) => {
    const hay = `${m.metric_id} ${m.name}`.toLowerCase();
    return patterns.some((p) => p.test(hay));
  });
}

function pickKb(kbs: KnowledgeBaseItem[], hint?: string): KnowledgeBaseItem | undefined {
  if (!kbs.length) return undefined;
  if (!hint) return kbs[0];
  const h = hint.toLowerCase();
  return kbs.find((kb) => `${kb.name} ${kb.category} ${(kb.tags || []).join(" ")}`.toLowerCase().includes(h))
    || kbs[0];
}

/** 按节点名称/编码启发式推荐绑定 */
export function suggestBindingForNode(
  node: CpdDraftNode,
  metrics: MetricContractOption[],
  knowledgeBases: KnowledgeBaseItem[],
): CpdNodeBinding {
  const text = `${node.code} ${node.name}`;

  if (/库存|备货|可售|周转|缺货/.test(text)) {
    const m = findMetric(metrics, /stock|inventory|cover|库存/);
    if (m) {
      return {
        bind_type: "metric",
        role: "observe",
        metric_id: m.metric_id,
        metric_name: m.name,
        note: "AI 自动匹配库存类指标",
      };
    }
    return {
      bind_type: "connector",
      role: "observe",
      connector: "jackyun",
      connector_action: "jackyun.inventory",
      note: "AI 自动接入吉客云库存",
    };
  }

  if (/销量|销售量|件数|单量/.test(text)) {
    const m = findMetric(metrics, /sales_qty|avg_daily|销量/);
    if (m) {
      return {
        bind_type: "metric",
        role: "observe",
        metric_id: m.metric_id,
        metric_name: m.name,
        note: "AI 自动匹配销量指标",
      };
    }
    return {
      bind_type: "connector",
      role: "observe",
      connector: "jackyun",
      connector_action: "jackyun.sync",
      note: "AI 自动接入吉客云同步（销量）",
    };
  }

  if (/销售额|GMV|营收|成交额/.test(text)) {
    const m = findMetric(metrics, /sales|gmv|金额|销售额/);
    if (m) {
      return {
        bind_type: "metric",
        role: "observe",
        metric_id: m.metric_id,
        metric_name: m.name,
        note: "AI 自动匹配销售金额指标",
      };
    }
    return {
      bind_type: "connector",
      role: "observe",
      connector: "jackyun",
      connector_action: "jackyun.sync",
      note: "AI 自动接入吉客云同步（销售）",
    };
  }

  if (/推广|广告|投放|ROI|费比/.test(text)) {
    return {
      bind_type: "connector",
      role: "observe",
      connector: "jackyun",
      connector_action: "jackyun.query",
      note: "AI 自动接入吉客云查询（推广）",
    };
  }

  if (/利润|毛利|贡献|净利/.test(text)) {
    const m = findMetric(metrics, /profit|margin|利润|贡献/);
    if (m) {
      return {
        bind_type: "metric",
        role: "observe",
        metric_id: m.metric_id,
        metric_name: m.name,
        note: "AI 自动匹配利润指标",
      };
    }
    return {
      bind_type: "connector",
      role: "observe",
      connector: "kingdee",
      connector_action: "kingdee.bill_query",
      note: "AI 自动接入金蝶单据（利润相关）",
    };
  }

  if (/成本|费用|采购|货款|扣点|佣金/.test(text)) {
    return {
      bind_type: "connector",
      role: /采购|下单/.test(text) ? "act" : "observe",
      connector: "kingdee",
      connector_action: /采购|下单/.test(text) ? "purchase.create" : "kingdee.bill_query",
      note: "AI 自动接入金蝶（成本/费用）",
    };
  }

  if (/价盘|定价|客单|单价/.test(text)) {
    return {
      bind_type: "connector",
      role: "observe",
      connector: "jackyun",
      connector_action: "jackyun.sync",
      note: "AI 自动接入吉客云商品价盘",
    };
  }

  const kb = pickKb(knowledgeBases, node.name);
  if (kb) {
    return {
      bind_type: "knowledge",
      role: "orient",
      knowledge_base_id: kb.id,
      knowledge_base_name: kb.name,
      knowledge_query: `${node.name} 经营机理 干预口径`,
      note: "AI 自动挂知识库（解释向）",
    };
  }

  return {
    bind_type: "connector",
    role: "observe",
    connector: "jackyun",
    connector_action: "jackyun.sync",
    note: "AI 兜底：吉客云同步",
  };
}

export function autoBindNodesLocal(
  nodes: CpdDraftNode[],
  metrics: MetricContractOption[],
  knowledgeBases: KnowledgeBaseItem[],
  opts?: { overwrite?: boolean },
): AutoBindResult {
  const overwrite = Boolean(opts?.overwrite);
  let bound = 0;
  let skipped = 0;
  const summary: string[] = [];
  const next = nodes.map((node) => {
    const has = node.binding && node.binding.bind_type !== "none";
    if (has && !overwrite) {
      skipped += 1;
      return node;
    }
    const binding = suggestBindingForNode(node, metrics, knowledgeBases);
    bound += 1;
    summary.push(`${node.code} → ${binding.bind_type}${binding.metric_id ? `:${binding.metric_id}` : ""}${binding.connector ? `:${binding.connector}` : ""}${binding.knowledge_base_id ? `:kb${binding.knowledge_base_id}` : ""}`);
    return { ...node, binding };
  });
  return { nodes: next, bound, skipped, source: "local", summary };
}

export function buildAutoBindPrompt(
  nodes: CpdDraftNode[],
  metrics: MetricContractOption[],
  knowledgeBases: KnowledgeBaseItem[],
): string {
  return [
    "你是电商经营回路数据接入助手。请为每个节点推荐数据源绑定。",
    "规则：",
    "1) 可量化节点优先 bind_type=metric，metric_id 必须来自候选指标列表；",
    "2) 没有合适指标时用 connector=jackyun|kingdee，并给出 connector_action；",
    "3) 解释/规范类用 knowledge，knowledge_base_id 必须来自候选知识库；",
    "4) role 只能是 observe|orient|act；",
    "5) 只输出 JSON，不要其它文字。",
    "",
    "候选指标：",
    JSON.stringify(metrics.map((m) => ({ metric_id: m.metric_id, name: m.name, unit: m.unit }))),
    "",
    "候选知识库：",
    JSON.stringify(knowledgeBases.map((k) => ({ id: k.id, name: k.name, category: k.category }))),
    "",
    "可用连接器动作：",
    JSON.stringify({
      jackyun: ["jackyun.sync", "jackyun.inventory", "jackyun.query"],
      kingdee: ["kingdee.status", "kingdee.bill_query", "purchase.create"],
    }),
    "",
    "节点：",
    JSON.stringify(nodes.map((n) => ({ id: n.id, code: n.code, name: n.name }))),
    "",
    "输出格式：",
    '{"bindings":[{"code":"K11","bind_type":"metric","role":"observe","metric_id":"available_stock_qty","note":"..."}]}',
  ].join("\n");
}

export function extractBindingsFromAi(text: string): Array<{
  code?: string;
  id?: string;
  bind_type?: string;
  role?: string;
  metric_id?: string;
  connector?: string;
  connector_action?: string;
  knowledge_base_id?: number;
  knowledge_query?: string;
  note?: string;
}> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fence?.[1] || text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { bindings?: unknown };
    if (!Array.isArray(parsed.bindings)) return null;
    return parsed.bindings as Array<{
      code?: string;
      id?: string;
      bind_type?: string;
      role?: string;
      metric_id?: string;
      connector?: string;
      connector_action?: string;
      knowledge_base_id?: number;
      knowledge_query?: string;
      note?: string;
    }>;
  } catch {
    return null;
  }
}

export function applyAiBindings(
  nodes: CpdDraftNode[],
  aiRows: NonNullable<ReturnType<typeof extractBindingsFromAi>>,
  metrics: MetricContractOption[],
  knowledgeBases: KnowledgeBaseItem[],
  opts?: { overwrite?: boolean },
): AutoBindResult {
  const overwrite = Boolean(opts?.overwrite);
  const byCode = new Map(aiRows.map((r) => [(r.code || "").toUpperCase(), r]));
  const byId = new Map(aiRows.map((r) => [r.id || "", r]));
  let bound = 0;
  let skipped = 0;
  const summary: string[] = [];

  const next = nodes.map((node) => {
    const has = node.binding && node.binding.bind_type !== "none";
    if (has && !overwrite) {
      skipped += 1;
      return node;
    }
    const row = byId.get(node.id) || byCode.get(node.code.toUpperCase());
    if (!row) {
      const local = suggestBindingForNode(node, metrics, knowledgeBases);
      bound += 1;
      summary.push(`${node.code} → local:${local.bind_type}`);
      return { ...node, binding: local };
    }
    const metric = metrics.find((m) => m.metric_id === row.metric_id);
    const kbId = Number(row.knowledge_base_id);
    const kb = knowledgeBases.find((k) => k.id === kbId);
    const connector = (row.connector === "kingdee" || row.connector === "jackyun")
      ? (row.connector as CpdNodeConnectorKey)
      : undefined;
    const binding = normalizeNodeBinding({
      bind_type: row.bind_type,
      role: row.role,
      metric_id: metric?.metric_id || row.metric_id,
      metric_name: metric?.name,
      connector,
      connector_action: row.connector_action,
      knowledge_base_id: kb?.id ?? (Number.isFinite(kbId) ? kbId : undefined),
      knowledge_base_name: kb?.name,
      knowledge_query: row.knowledge_query,
      note: row.note || "AI 推荐绑定",
    }) || suggestBindingForNode(node, metrics, knowledgeBases);

    // 校验：metric/knowledge 引用非法时回退本地建议
    if (binding.bind_type === "metric" && binding.metric_id && !metrics.some((m) => m.metric_id === binding.metric_id)) {
      const fallback = suggestBindingForNode(node, metrics, knowledgeBases);
      bound += 1;
      summary.push(`${node.code} → fallback:${fallback.bind_type}`);
      return { ...node, binding: fallback };
    }
    if (binding.bind_type === "knowledge" && binding.knowledge_base_id && !knowledgeBases.some((k) => k.id === binding.knowledge_base_id)) {
      const fallback = suggestBindingForNode(node, metrics, knowledgeBases);
      bound += 1;
      summary.push(`${node.code} → fallback:${fallback.bind_type}`);
      return { ...node, binding: fallback };
    }

    bound += 1;
    summary.push(`${node.code} → ai:${binding.bind_type}`);
    return { ...node, binding };
  });

  return { nodes: next, bound, skipped, source: "ai", summary };
}
