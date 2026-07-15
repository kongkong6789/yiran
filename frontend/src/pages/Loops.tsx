import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, Select, InputNumber,
  App, Typography, Alert, Descriptions, Divider, Tabs,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, SearchOutlined, CheckOutlined,
  DeleteOutlined, ShareAltOutlined,
} from "@ant-design/icons";
import {
  listLoops, detectLoops, createLoop, createLoopFromCandidate, confirmLoop, deleteLoop, getLoop,
  listCausalCandidates,
  type FeedbackLoop, type LoopDetectCandidate, type LoopDetectDiagnostics,
} from "../api/client";
import BrandStockFlowLoop from "../components/BrandStockFlowLoop";
import BrandAgencyLoops from "../components/BrandAgencyLoops";

const TYPE_COLOR: Record<string, string> = { R: "red", B: "blue", comp: "purple" };
const TYPE_LABEL: Record<string, string> = { R: "增强 R", B: "调节 B", comp: "复合" };
const STATUS_COLOR: Record<string, string> = {
  candidate: "gold", confirmed: "green", archived: "default",
};

const BRAND_LOOP_CODE = "BRAND-SF";
const AGENCY_LOOP_CODE = "BRAND-AGENCY-8S";

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
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    return listLoops()
      .then((r) => setLoops(r.results))
      .finally(() => setLoading(false));
  }, []);

  const loadMarked = useCallback(() => {
    return listCausalCandidates().then((r) => setMarkedRels(r.results));
  }, []);

  const seededRef = useRef(false);

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
            "复合回路：R1 推广→声量→销量→利润→再推广；R2 节日/趋势/新闻放大声量；B1 销量抬升成本侵蚀利润；B2 竞品分流与抢声量。详见页内动态 Stock–Flow 图。",
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
          description:
            "8 存量：S1 代理品牌数、S2 渠道覆盖、S3 市场认知、S4 终端销售、S5 品牌方满意度、S6 团队产能、S7 运营能力、S8 资源健康。"
            + "骨架链 A 增长 / B 管理约束 / C 资源 / D 人才 / E 销资反馈；展开为 R1–R9、B1–B7、C1–C8 共 24 条回路。详见页内交互图。",
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

  const doDetect = async () => {
    setDetecting(true);
    try {
      const res = await detectLoops({ candidates_only: true, max_len: 8 });
      setCandidates(res.candidates);
      setDiagnostics(res.diagnostics);
      await loadMarked();
      if (res.count > 0) {
        message.success(`检测到 ${res.count} 个闭环候选`);
      } else {
        message.warning(res.diagnostics.reason || "未检测到闭环");
      }
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
      message.success("已保存为候选 Loop");
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
        relation_ids: v.relation_ids.split(/[,，\s]+/).map(Number).filter(Boolean),
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

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        回路
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        系统动力学视角的反馈回路：存量 Stock、流量 Flow、增强 / 调节 / 复合闭环。含品牌经营示例与品牌代理 8 Stock × 24 回路（Loops Method）。
      </Typography.Paragraph>

      <Card size="small" className="brand-sfd-card" style={{ marginBottom: 16 }}>
        <Tabs
          size="small"
          defaultActiveKey="agency"
          items={[
            {
              key: "agency",
              label: "品牌代理 8 Stock",
              children: <BrandAgencyLoops />,
            },
            {
              key: "brand-sf",
              label: "品牌经营 Stock–Flow",
              children: <BrandStockFlowLoop />,
            },
          ]}
        />
      </Card>

      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="闭环检测只在「首尾相接的有向环」上生效。知识图谱多为单向结构，需标出完整业务回路（如 A→B→C→A），或用手工创建。"
        action={
          <Button size="small" icon={<ShareAltOutlined />} onClick={() => nav("/ontology")}>
            去图谱
          </Button>
        }
      />

      {markedRels.length > 0 && (
        <Card size="small" title={`已标 CausalLink 候选 (${markedRels.length})`} style={{ marginBottom: 16 }}>
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 5, hideOnSinglePage: true }}
            dataSource={markedRels}
            columns={[
              { title: "ID", dataIndex: "id", width: 60 },
              {
                title: "因果链",
                render: (_, r) => (
                  <span>
                    {r.source_name} → <Tag>{r.label}</Tag> → {r.target_name}
                  </span>
                ),
              },
              {
                title: "极性", dataIndex: "polarity", width: 60,
                render: (v: string) => v || "—",
              },
            ]}
          />
        </Card>
      )}

      {diagnostics && diagnostics.candidate_count > 0 && candidates.length === 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={diagnostics.reason}
          description={
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {diagnostics.hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          }
        />
      )}

      <Card
        size="small"
        title="回路库"
        extra={
          <Space>
            <Button size="small" icon={<SearchOutlined />} loading={detecting} onClick={doDetect}>
              闭环检测
            </Button>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              手工创建
            </Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading} />
          </Space>
        }
      >
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={loops}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "编号", dataIndex: "code", width: 80, render: (v) => v || "—" },
            { title: "名称", dataIndex: "name" },
            {
              title: "类型", dataIndex: "loop_type", width: 90,
              render: (t: string) => <Tag color={TYPE_COLOR[t]}>{TYPE_LABEL[t] || t}</Tag>,
            },
            {
              title: "置信度", dataIndex: "confidence", width: 80,
              render: (v: number) => `${v}`,
            },
            {
              title: "状态", dataIndex: "status", width: 90,
              render: (s: string) => (
                <Tag color={STATUS_COLOR[s]}>{s === "candidate" ? "候选" : s === "confirmed" ? "已确认" : "归档"}</Tag>
              ),
            },
            { title: "链长", dataIndex: "member_count", width: 60 },
            {
              title: "操作", width: 200,
              render: (_, row) => (
                <Space size={4}>
                  <Button size="small" type="link" onClick={() => openDetail(row.id)}>详情</Button>
                  {row.status === "candidate" && (
                    <Button size="small" type="link" icon={<CheckOutlined />}
                      onClick={() => doConfirm(row.id)}>确认</Button>
                  )}
                  <Button size="small" type="link" danger icon={<DeleteOutlined />}
                    onClick={() => doDelete(row.id)} />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {candidates.length > 0 && (
        <Card size="small" title={`检测候选 (${candidates.length})`} style={{ marginTop: 16 }}>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={candidates}
            pagination={{ pageSize: 5 }}
            columns={[
              {
                title: "类型", dataIndex: "loop_type", width: 80,
                render: (t: string) => <Tag color={TYPE_COLOR[t]}>{TYPE_LABEL[t]}</Tag>,
              },
              { title: "链长", render: (_, r) => r.relation_ids.length, width: 60 },
              { title: "置信度", dataIndex: "confidence", width: 80 },
              { title: "负极性数", dataIndex: "negative_count", width: 90 },
              {
                title: "关系 ID", dataIndex: "relation_ids",
                render: (ids: number[]) => ids.join(" → "),
              },
              {
                title: "", width: 100,
                render: (_, r, i) => (
                  <Button size="small" type="primary" onClick={() => saveCandidate(r, i)}>
                    存为候选
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        title="回路详情"
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          detail?.status === "candidate" ? (
            <Button type="primary" icon={<CheckOutlined />} onClick={() => doConfirm(detail.id)}>
              人工确认
            </Button>
          ) : null
        }
        width={640}
      >
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="编号">{detail.code || "—"}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={TYPE_COLOR[detail.loop_type]}>{TYPE_LABEL[detail.loop_type]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="置信度">{detail.confidence}</Descriptions.Item>
              <Descriptions.Item label="状态" span={2}>
                <Tag color={STATUS_COLOR[detail.status]}>
                  {detail.status === "confirmed" ? `已确认 · ${detail.confirmed_by}` : detail.status}
                </Tag>
              </Descriptions.Item>
              {detail.description && (
                <Descriptions.Item label="描述" span={2}>{detail.description}</Descriptions.Item>
              )}
            </Descriptions>
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
                {
                  title: "极性", width: 50,
                  render: (_, m) => m.relation.polarity || "—",
                },
                {
                  title: "延迟", width: 60,
                  render: (_, m) => m.relation.delay_days ?? "—",
                },
              ]}
            />
          </>
        )}
      </Modal>

      <Modal
        title="手工创建回路"
        open={createOpen}
        onOk={doCreate}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        okText="创建"
      >
        <Form form={form} layout="vertical" initialValues={{ loop_type: "R", confidence: 50 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如: 品牌飞轮 R1" />
          </Form.Item>
          <Form.Item name="code" label="编号">
            <Input placeholder="R1 / B1 / C1" />
          </Form.Item>
          <Form.Item name="loop_type" label="类型">
            <Select options={[
              { value: "R", label: "增强回路 R" },
              { value: "B", label: "调节回路 B" },
              { value: "comp", label: "复合回路" },
            ]} />
          </Form.Item>
          <Form.Item
            name="relation_ids"
            label="关系 ID 链(逗号分隔,按顺序)"
            rules={[{ required: true, message: "至少 2 个关系 ID" }]}
          >
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
    </div>
  );
}
