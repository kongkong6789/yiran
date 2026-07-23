import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BranchesOutlined,
  CodeOutlined,
  CommentOutlined,
  CopyOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HistoryOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
  ShoppingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { App, Button, Dropdown, Empty, Input, Modal, Select, Space, Spin, Table, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  createSop,
  createSopVersion,
  duplicateSop,
  getSop,
  getSopVersion,
  listSops,
  listSopVersions,
  publishSopVersion,
  rewriteSopWithAi,
  updateSop,
  updateSopVersion,
  type SopDefinitionItem,
  type SopDraftPayload,
  type SopGraphNode,
  type SopVersionItem,
} from "../api/client";

const EMPTY_GRAPH: SopDraftPayload["graph"] = {
  start: "collect.scope",
  terminals: ["finish"],
  nodes: [
    { key: "collect.scope", type: "collect_info", title: "确认任务所需信息", config: { required_fields: [] } },
    { key: "execute", type: "execute_action", title: "执行业务动作", config: { action_name: "report.generate" } },
    { key: "finish", type: "end", title: "生成结果并留存证据", config: {} },
  ],
  edges: [
    { source: "collect.scope", target: "execute", condition: "always", priority: 1 },
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

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; model?: string };
type FlowNodeData = { kind: "meta" | "step"; draft: SopDraftPayload; step?: SopGraphNode; index?: number };

const NODE_LABELS: Record<string, string> = {
  collect_info: "收集信息",
  checkpoint: "人工确认",
  execute_action: "执行动作",
  gate: "安全闸机",
  handoff: "转人工",
  end: "完成",
};

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

function errorText(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

function MetaNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const draft = data.draft;
  const fields = draft.graph.nodes
    .flatMap((node) => Array.isArray(node.config?.required_fields) ? node.config.required_fields as string[] : [])
    .filter((value, index, list) => list.indexOf(value) === index);
  return <article className="sop-canvas-node sop-canvas-meta-node">
    <div className="sop-canvas-eyebrow">基础信息</div>
    <strong>{draft.name || "未命名 SOP"}</strong>
    <code>{draft.key || "等待 AI 生成 SOP ID"}</code>
    <p>{draft.description || "在左侧描述业务目标，AI 会补全流程说明。"}</p>
    <small>业务域</small><span className="sop-node-field">{draft.businessDomain || "未分类"}</span>
    {fields.length > 0 && <><small>必填信息</small><div className="sop-node-tags">{fields.map((field) => <em key={field}>{field}</em>)}</div></>}
    <Handle type="source" position={Position.Bottom} />
  </article>;
}

function StepNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const step = data.step!;
  const config = step.config || {};
  const fields = Array.isArray(config.required_fields) ? config.required_fields as string[] : [];
  const action = String(config.action_name || "");
  return <article className={`sop-canvas-node sop-canvas-step-node is-${step.type}`}>
    <Handle type="target" position={Position.Top} />
    <div className="sop-canvas-node-head"><span>节点 {(data.index || 0) + 1}</span><Tag>{NODE_LABELS[step.type] || step.type}</Tag></div>
    <strong>{step.title}</strong>
    <code>{step.key}</code>
    <p>{String(config.detail || config.message || "按流程配置执行并记录结果。")}</p>
    {fields.length > 0 && <div className="sop-node-tags">{fields.map((field) => <em key={field}>{field}</em>)}</div>}
    {action && <div className="sop-node-action">动作：{action}</div>}
    <Handle type="source" position={Position.Bottom} />
  </article>;
}

const NODE_TYPES = { meta: MetaNode, step: StepNode };

function layoutGraph(draft: SopDraftPayload): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const graph = draft.graph;
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
    id: "__meta__", type: "meta", position: { x: 360, y: 20 }, data: { kind: "meta", draft }, draggable: false,
  }];
  graph.nodes.forEach((step, index) => {
    const level = depth.get(step.key) || 0;
    const peers = groups.get(level) || [step];
    const peerIndex = peers.findIndex((item) => item.key === step.key);
    const totalWidth = (peers.length - 1) * 360;
    nodes.push({
      id: step.key,
      type: "step",
      position: { x: 360 - totalWidth / 2 + peerIndex * 360, y: 300 + level * 300 },
      data: { kind: "step", draft, step, index },
      draggable: false,
    });
  });
  const edges: Edge[] = [
    { id: "meta-start", source: "__meta__", target: graph.start, animated: false, label: "开始", className: "sop-flow-edge" },
    ...graph.edges.map((edge, index) => ({
      id: `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.condition === "always" ? "" : edge.condition.replace("decision:", ""),
      className: "sop-flow-edge",
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

function SopFlowCanvas({ draft }: { draft: SopDraftPayload }) {
  const model = useMemo(() => layoutGraph(draft), [draft]);
  return <ReactFlowProvider><div className="sop-flow-canvas">
    <ReactFlow
      nodes={model.nodes}
      edges={model.edges}
      nodeTypes={NODE_TYPES}
      onInit={(flow) => { void flow.setCenter(555, 150, { zoom: 0.72 }); }}
      minZoom={0.28}
      maxZoom={1.45}
      nodesConnectable={false}
      elementsSelectable
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
  const updateBase = (patch: Partial<SopDraftPayload>) => onChange({ ...draft, ...patch });
  const updateNode = (index: number, patch: Partial<SopGraphNode>, configPatch?: Record<string, unknown>) => {
    const nodes = draft.graph.nodes.map((node, nodeIndex) => nodeIndex === index
      ? { ...node, ...patch, config: { ...node.config, ...(configPatch || {}) } }
      : node);
    onChange({ ...draft, graph: { ...draft.graph, nodes } });
  };
  const addNode = (beforeIndex?: number) => {
    const terminalKey = draft.graph.terminals[0] || "finish";
    const terminalIndex = draft.graph.nodes.findIndex((node) => node.key === terminalKey);
    const insertIndex = beforeIndex ?? (terminalIndex >= 0 ? terminalIndex : draft.graph.nodes.length);
    let suffix = draft.graph.nodes.length + 1;
    let key = `step.${suffix}`;
    while (draft.graph.nodes.some((node) => node.key === key)) { suffix += 1; key = `step.${suffix}`; }
    const node: SopGraphNode = { key, type: "checkpoint", title: "新流程节点", config: { detail: "说明这个节点要完成的工作" } };
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
        <label className="is-wide"><span>目标动作</span><Input value={draft.actionName} disabled={disabled} onChange={(event) => updateBase({ actionName: event.target.value })} /></label>
      </div>
    </section>

    <section className="sop-source-section">
      <div className="sop-source-section-head"><h4>详细节点</h4>{!disabled && <Button size="small" icon={<PlusOutlined />} onClick={() => addNode()}>在末端前新增节点</Button>}</div>
      <div className="sop-source-node-list">
        {draft.graph.nodes.map((node, index) => {
          const fields = Array.isArray(node.config.required_fields) ? node.config.required_fields as string[] : [];
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
              <label className="is-wide"><span>节点说明</span><Input.TextArea rows={2} value={String(node.config.detail || node.config.message || "")} disabled={disabled} onChange={(event) => updateNode(index, {}, { detail: event.target.value })} /></label>
              <label className="is-wide"><span>期望字段</span><Input value={fields.join("，")} disabled={disabled} placeholder="多个字段用逗号分隔" onChange={(event) => updateNode(index, {}, { required_fields: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} /></label>
              {(node.type === "execute_action" || node.type === "gate") && <label className="is-wide"><span>调用动作</span><Input value={String(node.config.action_name || "")} disabled={disabled} placeholder="例如：report.generate" onChange={(event) => updateNode(index, {}, { action_name: event.target.value })} /></label>}
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

function SopEditor({ initial, record, openVersionsOnMount = false, onBack, onSaved }: {
  initial: SopDraftPayload;
  record?: SopDefinitionItem;
  openVersionsOnMount?: boolean;
  onBack: () => void;
  onSaved: (item: SopDefinitionItem) => void;
}) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState(initial);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome", role: "assistant",
    content: record
      ? `已加载「${initial.name}」。你可以告诉我需要增加、删除或调整哪些步骤，我会同步更新右侧流程图。`
      : "请描述这个 SOP 要解决的业务问题、需要收集的信息和最终交付结果，我会和你一起生成完整流程。",
  }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"flow" | "source">("flow");
  const [versions, setVersions] = useState<SopVersionItem[]>(record?.version ? [record.version] : []);
  const [selectedVersion, setSelectedVersion] = useState<SopVersionItem | undefined>(record?.version);
  const [versionOpen, setVersionOpen] = useState(Boolean(openVersionsOnMount && record));
  const readOnly = Boolean(record && selectedVersion?.status !== "draft");

  const refreshVersions = useCallback(async () => {
    if (!record) return;
    try { setVersions((await listSopVersions(record.key)).results || []); }
    catch (error) { message.error(errorText(error, "版本历史加载失败")); }
  }, [message, record]);

  useEffect(() => { void refreshVersions(); }, [refreshVersions]);

  useEffect(() => {
    if (openVersionsOnMount && record) setVersionOpen(true);
  }, [openVersionsOnMount, record]);

  const selectVersion = async (version: string) => {
    if (!record) return;
    try {
      const detail = await getSopVersion(record.key, version);
      setSelectedVersion(detail);
      setDraft({ ...draft, version: detail.version, triggerIntents: detail.triggerIntents || [], utteranceExamples: detail.utteranceExamples || [], graph: detail.graph });
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
      await refreshVersions();
      setVersionOpen(false);
      message.success(`已创建可编辑草稿 ${next}`);
    } catch (error) { message.error(errorText(error, "创建新版本失败")); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || readOnly) return;
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const response = await rewriteSopWithAi({
        instruction: text,
        draft,
        history: messages.map(({ role, content }) => ({ role, content })),
      });
      setDraft(response.draft);
      setMessages([...nextMessages, { id: `a-${Date.now()}`, role: "assistant", content: response.assistant, model: response.model }]);
    } catch (error) {
      setMessages([...nextMessages, { id: `e-${Date.now()}`, role: "assistant", content: errorText(error, "AI 暂时无法修改这个流程，请稍后重试。") }]);
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!draft.key.trim()) {
      message.warning("请先让 AI 补充一个稳定的 SOP ID，或在源码中填写 key");
      return false;
    }
    setSaving(true);
    const payload = { ...draft, inputSchema: {}, outputSchema: {} };
    try {
      let saved: SopDefinitionItem;
      if (!record) saved = await createSop(payload);
      else {
        await updateSop(record.key, payload);
        saved = selectedVersion?.status === "draft"
          ? await updateSopVersion(record.key, selectedVersion.version, payload).then(() => getSop(record.key))
          : await getSop(record.key);
      }
      message.success("SOP 草稿已保存");
      setSelectedVersion(saved.version);
      await refreshVersions();
      onSaved(saved);
      return true;
    } catch (error) {
      message.error(errorText(error, "SOP 草稿保存失败"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const publishCurrent = async () => {
    if (!record || selectedVersion?.status !== "draft") return;
    if (!(await saveDraft())) return;
    try {
      const published = await publishSopVersion(record.key, selectedVersion.version);
      setSelectedVersion(published.version);
      await refreshVersions();
      message.success(`SOP ${selectedVersion.version} 已发布`);
      onSaved(published);
    } catch (error) { message.error(errorText(error, "版本发布失败")); }
  };

  return <section className="sop-distill-page">
    <header className="sop-distill-header">
      <div><Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button><span><strong>编辑 SOP</strong><small>{draft.name}</small></span></div>
      <Space>
        {record && <Button icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>版本 {selectedVersion?.version || draft.version}</Button>}
        {selectedVersion && <Tag color={selectedVersion.status === "draft" ? "gold" : selectedVersion.status === "published" ? "green" : "default"}>{selectedVersion.status === "draft" ? "草稿" : selectedVersion.status === "published" ? "已发布" : "历史版本"}</Tag>}
        {record?.canEdit && readOnly && <Button onClick={() => void createEditorVersion()}>创建新版本</Button>}
        <Button disabled={readOnly} onClick={() => { setDraft(EMPTY_DRAFT); setMessages([]); }}>清空</Button>
        <Button icon={<SaveOutlined />} loading={saving} disabled={readOnly} onClick={() => void saveDraft()}>保存草稿</Button>
        {record?.canEdit && selectedVersion?.status === "draft" && <Button type="primary" onClick={() => void publishCurrent()}>发布版本</Button>}
      </Space>
    </header>
    <div className="sop-distill-workbench">
      <section className="sop-chat-panel">
        <div className="sop-panel-title"><strong>AI 流程设计</strong><span>通过对话创建和修改 SOP</span></div>
        <div className="sop-chat-messages">
          {messages.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="描述你想创建的业务流程" />}
          {messages.map((item) => <div key={item.id} className={`sop-chat-row is-${item.role}`}>
            <div className="sop-chat-avatar">{item.role === "assistant" ? "AI" : "我"}</div>
            <div className="sop-chat-bubble"><p>{item.content}</p>{item.model && <small>{item.model}</small>}</div>
          </div>)}
          {sending && <div className="sop-chat-row is-assistant"><div className="sop-chat-avatar">AI</div><div className="sop-chat-bubble is-thinking"><Spin size="small" /> 正在理解并重构流程…</div></div>}
        </div>
        <div className="sop-chat-composer">
          <Input.TextArea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send(); } }}
            placeholder={readOnly ? "已发布版本不可修改，请先创建新版本" : "例如：生成销售周报前，先确认品牌、日期范围；数据异常时转人工…"}
            autoSize={{ minRows: 4, maxRows: 7 }}
            disabled={readOnly}
          />
          <div><span>Enter 发送 · Shift+Enter 换行</span><Button type="primary" icon={sending ? <StopOutlined /> : <SendOutlined />} disabled={!input.trim() || readOnly} onClick={() => void send()}>{sending ? "生成中" : "发送"}</Button></div>
        </div>
      </section>

      <section className="sop-design-panel">
        <div className="sop-panel-title">
          <strong>{view === "flow" ? "流程图" : "SOP 源码"}</strong>
          <Space>
            <Button icon={view === "flow" ? <CodeOutlined /> : <BranchesOutlined />} onClick={() => setView(view === "flow" ? "source" : "flow")}>{view === "flow" ? "显示源码" : "显示流程"}</Button>
          </Space>
        </div>
        {view === "flow" ? <SopFlowCanvas draft={draft} /> : <SopStructuredSource draft={draft} disabled={readOnly} onChange={setDraft} />}
      </section>
    </div>
    <Modal open={versionOpen} title="版本管理" footer={null} width={720} onCancel={() => setVersionOpen(false)}>
      <div className="sop-version-manager">
        <div className="sop-version-manager-head">
          <div><strong>{record?.name}</strong><span>已发布版本不可修改；创建新版本后可继续通过 AI 或表单编辑。</span></div>
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
  </section>;
}

export default function SopCenter() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [items, setItems] = useState<SopDefinitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<{ draft: SopDraftPayload; record?: SopDefinitionItem; openVersions?: boolean }>();

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

  const openEdit = async (item: SopDefinitionItem, options?: { openVersions?: boolean }) => {
    try {
      const detail = await getSop(item.key);
      setEditor({ draft: toDraft(detail), record: detail, openVersions: options?.openVersions });
    }
    catch (error) { message.error(errorText(error, "SOP 详情加载失败")); }
  };

  const copySystem = async (item: SopDefinitionItem) => {
    try {
      const copy = await duplicateSop(item.key);
      const detail = await getSop(copy.key);
      message.success(`已复制为「${detail.name}」`);
      await refresh();
      setEditor({ draft: toDraft(detail), record: detail });
    } catch (error) { message.error(errorText(error, "复制失败")); }
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

  const runSopTemplate = (row: SopDefinitionItem) => {
    if (sopStatusLabel(row) === "draft") {
      message.info("草稿 SOP 需先发布后再运行");
      return;
    }
    navigate(`/work?view=create&sop=${encodeURIComponent(row.key)}`);
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
    { title: "成功率", dataIndex: "successRate", width: 90, render: (value: number) => `${value || 0}%` },
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
          ];
        return (
          <div className="sop-template-actions">
            <Button className="sop-template-run-btn" size="small" icon={<PlayCircleOutlined />} onClick={() => runSopTemplate(row)}>
              运行
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
        onBack={() => setEditor(undefined)}
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
