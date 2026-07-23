import { Button, Checkbox, Input, Select, Space, Spin, Switch, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getOpsLoop,
  publishOpsLoop,
  startOpsLoopRun,
  updateOpsLoop,
  type OpsLoopDefinition,
  type OpsLoopItem,
} from "../../api/opsLoops";
import { PHASE_META, STATUS_LABEL, statusClass } from "./shared";
import OpsLoopDesignCanvas, { type OpsCanvasPhaseCard, type OpsPhaseKey } from "./OpsLoopDesignCanvas";
import "./loopsOps.css";

const PHASES = ["observe", "orient", "decide", "act", "learn"] as const;
type PhaseKey = OpsPhaseKey;

const PHASE_BLURB: Record<PhaseKey, { subtitle: string; bullets: (cfg: Record<string, unknown>) => string[] }> = {
  observe: {
    subtitle: "连接库存/订单/销量预测 · 发现缺货与滞销",
    bullets: (cfg) => [
      `数据源：${asList(cfg.data_sources).join("、") || "库存、订单、销量预测"}`,
      `触发：${String(cfg.trigger || (cfg.anomaly as { condition?: string } | undefined)?.condition || "可售天数 < 安全库存 或 滞销 > 90 天")}`,
      `频率：${String((cfg.schedule as { label?: string } | undefined)?.label || "每天 09:00")}`,
    ],
  },
  orient: {
    subtitle: "关联分析 · 计算安全库存与风险",
    bullets: (cfg) => [
      `关联分析：${asList(cfg.relations).join(" → ") || "店铺 → 平台 → SKU"}`,
      `使用知识：${asList(cfg.knowledge_hints).join("、") || "安全库存规则、滞销判定"}`,
    ],
  },
  decide: {
    subtitle: "生成补货 / 清仓 / 暂停采购策略",
    bullets: (cfg) => [
      `分析任务：${asList(cfg.tasks).join("、") || "缺货归因、滞销评估、策略生成"}`,
      `决策输出：${asList(cfg.outputs).join("、") || "补货 SKU/数量、清仓清单"}`,
    ],
  },
  act: {
    subtitle: "采购申请 · 仓间调拨 · 调价/投放优先级",
    bullets: (cfg) => [
      `执行动作：${asList(cfg.actions).join("、") || "创建采购申请、仓间调拨、调整投放"}`,
      `审批：${cfg.require_confirm === false ? "自动执行" : "策略审批 / 执行确认"}`,
    ],
  },
  learn: {
    subtitle: "对比预测与实际 · 迭代安全库存与阈值",
    bullets: (cfg) => [
      `评估指标：${asList(cfg.eval_metrics).join("、") || "缺货率、周转天数、滞销金额"}`,
      "学习内容：安全库存、补货周期、滞销阈值",
    ],
  },
};

const DATA_SOURCE_OPTIONS = [
  { key: "库存", detail: "库存快照、在途、可售天数" },
  { key: "订单", detail: "销售订单、出库单" },
  { key: "销量预测", detail: "预测模型、安全库存" },
  { key: "采购/仓配", detail: "采购单、调拨单" },
];

const ADD_NODE_ITEMS: { key: string; label: string }[] = [
  { key: "observe", label: "观察" },
  { key: "orient", label: "理解" },
  { key: "decide", label: "决策" },
  { key: "act", label: "执行" },
  { key: "learn", label: "学习" },
  { key: "condition", label: "条件判断" },
  { key: "parallel", label: "并行分支" },
  { key: "wait", label: "延时等待" },
  { key: "notify", label: "通知节点" },
  { key: "end", label: "结束节点" },
];

const NODE_TEMPLATES = ["异常监控", "营销优化", "库存优化", "客户流失预警", "价格优化", "从空白添加"];

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function phaseCfg(definition: OpsLoopDefinition, phase: string): Record<string, unknown> {
  return (definition.phases?.[phase] || {}) as Record<string, unknown>;
}

function scheduleLabel(frequency: string, time: string) {
  const freqText = frequency === "hourly" ? "每小时" : frequency === "weekly" ? "每周" : "每天";
  return `${freqText} ${time}`;
}

export default function LoopDesignWorkspace() {
  const { id } = useParams();
  const loopId = Number(id);
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loop, setLoop] = useState<OpsLoopItem | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState<OpsLoopDefinition>({});
  const [selectedPhase, setSelectedPhase] = useState<PhaseKey>("observe");
  const [topTab, setTopTab] = useState<"design" | "global" | "permission" | "version" | "logs">("design");
  const [inspectorTab, setInspectorTab] = useState<"basic" | "data" | "trigger" | "other">("basic");
  const [savedAt, setSavedAt] = useState<string>("");

  useEffect(() => {
    if (!Number.isFinite(loopId)) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getOpsLoop(loopId);
        if (cancelled) return;
        setLoop(data);
        setName(data.name);
        setDescription(data.description || "");
        setDefinition(enrichDefinition(data.definition || {}));
        setSavedAt(data.updated_at);
      } catch (error) {
        console.error(error);
        message.error("加载设计失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loopId]);

  const selectedCfg = useMemo(() => phaseCfg(definition, selectedPhase), [definition, selectedPhase]);

  function selectPhase(phase: PhaseKey) {
    setSelectedPhase(phase);
    setInspectorTab("basic");
  }

  function selectCanvasNode(id: string) {
    if ((PHASES as readonly string[]).includes(id)) {
      selectPhase(id as PhaseKey);
      return;
    }
    if (id === "goal" || id === "monitor") {
      setSelectedPhase("learn");
      setInspectorTab("other");
    }
  }

  function patchLayout(layout: Record<string, { x: number; y: number }>) {
    setDefinition((prev) => ({ ...prev, layout }));
  }

  function patchPhase(phase: string, key: string, value: unknown) {
    setDefinition((prev) => {
      const phases = { ...(prev.phases || {}) };
      const current = { ...(phases[phase] || {}) };
      current[key] = value;
      phases[phase] = current;
      return { ...prev, phases };
    });
  }

  function patchNested(phase: string, nestKey: string, key: string, value: unknown) {
    setDefinition((prev) => {
      const phases = { ...(prev.phases || {}) };
      const current = { ...(phases[phase] || {}) };
      const nested = { ...((current[nestKey] as Record<string, unknown>) || {}) };
      nested[key] = value;
      current[nestKey] = nested;
      phases[phase] = current;
      return { ...prev, phases };
    });
  }

  function applyTemplate(tpl: string) {
    if (tpl === "从空白添加") {
      message.info("可从空白继续编辑当前草案");
      return;
    }
    if (tpl === "库存优化") {
      setDefinition(enrichDefinition({
        loop_condition: "安全库存达标，响应时效 < 24h，缺货率 < 5%",
        phases: {
          observe: {
            title: "观察",
            description: "连接库存、订单与销量预测，发现缺货与滞销信号",
            data_sources: ["库存", "订单", "销量预测"],
            trigger: "可售天数 < 安全库存 或 滞销 > 90 天",
            schedule: { frequency: "daily", time: "09:00", label: "每天 09:00" },
            metrics: ["可售天数", "滞销天数", "缺货 SKU 数"],
            anomaly: { condition: "可售天数 < 安全库存 或 滞销 > 90 天", duration: "连续 1 天", baseline: "安全库存与 90 天滞销阈值" },
          },
          orient: {
            title: "理解",
            description: "按店铺→平台→SKU 关联分析，计算安全库存与未来销售风险",
            relations: ["店铺", "平台", "SKU"],
            knowledge_hints: ["安全库存规则", "滞销判定", "补货提前期"],
          },
          decide: {
            title: "决策",
            description: "在补货、清仓与暂停采购之间择优，并评估风险",
            tasks: ["缺货归因", "滞销评估", "策略生成"],
            outputs: ["补货 SKU/数量", "清仓清单", "暂停采购建议"],
          },
          act: {
            title: "执行",
            description: "创建采购申请、仓间调拨，并调整 SKU 投放优先级",
            actions: ["创建采购申请", "仓间调拨", "调整投放优先级"],
            require_confirm: true,
          },
          learn: {
            title: "学习",
            description: "对比预测与实际销量，优化安全库存、补货周期与滞销阈值",
            eval_metrics: ["缺货率", "库存周转天数", "滞销库存金额", "补货响应时效"],
          },
        },
      }));
      setName((prev) => (prev.includes("库存") ? prev : "库存缺货与滞销自动补货/清仓闭环"));
      selectPhase("learn");
      message.success("已套用「库存优化」模板");
      return;
    }
    message.info(`模板「${tpl}」将在后续版本接入，可先手动配置五段`);
  }

  async function save() {
    if (!loop) return;
    setSaving(true);
    try {
      const updated = await updateOpsLoop(loop.id, { name, description, definition });
      setLoop(updated);
      setSavedAt(updated.updated_at);
      message.success("已保存");
    } catch (error) {
      console.error(error);
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!loop) return;
    setSaving(true);
    try {
      await updateOpsLoop(loop.id, { name, description, definition });
      const updated = await publishOpsLoop(loop.id);
      setLoop(updated);
      setSavedAt(updated.updated_at);
      message.success("已发布");
    } catch (error) {
      console.error(error);
      message.error("发布失败");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!loop) return;
    try {
      await updateOpsLoop(loop.id, { name, description, definition });
      if (loop.status === "draft" || loop.status === "candidate") {
        await publishOpsLoop(loop.id);
      }
      const run = await startOpsLoopRun(loop.id);
      message.success("已启动测试运行");
      nav(`/loops/${loop.id}/run?runId=${run.id}`);
    } catch (error) {
      console.error(error);
      message.error("运行测试失败");
    }
  }

  if (loading) {
    return (
      <div className="loops-ops-page">
        <div className="ops-main"><Spin /></div>
      </div>
    );
  }

  if (!loop) {
    return (
      <div className="loops-ops-page">
        <div className="ops-main">Loop 不存在</div>
      </div>
    );
  }

  const observeCfg = phaseCfg(definition, "observe");
  const schedule = ((selectedPhase === "observe" ? selectedCfg.schedule : observeCfg.schedule) as {
    frequency?: string;
    time?: string;
    label?: string;
  } | undefined) || {};
  const anomaly = ((selectedPhase === "observe" ? selectedCfg.anomaly : observeCfg.anomaly) as Record<string, unknown> | undefined) || {};
  const dataSources = asList(observeCfg.data_sources || selectedCfg.data_sources);

  const canvasPhases = useMemo<OpsCanvasPhaseCard[]>(
    () => PHASES.map((phase) => {
      const cfg = phaseCfg(definition, phase);
      const meta = PHASE_META[phase];
      const blurb = PHASE_BLURB[phase];
      return {
        id: phase,
        label: meta.label,
        tone: meta.tone,
        subtitle: String(cfg.description || blurb.subtitle),
        bullets: blurb.bullets(cfg),
        selected: selectedPhase === phase,
      };
    }),
    [definition, selectedPhase],
  );

  return (
    <div className="loops-ops-page design-page">
      <div className="ops-topbar design-topbar">
        <div className="design-top-left">
          <button type="button" className="design-back" onClick={() => nav("/loops")}>Loops 列表</button>
          <span className="design-crumb">/</span>
          <Input
            className="design-title-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            variant="borderless"
          />
          <span className={`ops-pill ${statusClass(loop.status)}`}>{STATUS_LABEL[loop.status]}</span>
          <span className="design-saved">
            已保存{savedAt ? ` · ${new Date(savedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
          </span>
        </div>
        <Space wrap>
          <Button onClick={() => void runTest()}>运行测试</Button>
          <Button loading={saving} onClick={() => void save()}>保存</Button>
          <Button type="primary" loading={saving} onClick={() => void publish()}>发布 Loop</Button>
        </Space>
      </div>

      <div className="design-tabs">
        {[
          ["design", "设计流程"],
          ["global", "全局配置"],
          ["permission", "权限设置"],
          ["version", "版本管理"],
          ["logs", "运行日志"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={topTab === key ? "active" : ""}
            onClick={() => {
              if (key === "logs") {
                nav(`/loops/${loop.id}/run`);
                return;
              }
              setTopTab(key as typeof topTab);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {topTab !== "design" ? (
        <div className="ops-main">
          <div className="ops-card">
            <h3>{topTab === "global" ? "全局配置" : topTab === "permission" ? "权限设置" : "版本管理"}</h3>
            <p style={{ color: "var(--ops-muted)" }}>第一期先聚焦设计流程；该页签稍后接入。</p>
            {topTab === "global" ? (
              <>
                <label className="design-label">Loop 描述</label>
                <Input.TextArea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
                <label className="design-label">目标达成评判标准</label>
                <Input.TextArea
                  rows={3}
                  value={definition.loop_condition || ""}
                  onChange={(e) => setDefinition((prev) => ({ ...prev, loop_condition: e.target.value }))}
                  placeholder="安全库存达标，响应时效 < 24h，缺货率 < 5%"
                />
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="design-body">
          <main className="design-canvas">
            <OpsLoopDesignCanvas
              phases={canvasPhases}
              loopCondition={definition.loop_condition || ""}
              layout={definition.layout}
              selectedId={inspectorTab === "other" && selectedPhase === "learn" ? "goal" : selectedPhase}
              onSelect={selectCanvasNode}
              onLayoutChange={patchLayout}
            />

            <div className="design-palette">
              <div className="palette-card">
                <div className="ops-side-title">添加节点</div>
                <div className="palette-row">
                  {ADD_NODE_ITEMS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`palette-chip ${(PHASES as readonly string[]).includes(item.key) && selectedPhase === item.key ? "on" : ""}`}
                      onClick={() => {
                        if ((PHASES as readonly string[]).includes(item.key)) {
                          selectPhase(item.key as PhaseKey);
                        } else {
                          message.info("第一期固定 OODA 五段，扩展节点后续开放");
                        }
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="palette-card">
                <div className="ops-side-title">节点模板</div>
                <div className="palette-row">
                  {NODE_TEMPLATES.map((tpl) => (
                    <button key={tpl} type="button" className="palette-chip" onClick={() => applyTemplate(tpl)}>
                      {tpl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </main>

          <aside className="design-inspector">
            <div className="inspector-head">
              <div>
                <div className="inspector-kicker">节点配置</div>
                <strong>{PHASE_META[selectedPhase].label}</strong>
              </div>
              <span className={`ops-pill ${PHASE_META[selectedPhase].tone}`}>已选中</span>
            </div>
            <div className="inspector-tabs">
              {[
                ["basic", "基础配置"],
                ["data", "数据配置"],
                ["trigger", "触发配置"],
                ["other", "其他设置"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={inspectorTab === key ? "active" : ""}
                  onClick={() => setInspectorTab(key as typeof inspectorTab)}
                >
                  {label}
                </button>
              ))}
            </div>

            {inspectorTab === "basic" ? (
              <>
                <label className="design-label">节点名称</label>
                <Input
                  value={String(selectedCfg.title || "")}
                  onChange={(e) => patchPhase(selectedPhase, "title", e.target.value)}
                  placeholder={`${PHASE_META[selectedPhase].label}节点`}
                />

                <label className="design-label">节点描述</label>
                <Input.TextArea
                  rows={4}
                  value={String(selectedCfg.description || "")}
                  onChange={(e) => patchPhase(selectedPhase, "description", e.target.value)}
                />

                {selectedPhase === "learn" ? (
                  <>
                    <label className="design-label">评估指标</label>
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={asList(selectedCfg.eval_metrics)}
                      onChange={(values) => patchPhase("learn", "eval_metrics", values)}
                      placeholder="缺货率、周转天数…"
                    />
                    <label className="design-label">目标达成评判标准</label>
                    <Input.TextArea
                      rows={3}
                      value={definition.loop_condition || ""}
                      onChange={(e) => setDefinition((prev) => ({ ...prev, loop_condition: e.target.value }))}
                      placeholder="安全库存达标，响应时效 < 24h，缺货率 < 5%"
                    />
                  </>
                ) : null}

                {selectedPhase === "orient" ? (
                  <>
                    <label className="design-label">关联分析路径</label>
                    <Input
                      value={asList(selectedCfg.relations).join(" → ") || "店铺 → 平台 → SKU"}
                      onChange={(e) => patchPhase("orient", "relations", e.target.value.split(/→|->|,/).map((x) => x.trim()).filter(Boolean))}
                    />
                    <label className="design-label">使用知识</label>
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={asList(selectedCfg.knowledge_hints)}
                      onChange={(values) => patchPhase("orient", "knowledge_hints", values)}
                    />
                  </>
                ) : null}

                {selectedPhase === "decide" ? (
                  <>
                    <label className="design-label">分析任务</label>
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={asList(selectedCfg.tasks)}
                      onChange={(values) => patchPhase("decide", "tasks", values)}
                    />
                    <label className="design-label">决策输出</label>
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={asList(selectedCfg.outputs)}
                      onChange={(values) => patchPhase("decide", "outputs", values)}
                    />
                  </>
                ) : null}

                {selectedPhase === "act" ? (
                  <>
                    <label className="design-label">执行动作</label>
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={asList(selectedCfg.actions)}
                      onChange={(values) => patchPhase("act", "actions", values)}
                    />
                    <div className="inspector-row">
                      <Switch
                        checked={Boolean(selectedCfg.require_confirm ?? true)}
                        onChange={(checked) => patchPhase("act", "require_confirm", checked)}
                      />
                      <span>外部写操作需人工确认</span>
                    </div>
                  </>
                ) : null}

                {selectedPhase === "observe" ? (
                  <>
                    <label className="design-label">检测指标</label>
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={asList(selectedCfg.metrics)}
                      onChange={(values) => patchPhase("observe", "metrics", values)}
                    />
                    <label className="design-label">异常条件</label>
                    <Input
                      value={String(anomaly.condition || selectedCfg.trigger || "")}
                      onChange={(e) => {
                        patchNested("observe", "anomaly", "condition", e.target.value);
                        patchPhase("observe", "trigger", e.target.value);
                      }}
                      placeholder="可售天数 < 安全库存 或 滞销 > 90 天"
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {inspectorTab === "data" ? (
              <>
                <div className="inspector-section">数据源配置</div>
                <div className="datasource-list">
                  {DATA_SOURCE_OPTIONS.map((item) => {
                    const checked = dataSources.includes(item.key);
                    return (
                      <label key={item.key} className={`datasource-item ${checked ? "on" : ""}`}>
                        <Checkbox
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...dataSources, item.key]
                              : dataSources.filter((x) => x !== item.key);
                            patchPhase("observe", "data_sources", next);
                          }}
                        />
                        <span>
                          <strong>{item.key}数据</strong>
                          <small>{item.detail}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {selectedPhase === "orient" ? (
                  <>
                    <label className="design-label">知识引用</label>
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      value={asList(selectedCfg.knowledge_hints)}
                      onChange={(values) => patchPhase("orient", "knowledge_hints", values)}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {inspectorTab === "trigger" ? (
              <>
                <label className="design-label">执行频率</label>
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    style={{ width: "45%" }}
                    value={schedule.frequency || "daily"}
                    options={[
                      { value: "daily", label: "每天" },
                      { value: "hourly", label: "每小时" },
                      { value: "weekly", label: "每周" },
                    ]}
                    onChange={(value) => {
                      const time = schedule.time || "09:00";
                      patchPhase("observe", "schedule", {
                        frequency: value,
                        time,
                        label: scheduleLabel(value, time),
                      });
                    }}
                  />
                  <Input
                    style={{ width: "55%" }}
                    type="time"
                    value={schedule.time || "09:00"}
                    onChange={(e) => {
                      const time = e.target.value || "09:00";
                      const frequency = schedule.frequency || "daily";
                      patchPhase("observe", "schedule", {
                        frequency,
                        time,
                        label: scheduleLabel(frequency, time),
                      });
                    }}
                  />
                </Space.Compact>
                <label className="design-label">触发条件</label>
                <Input.TextArea
                  rows={3}
                  value={String(anomaly.condition || observeCfg.trigger || definition.loop_condition || "")}
                  onChange={(e) => {
                    patchNested("observe", "anomaly", "condition", e.target.value);
                    patchPhase("observe", "trigger", e.target.value);
                  }}
                />
                <label className="design-label">持续时长</label>
                <Input
                  value={String(anomaly.duration || "连续 1 天")}
                  onChange={(e) => patchNested("observe", "anomaly", "duration", e.target.value)}
                />
                <label className="design-label">对比基线</label>
                <Input
                  value={String(anomaly.baseline || "安全库存与滞销阈值")}
                  onChange={(e) => patchNested("observe", "anomaly", "baseline", e.target.value)}
                />
              </>
            ) : null}

            {inspectorTab === "other" ? (
              <>
                <label className="design-label">目标达成评判标准</label>
                <Input.TextArea
                  rows={4}
                  value={definition.loop_condition || ""}
                  onChange={(e) => setDefinition((prev) => ({ ...prev, loop_condition: e.target.value }))}
                />
                {selectedPhase === "act" ? (
                  <div className="inspector-row">
                    <Switch
                      checked={Boolean(selectedCfg.require_confirm ?? true)}
                      onChange={(checked) => patchPhase("act", "require_confirm", checked)}
                    />
                    <span>外部写操作需人工确认</span>
                  </div>
                ) : null}
                <p className="inspector-hint">版本、权限与高级编排将在后续版本接入。</p>
              </>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

function enrichDefinition(raw: OpsLoopDefinition): OpsLoopDefinition {
  const phases = { ...(raw.phases || {}) };
  const observe = { ...(phases.observe || {}) } as Record<string, unknown>;
  if (!observe.schedule) {
    observe.schedule = { frequency: "daily", time: "09:00", label: "每天 09:00" };
  }
  if (!observe.anomaly) {
    observe.anomaly = {
      condition: String(observe.trigger || "可售天数 < 安全库存 或 滞销 > 90 天"),
      duration: "连续 1 天",
      baseline: "安全库存与滞销阈值",
    };
  }
  if (!observe.title) observe.title = "观察";
  if (!observe.description) observe.description = PHASE_BLURB.observe.subtitle;
  if (!observe.data_sources) observe.data_sources = ["库存", "订单", "销量预测"];
  if (!observe.metrics) observe.metrics = ["可售天数", "滞销天数", "缺货 SKU 数"];
  if (!observe.trigger) observe.trigger = String((observe.anomaly as { condition?: string }).condition || "");
  phases.observe = observe;

  const orient = { ...(phases.orient || {}) } as Record<string, unknown>;
  if (!orient.title) orient.title = "理解";
  if (!orient.description) orient.description = PHASE_BLURB.orient.subtitle;
  if (!orient.relations) orient.relations = ["店铺", "平台", "SKU"];
  if (!orient.knowledge_hints) orient.knowledge_hints = ["安全库存规则", "滞销判定"];
  phases.orient = orient;

  const decide = { ...(phases.decide || {}) } as Record<string, unknown>;
  if (!decide.title) decide.title = "决策";
  if (!decide.description) decide.description = PHASE_BLURB.decide.subtitle;
  if (!decide.tasks) decide.tasks = ["缺货归因", "滞销评估", "策略生成"];
  if (!decide.outputs) decide.outputs = ["补货 SKU/数量", "清仓清单"];
  phases.decide = decide;

  const act = { ...(phases.act || {}) } as Record<string, unknown>;
  if (!act.title) act.title = "执行";
  if (!act.description) act.description = PHASE_BLURB.act.subtitle;
  if (!act.actions) act.actions = ["创建采购申请", "仓间调拨", "调整投放优先级"];
  if (act.require_confirm == null) act.require_confirm = true;
  phases.act = act;

  const learn = { ...(phases.learn || {}) } as Record<string, unknown>;
  if (!learn.title) learn.title = "学习";
  if (!learn.description) learn.description = PHASE_BLURB.learn.subtitle;
  if (!learn.eval_metrics) learn.eval_metrics = ["缺货率", "库存周转天数", "滞销库存金额"];
  phases.learn = learn;

  return {
    ...raw,
    loop_condition: raw.loop_condition || "安全库存达标，响应时效 < 24h，缺货率 < 5%",
    phases,
  };
}
