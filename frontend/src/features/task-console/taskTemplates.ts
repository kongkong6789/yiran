export type TaskTemplateCategory = "report" | "operation" | "analysis" | "collab";

export type TaskTemplate = {
  key: string;
  name: string;
  description: string;
  category: TaskTemplateCategory;
  prompt: string;
  tags: string[];
  color: string;
  soft: string;
  estimatedMinutes: number;
};

export const TASK_TEMPLATE_CATEGORIES: Record<TaskTemplateCategory, string> = {
  report: "经营报告",
  operation: "日常运营",
  analysis: "数据分析",
  collab: "协作跟进",
};

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    key: "daily-ops-report",
    name: "每日运营日报",
    description: "汇总昨日核心经营指标、异常波动与待跟进事项，生成可发送摘要。",
    category: "report",
    prompt: "帮我生成昨天的运营日报，包含销售额、访客、转化、退款和库存异常，并给出需要跟进的 3 条建议。",
    tags: ["日报", "经营概览"],
    color: "#6d4ed7",
    soft: "#f0ebff",
    estimatedMinutes: 8,
  },
  {
    key: "weekly-sales-review",
    name: "销售周报",
    description: "按渠道与品类拆解本周销售表现，对比上周并标注增长机会。",
    category: "report",
    prompt: "帮我生成本周销售周报，按渠道和品类拆解销售额、订单量和退款率，并对比上周变化。",
    tags: ["周报", "销售"],
    color: "#2563eb",
    soft: "#eff6ff",
    estimatedMinutes: 12,
  },
  {
    key: "inventory-risk-scan",
    name: "库存风险巡检",
    description: "识别低库存、滞销和高周转异常 SKU，输出补货与清仓建议。",
    category: "analysis",
    prompt: "帮我扫描当前库存风险，找出低库存、滞销和高周转异常 SKU，并给出补货与清仓建议。",
    tags: ["库存", "风险"],
    color: "#16806f",
    soft: "#e5f6f2",
    estimatedMinutes: 10,
  },
  {
    key: "competitor-monitor",
    name: "竞品动态监控",
    description: "整理竞品价格、活动与卖点变化，形成简要竞争情报。",
    category: "analysis",
    prompt: "帮我整理最近 7 天竞品价格、活动和卖点变化，输出竞争情报摘要和应对建议。",
    tags: ["竞品", "监控"],
    color: "#b76b12",
    soft: "#fff3e2",
    estimatedMinutes: 15,
  },
  {
    key: "campaign-review",
    name: "活动复盘",
    description: "复盘最近一次营销活动投放、转化与 ROI，提炼可复用经验。",
    category: "operation",
    prompt: "帮我复盘最近一次营销活动，总结投放、转化、ROI 和主要问题，并给出下次优化建议。",
    tags: ["活动", "复盘"],
    color: "#db2777",
    soft: "#fdf2f8",
    estimatedMinutes: 14,
  },
  {
    key: "customer-followup",
    name: "客户跟进清单",
    description: "根据待跟进客户与工单状态，整理今日优先联系名单。",
    category: "collab",
    prompt: "帮我整理今天需要优先跟进的客户清单，按紧急程度和预计成交金额排序，并生成联系要点。",
    tags: ["客户", "跟进"],
    color: "#0f766e",
    soft: "#e6f7f4",
    estimatedMinutes: 6,
  },
  {
    key: "meeting-brief",
    name: "会议准备简报",
    description: "为即将召开的例会准备数据摘要、议题与决策建议。",
    category: "collab",
    prompt: "帮我准备今天业务例会的简报，包含核心指标、异常事项、需决策问题和建议讨论顺序。",
    tags: ["会议", "简报"],
    color: "#7c3aed",
    soft: "#f3efff",
    estimatedMinutes: 9,
  },
  {
    key: "refund-anomaly",
    name: "退款异常分析",
    description: "分析近期退款率上升原因，定位高风险商品与售后问题。",
    category: "analysis",
    prompt: "帮我分析最近退款率上升的原因，按商品、渠道和售后原因拆解，并给出改进措施。",
    tags: ["退款", "售后"],
    color: "#dc2626",
    soft: "#fef2f2",
    estimatedMinutes: 11,
  },
];

export function getTaskTemplate(key: string | null | undefined) {
  if (!key) return undefined;
  return TASK_TEMPLATES.find((item) => item.key === key);
}
