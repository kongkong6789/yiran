import { CloseOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Collapse, Input, Select, Space, Switch, Tag } from "antd";

import type { ActionContract, KnowledgeBaseItem, SopGraphNode } from "../api/client";

export type DataAssetOption = {
  assetKey: string;
  label: string;
  snapshotId: number;
  hint: string;
};

const FIELD_OPTIONS = [
  { value: "date_range", label: "日期范围" },
  { value: "brand", label: "品牌" },
  { value: "scope", label: "数据范围" },
  { value: "dt", label: "截止日期" },
  { value: "shop", label: "店铺" },
  { value: "snapshot_id", label: "库存快照" },
  { value: "output_type", label: "报告类型" },
];

/** Map AI/legacy technical keys → canonical option values. */
const FIELD_ALIASES: Record<string, string> = {
  date_range: "date_range",
  date: "date_range",
  dates: "date_range",
  period: "date_range",
  日期: "date_range",
  日期范围: "date_range",
  周期: "date_range",
  dt: "dt",
  deadline: "dt",
  截止日期: "dt",
  brand: "brand",
  brands: "brand",
  brand_id: "brand",
  brand_ids: "brand",
  品牌: "brand",
  scope: "scope",
  数据范围: "scope",
  范围: "scope",
  shop: "shop",
  shop_id: "shop",
  shop_ids: "shop",
  store: "shop",
  店铺: "shop",
  snapshot_id: "snapshot_id",
  inventory_snapshot: "snapshot_id",
  库存快照: "snapshot_id",
  output_type: "output_type",
  report_type: "output_type",
  报告类型: "output_type",
};

const FIELD_LABEL_BY_VALUE = Object.fromEntries(FIELD_OPTIONS.map((item) => [item.value, item.label]));

export function fieldLabel(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const canonical = FIELD_ALIASES[raw] || FIELD_ALIASES[raw.toLowerCase()] || raw;
  return FIELD_LABEL_BY_VALUE[canonical] || (/^[\u4e00-\u9fff]/.test(raw) ? raw : raw);
}

export function normalizeFieldKeys(values: string[]): string[] {
  const next: string[] = [];
  values.forEach((value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const canonical = FIELD_ALIASES[raw] || FIELD_ALIASES[raw.toLowerCase()] || raw;
    if (!next.includes(canonical)) next.push(canonical);
  });
  return next;
}

const STEP_KIND_OPTIONS = [
  { value: "collect_info", label: "收集信息", hint: "向用户确认日期、范围等" },
  { value: "data_bind", label: "使用企业数据", hint: "绑定可信业务表 / 快照" },
  { value: "knowledge_query", label: "查知识库", hint: "检索制度、话术、经验文档" },
  { value: "checkpoint", label: "人工确认", hint: "暂停等负责人点头再继续" },
  { value: "execute_action", label: "执行业务能力", hint: "生成报告、库存分析等" },
  { value: "gate", label: "安全检查", hint: "权限与风险闸机" },
  { value: "handoff", label: "转人工处理", hint: "异常时交给真人" },
  { value: "end", label: "结束", hint: "产出结果并留存" },
];

function readExpected(config: Record<string, unknown>): string[] {
  const expected = config.expected_user_info;
  if (Array.isArray(expected)) return normalizeFieldKeys(expected.map(String));
  const legacy = config.required_fields;
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

const KNOWN_ASSET_NAMES: Record<string, string> = {
  "unove.quality.anomalies": "数据质量异常",
  "unove.metric.definitions": "指标口径定义",
  "unove.metric.snapshots": "经营指标快照",
  "unove.business.events": "业务动作记录",
  "unove.dim.date": "日期维度",
  "unove.dim.products": "商品档案",
  "unove.dim.shops": "店铺档案",
  "unove.inventory.sku_mapping": "SKU 库存映射",
  "unove.sales.details": "销售业务明细",
  "unove.sales.shop_daily": "店铺日销售汇总",
  "unove.sales.sku_daily": "SKU 日销售汇总",
  "unove.ontology.objects": "本体对象镜像",
  "unove.ontology.relations": "本体关系镜像",
  "unove.sales": "UNOVE 销售数据",
  "sales.ledger": "销售台账",
  "jackyun.sales_ledger": "销售台账",
};

function assetLabel(assetKey: string, displayName?: string): string {
  const named = String(displayName || "").trim();
  if (named && named !== assetKey && !/^[a-z0-9._-]+$/i.test(named)) return named;
  if (named && named !== assetKey && /[\u4e00-\u9fff]/.test(named)) return named;
  const key = assetKey.toLowerCase().replace(/_/g, ".");
  if (KNOWN_ASSET_NAMES[key]) return KNOWN_ASSET_NAMES[key];
  for (const [knownKey, label] of Object.entries(KNOWN_ASSET_NAMES)) {
    if (key === knownKey || key.endsWith(`.${knownKey}`) || key.includes(knownKey)) return label;
  }
  if (key.includes("sales") || key.includes("销售")) return "销售数据";
  if (key.includes("inventory") || key.includes("库存")) return "库存数据";
  if (key.includes("shop") || key.includes("店铺")) return "店铺档案";
  if (key.includes("metric")) return "经营指标";
  if (key.includes("product") || key.includes("sku")) return "商品档案";
  if (key.includes("anomaly") || key.includes("quality")) return "数据质量异常";
  if (key.includes("event")) return "业务动作记录";
  if (key.includes("dim.date") || key.endsWith(".date")) return "日期维度";
  return assetKey.replace(/[._]/g, " ");
}

export function buildDataAssetOptions(rows: Array<Record<string, unknown>>): DataAssetOption[] {
  const latest = new Map<string, DataAssetOption>();
  rows.forEach((row) => {
    const scope = (row.scope || {}) as Record<string, unknown>;
    const assetKey = String(scope.asset_key || row.source_system || row.snapshot_key || "").trim();
    if (!assetKey) return;
    const id = Number(row.id);
    if (!Number.isFinite(id)) return;
    const asOf = String(row.as_of || "").slice(0, 10);
    const count = Number(row.row_count || 0);
    const displayName = String(scope.display_name || scope.name || "").trim();
    const next: DataAssetOption = {
      assetKey,
      label: assetLabel(assetKey, displayName),
      snapshotId: id,
      hint: `${asOf || "未知日期"} · ${count} 行`,
    };
    const prev = latest.get(assetKey);
    if (!prev || id > prev.snapshotId) latest.set(assetKey, next);
  });
  return Array.from(latest.values()).sort((a, b) => a.label.localeCompare(b.label, "zh"));
}

type Props = {
  node: SopGraphNode;
  disabled?: boolean;
  actions: ActionContract[];
  assets: DataAssetOption[];
  knowledgeBases: KnowledgeBaseItem[];
  onChange: (next: SopGraphNode) => void;
  onClose: () => void;
  onDelete?: () => void;
};

export default function SopBusinessNodePanel({
  node, disabled, actions, assets, knowledgeBases, onChange, onClose, onDelete,
}: Props) {
  const config = node.config || {};
  const dataBindings = (config.data_bindings || {}) as Record<string, unknown>;
  const knowledgeScope = (config.knowledge_scope || {}) as Record<string, unknown>;
  const selectedAssets = readStringList(dataBindings.asset_keys);
  const selectedSnapshots = readNumberList(dataBindings.snapshot_ids);
  // Prefer asset_keys; also reflect snapshots that match known assets.
  const selectedAssetKeys = selectedAssets.length
    ? selectedAssets
    : assets.filter((item) => selectedSnapshots.includes(item.snapshotId)).map((item) => item.assetKey);

  const patchConfig = (patch: Record<string, unknown>) => {
    const nextConfig = { ...config, ...patch };
    if (patch.instruction != null) {
      nextConfig.detail = patch.instruction;
      nextConfig.message = patch.instruction;
    }
    if (patch.expected_user_info != null) {
      nextConfig.required_fields = patch.expected_user_info;
    }
    if (typeof patch.action_name === "string" && patch.action_name) {
      const token = `call_action:${patch.action_name}`;
      const allowed = readStringList(nextConfig.allowed_actions);
      if (!allowed.includes(token)) nextConfig.allowed_actions = [...allowed, token];
    }
    onChange({ ...node, config: nextConfig });
  };

  const setAssets = (keys: string[]) => {
    const matched = assets.filter((item) => keys.includes(item.assetKey));
    patchConfig({
      data_bindings: {
        ...dataBindings,
        asset_keys: keys,
        snapshot_ids: matched.map((item) => item.snapshotId),
      },
    });
  };

  const kind = STEP_KIND_OPTIONS.find((item) => item.value === node.type);

  return (
    <aside className="sop-biz-panel">
      <header className="sop-biz-panel-head">
        <div>
          <strong>配置这一步</strong>
          <span>{kind?.hint || "告诉系统这一步要完成什么"}</span>
        </div>
        <Space size={4}>
          {onDelete && !disabled && (
            <Button type="text" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label="删除步骤">删除</Button>
          )}
          <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="关闭" />
        </Space>
      </header>

      <div className="sop-biz-panel-body">
        <label className="sop-biz-field">
          <span>步骤类型</span>
          <Select
            value={node.type}
            disabled={disabled}
            options={STEP_KIND_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value) => onChange({ ...node, type: value as SopGraphNode["type"] })}
          />
        </label>

        <label className="sop-biz-field">
          <span>步骤名称</span>
          <Input
            value={node.title}
            disabled={disabled}
            placeholder="例如：确认报告范围"
            onChange={(event) => onChange({ ...node, title: event.target.value })}
          />
        </label>

        <label className="sop-biz-field">
          <span>这一步要做什么</span>
          <Input.TextArea
            rows={3}
            value={String(config.instruction || config.detail || config.message || "")}
            disabled={disabled}
            placeholder="用人话写目标，例如：确认品牌和截止日期，不够就继续问用户"
            onChange={(event) => patchConfig({ instruction: event.target.value })}
          />
        </label>

        {(node.type === "collect_info" || node.type === "checkpoint") && (
          <label className="sop-biz-field">
            <span>需要用户补充</span>
            <Select
              mode="multiple"
              value={readExpected(config)}
              disabled={disabled}
              options={FIELD_OPTIONS}
              optionFilterProp="label"
              optionLabelProp="label"
              placeholder="选择要向用户确认的信息，例如日期范围、品牌"
              tagRender={(props) => (
                <Tag
                  className="sop-field-tag"
                  closable={props.closable}
                  onClose={props.onClose}
                  style={{ marginInlineEnd: 4 }}
                >
                  {fieldLabel(String(props.value))}
                </Tag>
              )}
              onChange={(value) => {
                const normalized = normalizeFieldKeys(value);
                patchConfig({ expected_user_info: normalized, required_fields: normalized });
              }}
            />
          </label>
        )}

        {(node.type === "data_bind" || node.type === "execute_action" || node.type === "collect_info") && (
          <label className="sop-biz-field">
            <span>使用哪些企业数据</span>
            <Select
              mode="multiple"
              value={selectedAssetKeys}
              disabled={disabled}
              optionFilterProp="label"
              placeholder={assets.length ? "选择业务表，如销售台账、库存数据" : "暂无已发布企业数据"}
              options={assets.map((item) => ({
                value: item.assetKey,
                label: `${item.label}（${item.hint}）`,
              }))}
              optionLabelProp="label"
              optionRender={(option) => (
                <div className="sop-asset-option">
                  <strong>{String(option.data.label || "").split("（")[0]}</strong>
                  <small>{assets.find((item) => item.assetKey === option.value)?.hint || option.value}</small>
                </div>
              )}
              onChange={setAssets}
            />
            {!assets.length && (
              <em className="sop-biz-hint">
                还没有可选项。请先到「知识库 → 企业数据」发布业务表，AI 才能自动帮你绑定。
              </em>
            )}
            {selectedAssetKeys.length > 0 && (
              <div className="sop-biz-tags">
                {selectedAssetKeys.map((key) => {
                  const asset = assets.find((item) => item.assetKey === key);
                  return <Tag key={key}>{asset?.label || key}</Tag>;
                })}
              </div>
            )}
          </label>
        )}

        {(node.type === "knowledge_query" || node.type === "collect_info" || node.type === "execute_action") && (
          <>
            <label className="sop-biz-field">
              <span>参考知识库</span>
              <Select
                mode="multiple"
                value={readNumberList(knowledgeScope.knowledge_base_ids)}
                disabled={disabled}
                optionFilterProp="label"
                placeholder="可选：制度、话术、经验文档"
                options={knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name }))}
                onChange={(value) => patchConfig({
                  knowledge_scope: { ...knowledgeScope, knowledge_base_ids: value },
                })}
              />
            </label>
            {node.type === "knowledge_query" && (
              <label className="sop-biz-field">
                <span>检索关注点</span>
                <Input
                  value={String(knowledgeScope.retrieval_hint || "")}
                  disabled={disabled}
                  placeholder="例如：退货政策、补货规则"
                  onChange={(event) => patchConfig({
                    knowledge_scope: { ...knowledgeScope, retrieval_hint: event.target.value },
                  })}
                />
              </label>
            )}
          </>
        )}

        {(node.type === "execute_action" || node.type === "gate") && (
          <label className="sop-biz-field">
            <span>执行什么业务能力</span>
            <Select
              value={String(config.action_name || "") || undefined}
              disabled={disabled}
              showSearch
              optionFilterProp="label"
              placeholder={actions.length ? "例如：生成经营分析报告" : "暂无可用业务能力"}
              options={actions.map((action) => ({
                value: action.name,
                label: action.title,
              }))}
              onChange={(value) => patchConfig({ action_name: value })}
            />
            <em className="sop-biz-hint">
              这里的「业务能力」就是流程可调用的系统动作（不是单独的工具市场）。Agent 侧可复用技能包，请到「技能中心」管理。
            </em>
          </label>
        )}

        {(node.type === "execute_action" || node.type === "data_bind" || node.type === "collect_info" || node.type === "checkpoint") && (
          <label className="sop-biz-field">
            <span>本步骤允许做什么</span>
            <Select
              mode="multiple"
              value={readStringList(config.allowed_actions).filter((item) => !item.startsWith("call_action:"))}
              disabled={disabled}
              optionFilterProp="label"
              placeholder="限制这一步能调用的操作"
              options={[
                { value: "ask_user", label: "询问用户" },
                { value: "continue_flow", label: "继续流转" },
                { value: "query_knowledge", label: "检索知识库" },
                { value: "confirm", label: "人工确认" },
                { value: "handoff_human", label: "转人工" },
              ]}
              onChange={(value) => {
                const actionName = String(config.action_name || "").trim();
                const next = [...value];
                if (actionName) {
                  const token = `call_action:${actionName}`;
                  if (!next.includes(token)) next.push(token);
                }
                patchConfig({ allowed_actions: next });
              }}
            />
          </label>
        )}
        <div className="sop-biz-switch">
          <div>
            <strong>需要人工确认后继续</strong>
            <span>适合高风险结果或对外发布前复核</span>
          </div>
          <Switch
            checked={node.type === "checkpoint"}
            disabled={disabled || node.type === "end"}
            onChange={(checked) => {
              if (checked) {
                onChange({
                  ...node,
                  type: "checkpoint",
                  title: node.title.includes("确认") ? node.title : `${node.title || "结果"}确认`,
                  config: {
                    ...config,
                    instruction: String(config.instruction || "请负责人确认结果后再继续"),
                    allowed_actions: ["confirm", "ask_user", "continue_flow"],
                  },
                });
              } else if (node.type === "checkpoint") {
                onChange({ ...node, type: "collect_info" });
              }
            }}
          />
        </div>

        <Collapse
          ghost
          className="sop-biz-advanced"
          items={[{
            key: "advanced",
            label: "高级选项（一般不用改）",
            children: (
              <div className="sop-biz-advanced-body">
                <label className="sop-biz-field">
                  <span>允许的系统动作（高级）</span>
                  <Select
                    mode="multiple"
                    value={readStringList(config.allowed_actions)}
                    disabled={disabled}
                    optionFilterProp="label"
                    placeholder="一般不用手改"
                    options={[
                      { value: "ask_user", label: "询问用户" },
                      { value: "continue_flow", label: "继续流转" },
                      { value: "query_knowledge", label: "检索知识库" },
                      { value: "confirm", label: "人工确认" },
                      { value: "handoff_human", label: "转人工" },
                      ...actions.map((action) => ({
                        value: `call_action:${action.name}`,
                        label: `调用：${action.title}`,
                      })),
                    ]}
                    onChange={(value) => patchConfig({ allowed_actions: value })}
                  />
                </label>
                <label className="sop-biz-field">
                  <span>数据范围</span>
                  <Input
                    value={String(dataBindings.scope || "")}
                    disabled={disabled}
                    placeholder="可选，如某品牌/渠道"
                    onChange={(event) => patchConfig({
                      data_bindings: { ...dataBindings, scope: event.target.value },
                    })}
                  />
                </label>
                <label className="sop-biz-field">
                  <span>品牌</span>
                  <Select
                    mode="tags"
                    value={readStringList(dataBindings.brand_ids)}
                    disabled={disabled}
                    onChange={(value) => patchConfig({
                      data_bindings: { ...dataBindings, brand_ids: value },
                    })}
                  />
                </label>
                <p className="sop-biz-advanced-note">节点 ID：{node.key}</p>
              </div>
            ),
          }]}
        />
      </div>
    </aside>
  );
}
