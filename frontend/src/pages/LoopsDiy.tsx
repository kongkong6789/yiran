import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App, Button, Divider, Empty, Input, InputNumber, Radio, Select, Space, Tag, Typography,
} from "antd";
import {
  ClearOutlined, DatabaseOutlined, DeleteOutlined, LinkOutlined, PlusOutlined,
  SaveOutlined, SyncOutlined,
} from "@ant-design/icons";
import {
  addObject, addRelation, createLoop, detectLoops, updateObject, updateRelation,
  type LoopDetectCandidate,
} from "../api/client";
import LoopsDiyCanvas, {
  DIY_KIND_META,
  DRAFT_STORAGE_KEY,
  emptyDraft,
  loadDraft,
  newDiyEdge,
  newDiyNode,
  saveDraft,
  type DiyDraft,
  type DiyEdge,
  type DiyKind,
  type DiyNode,
} from "../components/LoopsDiyCanvas";

const { Text, Title } = Typography;

function evidenceLabel(score: number | null | undefined) {
  if (score == null || Number.isNaN(score)) return "未评";
  if (score >= 80) return "强";
  if (score >= 50) return "中";
  if (score >= 1) return "弱";
  return "无";
}

export default function LoopsDiy() {
  const { message, modal } = App.useApp();
  const [draft, setDraft] = useState<DiyDraft>(() => loadDraft());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [candidates, setCandidates] = useState<LoopDetectCandidate[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  const selectedNode = useMemo(
    () => draft.nodes.find((n) => n.id === selectedNodeId) || null,
    [draft.nodes, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => draft.edges.find((e) => e.id === selectedEdgeId) || null,
    [draft.edges, selectedEdgeId],
  );

  const patchDraft = useCallback((updater: (prev: DiyDraft) => DiyDraft) => {
    setDraft((prev) => updater(prev));
    setDirty(true);
  }, []);

  const addNode = useCallback(() => {
    const offset = draft.nodes.length * 28;
    const node = newDiyNode(120 + offset, 100 + offset);
    patchDraft((prev) => ({
      ...prev,
      nodes: [...prev.nodes, node],
      updatedAt: new Date().toISOString(),
    }));
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, [draft.nodes.length, patchDraft]);

  const updateNode = useCallback((id: string, patch: Partial<DiyNode>) => {
    patchDraft((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      updatedAt: new Date().toISOString(),
    }));
  }, [patchDraft]);

  const updateNodeBinding = useCallback((id: string, binding: DiyNode["binding"]) => {
    patchDraft((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (
        n.id === id ? { ...n, binding: { ...n.binding, ...binding } } : n
      )),
      updatedAt: new Date().toISOString(),
    }));
  }, [patchDraft]);

  const removeNode = useCallback((id: string) => {
    patchDraft((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
      updatedAt: new Date().toISOString(),
    }));
    setSelectedNodeId(null);
  }, [patchDraft]);

  const connectEdge = useCallback((
    source: string,
    target: string,
    sourceHandle?: string | null,
    targetHandle?: string | null,
  ) => {
    if (!source || !target || source === target) return;

    let selectedId: string | null = null;
    patchDraft((prev) => {
      const same = prev.edges.find((e) => e.source === source && e.target === target);
      if (same) {
        const sameHandles = (
          (same.sourceHandle || null) === (sourceHandle || null)
          && (same.targetHandle || null) === (targetHandle || null)
        );
        if (sameHandles) {
          selectedId = same.id;
          return prev;
        }
        // 同向已有边：只更新接入端点，不打断连线
        selectedId = same.id;
        return {
          ...prev,
          edges: prev.edges.map((e) => (
            e.id === same.id
              ? {
                ...e,
                sourceHandle: sourceHandle || null,
                targetHandle: targetHandle || null,
              }
              : e
          )),
          updatedAt: new Date().toISOString(),
        };
      }
      const edge = newDiyEdge(source, target, sourceHandle, targetHandle);
      selectedId = edge.id;
      return {
        ...prev,
        edges: [...prev.edges, edge],
        updatedAt: new Date().toISOString(),
      };
    });
    if (selectedId) {
      setSelectedEdgeId(selectedId);
      setSelectedNodeId(null);
    }
  }, [patchDraft]);

  const updateEdge = useCallback((id: string, patch: Partial<DiyEdge>) => {
    patchDraft((prev) => ({
      ...prev,
      edges: prev.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      updatedAt: new Date().toISOString(),
    }));
  }, [patchDraft]);

  const removeEdge = useCallback((id: string) => {
    patchDraft((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => e.id !== id),
      updatedAt: new Date().toISOString(),
    }));
    setSelectedEdgeId(null);
  }, [patchDraft]);

  const onNodesPositions = useCallback((positions: Record<string, { x: number; y: number }>) => {
    setDraft((prev) => {
      let changed = false;
      const nodes = prev.nodes.map((n) => {
        const p = positions[n.id];
        if (!p || (p.x === n.x && p.y === n.y)) return n;
        changed = true;
        return { ...n, x: p.x, y: p.y };
      });
      if (!changed) return prev;
      setDirty(true);
      return { ...prev, nodes, updatedAt: new Date().toISOString() };
    });
  }, []);

  const clearCanvas = useCallback(() => {
    modal.confirm({
      title: "清空画布？",
      content: "仅清除本地草稿，不会删除已落库数据。",
      okText: "清空",
      okButtonProps: { danger: true },
      onOk: () => {
        setDraft(emptyDraft());
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setCandidates([]);
        setDirty(false);
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        message.success("已清空");
      },
    });
  }, [message, modal]);

  const persistToOntology = useCallback(async () => {
    if (!draft.nodes.length) {
      message.warning("请先添加节点");
      return;
    }
    setSaving(true);
    try {
      const idMap = new Map<string, number>();
      const buildAttrs = (node: DiyNode) => {
        const attrs: Record<string, unknown> = {
          diy_id: node.id,
          diy_kind: node.kind,
          数据来源: "Loops DIY",
        };
        if (node.binding.data_path) attrs.data_path = node.binding.data_path;
        if (node.binding.metric_code) attrs.metric_code = node.binding.metric_code;
        if (node.binding.source) attrs.binding_source = node.binding.source;
        if (node.binding.note) attrs.binding_note = node.binding.note;
        if (node.binding.ont_object_id) attrs.bound_ont_object_id = node.binding.ont_object_id;
        return attrs;
      };

      for (const node of draft.nodes) {
        const payload = {
          category: "virtual" as const,
          otype: DIY_KIND_META[node.kind].otype,
          name: node.name.trim() || DIY_KIND_META[node.kind].label,
          attributes: buildAttrs(node),
          x: node.x,
          y: node.y,
        };
        if (node.persistedObjectId) {
          await updateObject(node.persistedObjectId, payload);
          idMap.set(node.id, node.persistedObjectId);
          continue;
        }
        const created = await addObject(payload);
        idMap.set(node.id, created.id);
      }

      const edgePersisted: DiyEdge[] = [];
      for (const edge of draft.edges) {
        const sourceId = idMap.get(edge.source);
        const targetId = idMap.get(edge.target);
        if (!sourceId || !targetId) continue;

        let relationId = edge.persistedRelationId;
        if (!relationId) {
          const created = await addRelation({
            source: sourceId,
            target: targetId,
            label: edge.label || "影响",
          });
          relationId = created.id;
        }
        await updateRelation(relationId, {
          label: edge.label || "影响",
          polarity: edge.polarity || "",
          delay_days: edge.delay_days ?? null,
          evidence_score: edge.evidence_score ?? null,
          is_causal_candidate: true,
        });
        edgePersisted.push({ ...edge, persistedRelationId: relationId });
      }

      const nextNodes = draft.nodes.map((n) => ({
        ...n,
        persistedObjectId: idMap.get(n.id) ?? n.persistedObjectId,
      }));
      const nextEdges = draft.edges.map((e) => {
        const hit = edgePersisted.find((x) => x.id === e.id);
        return hit || e;
      });

      setDraft({
        ...draft,
        nodes: nextNodes,
        edges: nextEdges,
        updatedAt: new Date().toISOString(),
      });
      setDirty(false);
      message.success(`已落库：${nextNodes.length} 个节点、${edgePersisted.length} 条边`);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "落库失败");
    } finally {
      setSaving(false);
    }
  }, [draft, message]);

  const runDetect = useCallback(async () => {
    const relationIds = draft.edges
      .map((e) => e.persistedRelationId)
      .filter((id): id is number => typeof id === "number");
    if (!relationIds.length) {
      message.warning("请先保存落库，再检测回路");
      return;
    }
    setDetecting(true);
    try {
      const result = await detectLoops({ relation_ids: relationIds, candidates_only: true });
      setCandidates(result.candidates || []);
      if (!result.candidates?.length) {
        message.info(result.diagnostics?.reason || "未检测到闭合回路");
      } else {
        message.success(`检测到 ${result.candidates.length} 条候选回路`);
      }
    } catch (error: any) {
      message.error(error?.response?.data?.error || "检测失败");
    } finally {
      setDetecting(false);
    }
  }, [draft.edges, message]);

  const saveCandidateAsLoop = useCallback(async (cand: LoopDetectCandidate, index: number) => {
    try {
      const loop = await createLoop({
        name: `DIY 回路 ${index + 1}`,
        code: `DIY-${Date.now().toString(36).toUpperCase()}`,
        loop_type: (cand.loop_type as "R" | "B" | "comp") || "R",
        description: "由回路 DIY 画布检测生成",
        confidence: cand.confidence || 60,
        relation_ids: cand.relation_ids,
      });
      message.success(`已写入回路库：${loop.name}`);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "写入回路库失败");
    }
  }, [message]);

  const boundCount = draft.nodes.filter((n) => (
    n.binding.data_path || n.binding.metric_code || n.binding.ont_object_id
  )).length;

  return (
    <div className="loops-diy-page">
      <aside className="loops-diy-rail">
        <div className="loops-diy-rail-head">
          <Title level={5} style={{ margin: 0 }}>画布工具</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            先添加节点，再在右侧选择类型并绑定
          </Text>
        </div>
        <Button type="primary" block icon={<PlusOutlined />} onClick={addNode}>
          添加节点
        </Button>
        <Divider style={{ margin: "16px 0" }} />
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            节点 {draft.nodes.length} · 已绑定 {boundCount} · 边 {draft.edges.length}
            {dirty ? " · 未落库" : ""}
          </Text>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            block
            onClick={() => void persistToOntology()}
          >
            保存落库
          </Button>
          <Button
            icon={<SyncOutlined />}
            loading={detecting}
            block
            onClick={() => void runDetect()}
          >
            检测回路
          </Button>
          <Button icon={<ClearOutlined />} block danger ghost onClick={clearCanvas}>
            清空草稿
          </Button>
        </Space>
        {candidates.length > 0 && (
          <>
            <Divider style={{ margin: "16px 0" }} />
            <Text strong style={{ fontSize: 13 }}>候选回路</Text>
            <Space direction="vertical" style={{ width: "100%", marginTop: 8 }} size={8}>
              {candidates.map((c, i) => (
                <div key={`${c.relation_ids.join("-")}-${i}`} className="loops-diy-candidate">
                  <div>
                    <Tag color={c.loop_type === "B" ? "blue" : "purple"}>
                      {c.loop_type || "R"}
                    </Tag>
                    <Text style={{ fontSize: 12 }}>
                      {c.relation_ids.length} 边 · 置信 {c.confidence}
                    </Text>
                  </div>
                  <Button size="small" type="link" onClick={() => void saveCandidateAsLoop(c, i)}>
                    写入回路库
                  </Button>
                </div>
              ))}
            </Space>
          </>
        )}
      </aside>

      <main className="loops-diy-canvas-shell">
        <div className="loops-diy-toolbar">
          <Space wrap>
            <Tag color="processing">回路 DIY</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              拖拽连线 · 本地草稿自动保存 · 点「保存落库」写入本体
            </Text>
          </Space>
        </div>
        <div className="loops-diy-canvas">
          <LoopsDiyCanvas
            draft={draft}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSelectNode={(id) => { setSelectedNodeId(id); setSelectedEdgeId(null); }}
            onSelectEdge={(id) => { setSelectedEdgeId(id); setSelectedNodeId(null); }}
            onConnect={connectEdge}
            onNodesPositions={onNodesPositions}
            onDeleteEdge={removeEdge}
          />
        </div>
      </main>

      <aside className="loops-diy-inspector">
        <Title level={5} style={{ margin: "0 0 12px" }}>属性</Title>
        {!selectedNode && !selectedEdge && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中节点或连线" />
        )}

        {selectedNode && (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            <div>
              {selectedNode.persistedObjectId ? (
                <Tag color="green">已落库 #{selectedNode.persistedObjectId}</Tag>
              ) : (
                <Tag>草稿</Tag>
              )}
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>类型</Text>
              <Select
                style={{ width: "100%" }}
                value={selectedNode.kind}
                onChange={(kind: DiyKind) => updateNode(selectedNode.id, { kind })}
                options={(Object.keys(DIY_KIND_META) as DiyKind[]).map((kind) => ({
                  value: kind,
                  label: `${DIY_KIND_META[kind].label}（${DIY_KIND_META[kind].hint}）`,
                }))}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>名称</Text>
              <Input
                value={selectedNode.name}
                onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
                placeholder="节点名称"
              />
            </div>
            <Divider style={{ margin: "4px 0" }} />
            <Text strong style={{ fontSize: 13 }}>
              <DatabaseOutlined /> 绑定数据
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              节点先新建，再在此绑定路径 / 指标（可不绑）
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>数据路径</Text>
              <Input
                value={selectedNode.binding.data_path || ""}
                onChange={(e) => updateNodeBinding(selectedNode.id, { data_path: e.target.value })}
                placeholder="如 ads.metric_snapshot.gmv"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>指标 code</Text>
              <Input
                value={selectedNode.binding.metric_code || ""}
                onChange={(e) => updateNodeBinding(selectedNode.id, { metric_code: e.target.value })}
                placeholder="如 gmv / inventory_qty"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>数据源</Text>
              <Select
                allowClear
                style={{ width: "100%" }}
                value={selectedNode.binding.source || undefined}
                onChange={(v) => updateNodeBinding(selectedNode.id, { source: v || "" })}
                options={[
                  { value: "pg", label: "PostgreSQL 数仓" },
                  { value: "jackyun", label: "吉客云" },
                  { value: "kingdee", label: "金蝶" },
                  { value: "rag", label: "知识库 / RAG" },
                  { value: "manual", label: "手工录入" },
                ]}
                placeholder="选择来源"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>绑定备注</Text>
              <Input.TextArea
                rows={2}
                value={selectedNode.binding.note || ""}
                onChange={(e) => updateNodeBinding(selectedNode.id, { note: e.target.value })}
                placeholder="说明如何取数、口径等"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>可选：绑定已有本体 ID</Text>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                value={selectedNode.binding.ont_object_id ?? undefined}
                onChange={(v) => updateNodeBinding(selectedNode.id, {
                  ont_object_id: typeof v === "number" ? v : undefined,
                })}
                placeholder="OntObject id（可选）"
              />
            </div>
            <Button danger icon={<DeleteOutlined />} block onClick={() => removeNode(selectedNode.id)}>
              删除节点
            </Button>
          </Space>
        )}

        {selectedEdge && (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            <div>
              <Tag icon={<LinkOutlined />}>因果边</Tag>
              {selectedEdge.persistedRelationId ? (
                <Tag color="green">已落库 #{selectedEdge.persistedRelationId}</Tag>
              ) : (
                <Tag>草稿</Tag>
              )}
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>标签</Text>
              <Input
                value={selectedEdge.label}
                onChange={(e) => updateEdge(selectedEdge.id, { label: e.target.value })}
                placeholder="如 促进 / 抑制 / 延迟反馈"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>极性</Text>
              <Radio.Group
                value={selectedEdge.polarity || ""}
                onChange={(e) => updateEdge(selectedEdge.id, { polarity: e.target.value })}
                optionType="button"
                options={[
                  { label: "正 +", value: "+" },
                  { label: "负 −", value: "-" },
                  { label: "未标", value: "" },
                ]}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>延迟（天）</Text>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                step={0.5}
                value={selectedEdge.delay_days ?? undefined}
                onChange={(v) => updateEdge(selectedEdge.id, {
                  delay_days: typeof v === "number" ? v : null,
                })}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                证据分（0–100）· {evidenceLabel(selectedEdge.evidence_score)}
              </Text>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                max={100}
                value={selectedEdge.evidence_score ?? undefined}
                onChange={(v) => updateEdge(selectedEdge.id, {
                  evidence_score: typeof v === "number" ? v : null,
                })}
              />
            </div>
            <Button danger icon={<DeleteOutlined />} block onClick={() => removeEdge(selectedEdge.id)}>
              删除连线
            </Button>
          </Space>
        )}
      </aside>

      <style>{`
.loops-diy-page {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 280px;
  height: calc(100vh - 64px);
  min-height: 520px;
  background: var(--lc-bg, #f5f7fb);
  color: var(--lc-text);
}
.loops-diy-rail,
.loops-diy-inspector {
  padding: 16px;
  border-right: 1px solid var(--lc-border, #e5e9f0);
  background: var(--lc-surface, #fff);
  overflow: auto;
}
.loops-diy-inspector {
  border-right: none;
  border-left: 1px solid var(--lc-border, #e5e9f0);
}
.loops-diy-rail-head {
  margin-bottom: 12px;
}
.loops-diy-canvas-shell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.loops-diy-toolbar {
  padding: 10px 14px;
  border-bottom: 1px solid var(--lc-border, #e5e9f0);
  background: var(--lc-surface, #fff);
}
.loops-diy-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
}
.loops-diy-candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--lc-bg-muted, #f0f3f8);
}
.loops-diy-node {
  position: relative;
  min-width: 168px;
  max-width: 220px;
  padding: 10px 12px 12px;
  border-radius: 12px;
  border: 1.5px solid color-mix(in srgb, var(--diy-accent) 55%, transparent);
  background: var(--diy-soft);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}
.loops-diy-node.is-selected {
  border-color: var(--diy-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--diy-accent) 28%, transparent);
}
.loops-diy-node-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.loops-diy-node-kind {
  font-size: 11px;
  font-weight: 600;
  color: var(--diy-accent);
}
.loops-diy-node-bind {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: var(--lc-text-muted, #64748b);
}
.loops-diy-node-bind.is-bound {
  background: color-mix(in srgb, var(--diy-accent) 18%, transparent);
  color: var(--diy-accent);
}
.loops-diy-node-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--lc-ink, #0f172a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loops-diy-node-path {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--lc-text-muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loops-diy-handle {
  width: 10px !important;
  height: 10px !important;
  background: var(--diy-accent) !important;
  border: 2px solid var(--lc-surface, #fff) !important;
  z-index: 3;
}
.loops-diy-node .react-flow__handle-top {
  top: 0 !important;
  left: 50% !important;
  transform: translate(-50%, -50%) !important;
}
.loops-diy-node .react-flow__handle-bottom {
  bottom: 0 !important;
  top: auto !important;
  left: 50% !important;
  transform: translate(-50%, 50%) !important;
}
.loops-diy-node .react-flow__handle-left {
  left: 0 !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
}
.loops-diy-node .react-flow__handle-right {
  right: 0 !important;
  left: auto !important;
  top: 50% !important;
  transform: translate(50%, -50%) !important;
}
.loops-diy-edge-label {
  position: absolute;
  pointer-events: all;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--lc-surface, #fff);
  border: 1px solid var(--lc-border, #e5e9f0);
  color: var(--lc-text);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.loops-diy-edge-label.is-negative {
  border-color: #f0a8a0;
  color: #c0392b;
}
.loops-diy-edge-label i {
  font-style: normal;
  font-weight: 700;
}
.loops-diy-edge-label em {
  font-style: normal;
  opacity: 0.75;
}
@media (max-width: 1100px) {
  .loops-diy-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(360px, 1fr) auto;
    height: auto;
  }
  .loops-diy-rail,
  .loops-diy-inspector {
    border: none;
    border-bottom: 1px solid var(--lc-border, #e5e9f0);
  }
}
`}</style>
    </div>
  );
}
