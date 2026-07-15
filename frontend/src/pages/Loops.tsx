import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  App, Button, Card, Collapse, Descriptions, Divider, Empty, Form, Input, InputNumber,
  Modal, Segmented, Select, Space, Table, Tabs, Tag, Typography,
} from "antd";
import {
  CheckOutlined, DeleteOutlined, EyeOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined, ShareAltOutlined,
} from "@ant-design/icons";
import {
  confirmLoop, createLoop, createLoopFromCandidate, deleteLoop, detectLoops, getLoop,
  listCausalCandidates, listLoops,
  type FeedbackLoop, type LoopDetectCandidate, type LoopDetectDiagnostics,
} from "../api/client";
import BrandAgencyLoops from "../components/BrandAgencyLoops";
import BrandStockFlowLoop from "../components/BrandStockFlowLoop";
import LoopRingDiagram from "../components/LoopRingDiagram";

const TYPE_COLOR: Record<string, string> = { R: "red", B: "blue", comp: "purple" };
const TYPE_LABEL: Record<string, string> = { R: "增强 R", B: "调节 B", comp: "复合" };
const TYPE_RING: Record<string, string> = { R: "#cf1322", B: "#1677ff", comp: "#722ed1" };
const STATUS_COLOR: Record<string, string> = {
  candidate: "gold", confirmed: "green", archived: "default",
};
const STATUS_LABEL: Record<string, string> = {
  candidate: "候选", confirmed: "已确认", archived: "归档",
};

const BRAND_LOOP_CODE = "BRAND-SF";
const AGENCY_LOOP_CODE = "BRAND-AGENCY-8S";

/** 卡片缩略环：按链长画圆点，轻量流动 */
function LoopThumb({ type, count }: { type: string; count: number }) {
  const n = Math.max(3, Math.min(count || 3, 8));
  const ring = TYPE_RING[type] || "#5c6b84";
  const cx = 60;
  const cy = 52;
  const r = 28;
  const nodes = Array.from({ length: n }, (_, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
  });
  return (
    <svg className="loops-thumb" viewBox="0 0 120 104" aria-hidden>
      <circle cx={cx} cy={cy} r="40" fill="none" stroke={ring} strokeOpacity="0.12" strokeWidth="10" />
      <circle cx={cx} cy={cy} r="14" fill="#fff" stroke={ring} strokeOpacity="0.45" strokeWidth="1.5" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={ring}>{type}</text>
      {nodes.map((p, i) => {
        const q = nodes[(i + 1) % n];
        return (
          <g key={i}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={ring} strokeOpacity="0.35" strokeWidth="1.5">
              <animate attributeName="stroke-opacity" values="0.25;0.55;0.25" dur={`${1.2 + i * 0.15}s`} repeatCount="indefinite" />
            </line>
            <circle cx={p.x} cy={p.y} r="5" fill="#fff" stroke={ring} strokeWidth="1.5" />
          </g>
        );
      })}
      {/* 光点沿第一段流动 */}
      <circle r="2.4" fill={ring}>
        <animateMotion dur="1.6s" repeatCount="indefinite" path={`M ${nodes[0].x} ${nodes[0].y} L ${nodes[1].x} ${nodes[1].y}`} />
      </circle>
    </svg>
  );
}

export default function Loops() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const [loops, setLoops] = useState<FeedbackLoop[]>([]);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [candidates, setCandidates] = useState<LoopDetectCandidate[]>([]);
  const [diagnostics, setDiagnostics] = useState<LoopDetectDiagnostics | null>(null);
  const [markedRels, setMarkedRels] = useState<
    { id: number; source_name?: string; target_name?: string; label: string; polarity?: string }[]
  >([]);
  const [detail, setDetail] = useState<FeedbackLoop | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "chained" | "method">("all");
  const [form] = Form.useForm();
  const seededRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    return listLoops()
      .then((r) => setLoops(r.results))
      .finally(() => setLoading(false));
  }, []);

  const loadMarked = useCallback(() => {
    return listCausalCandidates().then((r) => setMarkedRels(r.results)).catch(() => undefined);
  }, []);

  const ensureBrandLoop = useCallback(async () => {
    if (seededRef.current) return;
    seededRef.current = true;
    try {
      const r = await listLoops();
      const codes = new Set(r.results.map((x) => x.code));
      if (!codes.has(BRAND_LOOP_CODE)) {
        const created = await createLoop({
          name: "品牌经营 Stock–Flow 回路",
          code: BRAND_LOOP_CODE,
          loop_type: "comp",
          relation_ids: [],
          confidence: 88,
          description:
            "方法索引：R1 增长飞轮、R2 时事放大、B1 成本调节、B2 竞品对冲。完整动图见「方法示意」。",
        });
        await confirmLoop(created.id, { confirmed_by: "系统预置", confidence: 88 });
      }
      if (!codes.has(AGENCY_LOOP_CODE)) {
        const created = await createLoop({
          name: "Loops Method · 品牌代理 8 Stock",
          code: AGENCY_LOOP_CODE,
          loop_type: "comp",
          relation_ids: [],
          confidence: 92,
          description: "方法索引：S1–S8 与 A–E 骨架链。完整动图见「方法示意」。",
        });
        await confirmLoop(created.id, { confirmed_by: "系统预置", confidence: 92 });
      }
    } catch {
      seededRef.current = false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      await ensureBrandLoop();
      await load();
      await loadMarked();
    })();
  }, [ensureBrandLoop, load, loadMarked]);

  const chained = useMemo(
    () => loops.filter((l) => (l.member_count || 0) > 0 && l.status !== "archived"),
    [loops],
  );
  const methodIndex = useMemo(
    () => loops.filter((l) =>
      (l.code === BRAND_LOOP_CODE || l.code === AGENCY_LOOP_CODE) && !(l.member_count > 0),
    ),
    [loops],
  );
  const otherEmpty = useMemo(
    () => loops.filter((l) =>
      l.status !== "archived"
      && !(l.member_count > 0)
      && l.code !== BRAND_LOOP_CODE
      && l.code !== AGENCY_LOOP_CODE
    ),
    [loops],
  );

  const doDetect = async () => {
    setDetecting(true);
    try {
      const res = await detectLoops({ candidates_only: true, max_len: 8 });
      setCandidates(res.candidates);
      setDiagnostics(res.diagnostics);
      await loadMarked();
      if (res.count > 0) message.success(`检测到 ${res.count} 个闭环候选`);
      else message.warning(res.diagnostics.reason || "未检测到闭环");
    } catch {
      message.error("闭环检测失败");
    } finally {
      setDetecting(false);
    }
  };

  const saveCandidate = async (c: LoopDetectCandidate, idx: number) => {
    try {
      await createLoopFromCandidate({
        name: `候选回路 #${idx + 1}`,
        code: `${c.loop_type}${idx + 1}`,
        loop_type: c.loop_type,
        relation_ids: c.relation_ids,
        confidence: c.confidence,
        description: `自动检测 · ${c.relation_ids.length} 条因果链 · 负极性 ${c.negative_count}`,
      });
      message.success("已保存为候选");
      load();
    } catch {
      message.error("保存失败");
    }
  };

  const openDetail = async (id: number) => {
    try {
      setDetail(await getLoop(id));
    } catch {
      message.error("加载详情失败");
    }
  };

  const doConfirm = async (id: number) => {
    try {
      await confirmLoop(id, { confirmed_by: "业务负责人" });
      message.success("回路已确认");
      setDetail(null);
      load();
    } catch {
      message.error("确认失败");
    }
  };

  const doDelete = async (id: number) => {
    try {
      await deleteLoop(id);
      message.success("已删除");
      load();
    } catch {
      message.error("删除失败");
    }
  };

  const doCreate = async () => {
    const v = await form.validateFields();
    try {
      await createLoop({
        name: v.name,
        code: v.code || "",
        loop_type: v.loop_type,
        relation_ids: String(v.relation_ids || "").split(/[,，\s]+/).map(Number).filter(Boolean),
        confidence: v.confidence ?? 50,
        description: v.description || "",
      });
      message.success("回路已创建");
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch {
      message.error("创建失败");
    }
  };

  const renderCard = (row: FeedbackLoop, opts?: { method?: boolean }) => {
    const hasChain = (row.member_count || 0) > 0;
    return (
      <article
        key={row.id}
        className={`loops-card${opts?.method ? " is-method" : ""}${hasChain ? " has-chain" : ""}`}
        onClick={() => void openDetail(row.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") void openDetail(row.id);
        }}
        role="button"
        tabIndex={0}
      >
        <div className="loops-card-visual">
          {hasChain ? (
            <LoopThumb type={row.loop_type} count={row.member_count || 0} />
          ) : (
            <div className="loops-card-method-badge">方法索引</div>
          )}
        </div>
        <div className="loops-card-body">
          <div className="loops-card-meta">
            <Space size={4} wrap>
              <Tag color={TYPE_COLOR[row.loop_type]}>{TYPE_LABEL[row.loop_type]}</Tag>
              <Tag color={STATUS_COLOR[row.status]}>{STATUS_LABEL[row.status]}</Tag>
            </Space>
            <span className="loops-card-stat">
              {hasChain ? `链长 ${row.member_count}` : "无成员边"} · {row.confidence}
            </span>
          </div>
          {row.code ? <div className="loops-card-code">{row.code}</div> : null}
          <h3 className="loops-card-name">{row.name}</h3>
          <p className="loops-card-desc">
            {row.description || (hasChain ? "点击查看动态闭环图" : "完整动图见「方法示意」Tab")}
          </p>
          <div className="loops-card-actions" onClick={(e) => e.stopPropagation()}>
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(row.id)}>
              详情
            </Button>
            {row.status === "candidate" && (
              <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => void doConfirm(row.id)}>
                确认
              </Button>
            )}
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => void doDelete(row.id)} />
          </div>
        </div>
      </article>
    );
  };

  const showChained = filter === "all" || filter === "chained";
  const showMethod = filter === "all" || filter === "method";

  const libraryPanel = (
    <div className="loops-library">
      <div className="loops-toolbar">
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: "all", label: `全部 ${loops.filter((l) => l.status !== "archived").length}` },
            { value: "chained", label: `图谱闭环 ${chained.length}` },
            { value: "method", label: `方法索引 ${methodIndex.length}` },
          ]}
        />
        <Space wrap size={8}>
          <Button size="small" icon={<ShareAltOutlined />} onClick={() => nav("/ontology")}>去图谱</Button>
          <Button size="small" icon={<SearchOutlined />} loading={detecting} onClick={() => void doDetect()}>
            闭环检测
          </Button>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            手工创建
          </Button>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </div>

      {loading && !loops.length ? (
        <Empty description="加载中…" />
      ) : (
        <>
          {showChained && (
            <section className="loops-section">
              <div className="loops-section-head">
                <Typography.Text strong>图谱闭环</Typography.Text>
                <Typography.Text type="secondary">已挂因果边 · 详情中可播放流动示意</Typography.Text>
              </div>
              {chained.length ? (
                <div className="loops-grid">{chained.map((row) => renderCard(row))}</div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图谱闭环，可去图谱标边后检测或手工创建" />
              )}
            </section>
          )}

          {showMethod && (
            <section className="loops-section">
              <div className="loops-section-head">
                <Typography.Text strong>方法索引</Typography.Text>
                <Typography.Text type="secondary">
                  示意型条目 · 完整动图见「方法示意」
                </Typography.Text>
              </div>
              {methodIndex.length || (filter === "method" && otherEmpty.length) ? (
                <div className="loops-grid">
                  {methodIndex.map((row) => renderCard(row, { method: true }))}
                  {filter === "method" && otherEmpty.map((row) => renderCard(row, { method: true }))}
                </div>
              ) : filter === "all" && !methodIndex.length ? null : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无方法索引" />
              )}
            </section>
          )}

          {filter === "all" && otherEmpty.length > 0 && (
            <section className="loops-section">
              <div className="loops-section-head">
                <Typography.Text strong>其他</Typography.Text>
              </div>
              <div className="loops-grid">{otherEmpty.map((row) => renderCard(row, { method: true }))}</div>
            </section>
          )}
        </>
      )}

      {(candidates.length > 0 || markedRels.length > 0 || (diagnostics && !candidates.length)) && (
        <Collapse
          className="loops-tools"
          defaultActiveKey={candidates.length ? ["candidates"] : []}
          items={[
            ...(candidates.length
              ? [{
                  key: "candidates",
                  label: `检测候选 · ${candidates.length}`,
                  children: (
                    <Table
                      size="small"
                      rowKey={(_, i) => String(i)}
                      dataSource={candidates}
                      pagination={{ pageSize: 5 }}
                      columns={[
                        {
                          title: "类型",
                          dataIndex: "loop_type",
                          width: 90,
                          render: (t: string) => <Tag color={TYPE_COLOR[t]}>{TYPE_LABEL[t]}</Tag>,
                        },
                        { title: "链长", render: (_, r) => r.relation_ids.length, width: 60 },
                        { title: "置信度", dataIndex: "confidence", width: 80 },
                        {
                          title: "关系 ID",
                          dataIndex: "relation_ids",
                          render: (ids: number[]) => ids.join(" → "),
                        },
                        {
                          title: "",
                          width: 100,
                          render: (_, r, i) => (
                            <Button size="small" type="primary" onClick={() => void saveCandidate(r, i)}>
                              存为候选
                            </Button>
                          ),
                        },
                      ]}
                    />
                  ),
                }]
              : []),
            ...(markedRels.length
              ? [{
                  key: "marked",
                  label: `已标 CausalLink · ${markedRels.length}`,
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={{ pageSize: 6, hideOnSinglePage: true }}
                      dataSource={markedRels}
                      columns={[
                        { title: "ID", dataIndex: "id", width: 60 },
                        {
                          title: "因果链",
                          render: (_, r) => (
                            <span>{r.source_name} → <Tag>{r.label}</Tag> → {r.target_name}</span>
                          ),
                        },
                        { title: "极性", dataIndex: "polarity", width: 60, render: (v: string) => v || "—" },
                      ]}
                    />
                  ),
                }]
              : []),
            ...(diagnostics && !candidates.length
              ? [{
                  key: "diag",
                  label: "检测说明",
                  children: (
                    <div>
                      <Typography.Paragraph style={{ marginBottom: 8 }}>{diagnostics.reason}</Typography.Paragraph>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {diagnostics.hints.map((h) => <li key={h}>{h}</li>)}
                      </ul>
                    </div>
                  ),
                }]
              : []),
          ]}
        />
      )}
    </div>
  );

  return (
    <div className="loops-page">
      <header className="loops-hero">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>回路</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0", maxWidth: 560 }}>
            图谱因果闭环与方法示意。有链条的条目点详情可看动态环图；方法论完整动图在「方法示意」。
          </Typography.Paragraph>
        </div>
      </header>

      <Tabs
        className="loops-tabs"
        defaultActiveKey="library"
        items={[
          {
            key: "library",
            label: `回路库`,
            children: libraryPanel,
          },
          {
            key: "methods",
            label: "方法示意",
            children: (
              <Tabs
                size="small"
                type="card"
                className="loops-method-tabs"
                items={[
                  {
                    key: "agency",
                    label: "品牌代理 8 Stock",
                    children: (
                      <Card size="small" className="brand-sfd-card" bordered={false}>
                        <BrandAgencyLoops />
                      </Card>
                    ),
                  },
                  {
                    key: "brand-sf",
                    label: "品牌经营 Stock–Flow",
                    children: (
                      <Card size="small" className="brand-sfd-card" bordered={false}>
                        <BrandStockFlowLoop />
                      </Card>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal
        title={detail ? `${detail.code || detail.name}` : "回路详情"}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          <Space>
            {detail?.status === "candidate" ? (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => void doConfirm(detail.id)}>
                人工确认
              </Button>
            ) : null}
            <Button onClick={() => setDetail(null)}>关闭</Button>
          </Space>
        }
        width={780}
        destroyOnClose
        className="loops-detail-modal"
      >
        {detail && (
          <>
            {(detail.members || []).length > 0 ? (
              <LoopRingDiagram loop={detail} />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="此条为方法索引，无因果成员边。请切换到「方法示意」查看完整动态图。"
                style={{ padding: "12px 0 8px" }}
              >
                <Button type="primary" onClick={() => setDetail(null)}>
                  知道了
                </Button>
              </Empty>
            )}
            <Divider style={{ margin: "16px 0 12px" }} />
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="编号">{detail.code || "—"}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={TYPE_COLOR[detail.loop_type]}>{TYPE_LABEL[detail.loop_type]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="置信度">{detail.confidence}</Descriptions.Item>
              <Descriptions.Item label="状态" span={2}>
                <Tag color={STATUS_COLOR[detail.status]}>
                  {detail.status === "confirmed"
                    ? `已确认 · ${detail.confirmed_by || "—"}`
                    : STATUS_LABEL[detail.status]}
                </Tag>
              </Descriptions.Item>
              {detail.description ? (
                <Descriptions.Item label="描述" span={2}>{detail.description}</Descriptions.Item>
              ) : null}
            </Descriptions>
            {(detail.members || []).length > 0 && (
              <>
                <Divider style={{ margin: "12px 0" }} />
                <Typography.Text strong>因果链成员</Typography.Text>
                <Table
                  size="small"
                  style={{ marginTop: 8 }}
                  rowKey="id"
                  pagination={false}
                  dataSource={detail.members || []}
                  columns={[
                    { title: "#", dataIndex: "sequence", width: 40 },
                    {
                      title: "因果链",
                      render: (_, m) => (
                        <span>
                          {m.relation.source_name} → <Tag>{m.relation.label}</Tag> → {m.relation.target_name}
                        </span>
                      ),
                    },
                    { title: "极性", width: 50, render: (_, m) => m.relation.polarity || "—" },
                    { title: "延迟", width: 60, render: (_, m) => m.relation.delay_days ?? "—" },
                  ]}
                />
              </>
            )}
          </>
        )}
      </Modal>

      <Modal
        title="手工创建回路"
        open={createOpen}
        onOk={() => void doCreate()}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        okText="创建"
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ loop_type: "R", confidence: 50 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如: 品牌飞轮 R1" />
          </Form.Item>
          <Form.Item name="code" label="编号">
            <Input placeholder="R1 / B1" />
          </Form.Item>
          <Form.Item name="loop_type" label="类型">
            <Select options={[
              { value: "R", label: "增强回路 R" },
              { value: "B", label: "调节回路 B" },
              { value: "comp", label: "复合回路" },
            ]} />
          </Form.Item>
          <Form.Item name="relation_ids" label="关系 ID 链（逗号分隔）" rules={[{ required: true }]}>
            <Input placeholder="12,45,78,23" />
          </Form.Item>
          <Form.Item name="confidence" label="置信度">
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        .loops-page { max-width: 1120px; }
        .loops-hero { margin-bottom: 8px; }
        .loops-tabs .ant-tabs-nav { margin-bottom: 16px; }
        .loops-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 10px 12px;
          background: #f8fafc;
          border: 1px solid #eef2f7;
          border-radius: 12px;
        }
        .loops-section { margin-bottom: 22px; }
        .loops-section-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .loops-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
        }
        .loops-card {
          display: grid;
          grid-template-columns: 120px minmax(0, 1fr);
          gap: 0;
          min-height: 148px;
          border: 1px solid #e8edf5;
          border-radius: 14px;
          background: #fff;
          overflow: hidden;
          cursor: pointer;
          text-align: left;
          transition: border-color .15s, box-shadow .15s, transform .15s;
        }
        .loops-card:hover, .loops-card:focus-visible {
          border-color: #C4924A;
          box-shadow: 0 8px 22px rgba(11, 33, 68, 0.07);
          transform: translateY(-1px);
          outline: none;
        }
        .loops-card.has-chain .loops-card-visual {
          background: linear-gradient(160deg, #f7f9fc, #eef3f9);
        }
        .loops-card.is-method .loops-card-visual {
          background: #fafafa;
        }
        .loops-card-visual {
          display: flex;
          align-items: center;
          justify-content: center;
          border-right: 1px solid #f0f3f8;
        }
        .loops-thumb { width: 108px; height: 94px; }
        .loops-card-method-badge {
          font-size: 12px;
          font-weight: 600;
          color: #8b96a8;
          padding: 6px 10px;
          border: 1px dashed #d7e0ec;
          border-radius: 999px;
          background: #fff;
        }
        .loops-card-body {
          padding: 12px 14px 8px;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .loops-card-meta {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 6px;
        }
        .loops-card-stat {
          font-size: 11px;
          color: #8b96a8;
          white-space: nowrap;
        }
        .loops-card-code {
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: #8b96a8;
          margin-bottom: 2px;
        }
        .loops-card-name {
          margin: 0 0 6px;
          font-size: 14px;
          font-weight: 650;
          color: #172033;
          line-height: 1.35;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .loops-card-desc {
          margin: 0;
          flex: 1;
          font-size: 12px;
          color: #5c6b84;
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .loops-card-actions {
          display: flex;
          align-items: center;
          margin-top: 6px;
          padding-top: 4px;
          border-top: 1px solid #f0f3f8;
        }
        .loops-tools { margin-top: 8px; }
        @media (max-width: 640px) {
          .loops-card { grid-template-columns: 1fr; }
          .loops-card-visual { border-right: none; border-bottom: 1px solid #f0f3f8; padding: 8px 0; }
        }
      `}</style>
    </div>
  );
}
