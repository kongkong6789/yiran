import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Button, Card, Col, Empty, Input, InputNumber, Row, Space, Spin,
  Table, Tabs, Tag, Timeline, Typography, message,
} from "antd";
import {
  ApartmentOutlined, CheckCircleOutlined, ExperimentOutlined,
  FundOutlined, SafetyCertificateOutlined, ShareAltOutlined,
  ShopOutlined, TeamOutlined, ThunderboltOutlined,
} from "@ant-design/icons";

const TAB_KEYS = ["overview", "facts", "sim", "evidence", "gov", "council", "agents"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(v: string | null): v is TabKey {
  return !!v && (TAB_KEYS as readonly string[]).includes(v);
}
import {
  getCommerceAgents,
  getCommerceEvidence,
  getCommerceFactsHealth,
  getCommerceGovernance,
  getCommerceOverview,
  getCommerceSchema,
  runCommerceCouncil,
  simulateCommerceLoops,
  type CommerceSchema,
} from "../api/client";

export default function CommerceFusion() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = isTabKey(params.get("tab")) ? (params.get("tab") as TabKey) : "overview";
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getCommerceOverview>> | null>(null);
  const [schema, setSchema] = useState<CommerceSchema | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getCommerceOverview(), getCommerceSchema()])
      .then(([o, s]) => {
        setOverview(o);
        setSchema(s);
      })
      .catch(() => message.error("加载经营融合总览失败"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 48, textAlign: "center" }}><Spin tip="加载经营融合工作台…" /></div>;
  }

  return (
    <div className="commerce-fusion-page">
      <header className="cf-hero">
        <Space align="center" style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              <ShopOutlined /> 经营工作台
            </Typography.Title>
            <Typography.Paragraph type="secondary" className="cf-desc">
              分类「经营」下的能力合集。也可返回{" "}
              <a onClick={() => nav("/commerce")}>经营首页</a>
              {" "}查看全部入口；回路动力学图在{" "}
              <a onClick={() => nav("/loops/graph")}>回路图谱</a>。
            </Typography.Paragraph>
          </div>
          <Space wrap>
            <Tag color="gold">{overview?.name || "知行 → 良策"}</Tag>
            <Button size="small" onClick={() => nav("/commerce")}>经营分类首页</Button>
          </Space>
        </Space>
      </header>

      <Tabs
        activeKey={tab}
        onChange={(k) => setParams({ tab: k })}
        items={[
          { key: "overview", label: "总览", children: <OverviewPane overview={overview} schema={schema} nav={nav} /> },
          { key: "facts", label: "二期·事实层", children: <FactsPane /> },
          { key: "sim", label: "三期·回路仿真", children: <SimPane /> },
          { key: "evidence", label: "四期·证据图", children: <EvidencePane /> },
          { key: "gov", label: "四期·治理", children: <GovPane /> },
          { key: "council", label: "四期·经营评审", children: <CouncilPane /> },
          { key: "agents", label: "五期·Agent", children: <AgentsPane nav={nav} /> },
        ]}
      />

      <style>{`
        .commerce-fusion-page { width: 100%; max-width: 1180px; }
        .cf-hero { margin-bottom: 12px; }
        .cf-desc { margin: 8px 0 12px !important; max-width: 760px; }
        .cf-list { margin: 0; padding-left: 18px; line-height: 1.7; }
        .cf-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
        .cf-chain-arrow { font-size: 12px; color: #8A6A35; margin: 0 2px; }
        .cf-sim-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 8px;
          margin-top: 12px;
        }
        .cf-sim-cell {
          border: 1px solid #e6ecf4;
          border-radius: 10px;
          padding: 10px;
          background: #f8fafc;
        }
        .cf-sim-cell b { display: block; font-size: 18px; color: #0B2144; }
      `}</style>
    </div>
  );
}

function OverviewPane({
  overview,
  schema,
  nav,
}: {
  overview: Awaited<ReturnType<typeof getCommerceOverview>> | null;
  schema: CommerceSchema | null;
  nav: ReturnType<typeof useNavigate>;
}) {
  if (!overview) return <Empty />;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <Card size="small" title="融合进度">
          <Timeline
            items={overview.phases.map((p) => ({
              color: p.status === "done" ? "green" : "gray",
              dot: p.status === "done" ? <CheckCircleOutlined /> : undefined,
              children: (
                <div>
                  <Typography.Text strong>
                    {p.id}期 · {p.title}
                  </Typography.Text>
                  <ul className="cf-list">
                    {p.items.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                </div>
              ),
            }))}
          />
        </Card>
        {schema?.containment_chain ? (
          <Card size="small" title="一期包含链" style={{ marginTop: 16 }}>
            <div className="cf-chain">
              {schema.containment_chain.map((c, i) => (
                <span key={c.label}>
                  {i === 0 ? <Tag color="blue">{c.parent_label}</Tag> : null}
                  <span className="cf-chain-arrow">—{c.label}→</span>
                  <Tag color="blue">{c.child_label}</Tag>
                </span>
              ))}
            </div>
            <Space wrap style={{ marginTop: 12 }}>
              <Button icon={<ShareAltOutlined />} onClick={() => nav("/ontology")}>图谱</Button>
              <Button onClick={() => nav("/loops/graph")}>回路图谱</Button>
              <Button onClick={() => nav("/datalake")}>数据</Button>
              <Button onClick={() => nav("/connectors")}>连接</Button>
            </Space>
          </Card>
        ) : null}
      </Col>
      <Col xs={24} lg={10}>
        <Card size="small" title="样例实体">
          {(schema?.samples?.objects.length ?? 0) === 0 ? (
            <Empty description={<span>请执行 <code>python manage.py seed_commerce_ontology</code></span>} />
          ) : (
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={schema!.samples!.objects}
              columns={[
                { title: "类型", dataIndex: "otype", width: 72 },
                { title: "名称", dataIndex: "name" },
              ]}
            />
          )}
        </Card>
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="如何验收"
          description="逐个打开上方 Tab：事实层看表与连接器；仿真跑一期情景；证据图/治理/评审/Agent 目录均可点选。"
        />
      </Col>
    </Row>
  );
}

function FactsPane() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getCommerceFactsHealth>> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getCommerceFactsHealth().then(setData).finally(() => setLoading(false));
  }, []);
  if (loading) return <Spin />;
  if (!data) return <Empty />;
  const tables = [
    ...data.duckdb.tables.map((t) => ({ key: `d-${t.schema}-${t.name}`, engine: "DuckDB", name: `${t.schema || ""}.${t.name}` })),
    ...data.postgres.tables.map((t, i) => ({
      key: `p-${i}`,
      engine: "Postgres",
      name: String(
        (t as { table?: string; name?: string }).table
        || (t as { name?: string }).name
        || JSON.stringify(t),
      ),
    })),
  ];
  const statusColor = (s: string) => {
    if (s === "ok") return "green";
    if (s === "partial") return "gold";
    if (s === "empty") return "orange";
    return "red";
  };
  const statusLabel = (s: string) => {
    if (s === "ok") return "已接入";
    if (s === "partial") return "部分接入";
    if (s === "empty") return "表空无数据";
    return "数据缺失";
  };
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Alert
        type={data.status === "ok" ? "success" : data.status === "degraded" ? "warning" : "error"}
        showIcon
        message={`事实层状态：${data.status}`}
        description={data.guidance.join(" · ")}
      />
      {data.facts?.length ? (
        <Card
          size="small"
          title={`基础数据 F1–F8${data.facts_summary ? `（接入 ${data.facts_summary.ok} · 部分 ${data.facts_summary.partial} · 缺失 ${data.facts_summary.missing}）` : ""}`}
        >
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data.facts}
            columns={[
              { title: "编码", dataIndex: "code", width: 64 },
              { title: "名称", dataIndex: "name", width: 110 },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (s: string) => <Tag color={statusColor(s)}>{statusLabel(s)}</Tag>,
              },
              {
                title: "行数",
                dataIndex: "rows",
                width: 72,
                render: (v: number | null) => (v == null ? "—" : v),
              },
              {
                title: "命中表",
                dataIndex: "matched_tables",
                render: (rows: { table: string }[]) =>
                  rows?.length ? rows.map((r) => r.table).join(", ") : "—",
              },
              { title: "说明", dataIndex: "note", ellipsis: true },
            ]}
          />
        </Card>
      ) : null}
      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title="DuckDB">
            <Tag color={data.duckdb.available ? "green" : "default"}>{data.duckdb.available ? "可用" : "不可用"}</Tag>
            <div style={{ fontSize: 12, marginTop: 8, color: "#5c6b84" }}>{data.duckdb.path}</div>
            <div>表数量：{data.duckdb.table_count}</div>
            {data.duckdb.error ? <Typography.Text type="danger">{data.duckdb.error}</Typography.Text> : null}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="Postgres DataLake">
            <Tag color={data.postgres.available ? "green" : "default"}>{data.postgres.available ? "可用" : "不可用"}</Tag>
            <div>表数量：{data.postgres.table_count}</div>
            {data.postgres.error ? <Typography.Text type="danger">{data.postgres.error}</Typography.Text> : null}
          </Card>
        </Col>
      </Row>
      <Card size="small" title="连接器对齐（知行 Skill）">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data.connectors}
          columns={[
            { title: "名称", dataIndex: "name", width: 100 },
            { title: "状态", dataIndex: "status", width: 110, render: (v: string) => <Tag>{v}</Tag> },
            { title: "说明", dataIndex: "note" },
          ]}
        />
      </Card>
      <Card size="small" title={<><FundOutlined /> 表清单</>}>
        <Table
          size="small"
          rowKey="key"
          dataSource={tables}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "引擎", dataIndex: "engine", width: 100 },
            { title: "表", dataIndex: "name" },
          ]}
        />
      </Card>
    </Space>
  );
}

function SimPane() {
  const [periods, setPeriods] = useState(12);
  const [s1Boost, setS1Boost] = useState(0);
  const [loading, setLoading] = useState(false);
  const [final, setFinal] = useState<Record<string, number> | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const run = async () => {
    setLoading(true);
    try {
      const interventions: Record<string, number[]> = {};
      if (s1Boost) {
        interventions.s1 = Array.from({ length: periods }, (_, i) => (i === 0 ? s1Boost : 0));
      }
      const res = await simulateCommerceLoops({
        model_id: "company_8_stock",
        periods,
        interventions: Object.keys(interventions).length ? interventions : undefined,
      });
      setFinal(res.final);
      setLabels(res.trajectory[0]?.labels || {});
      setNote(res.uncertainty_metadata?.note || "");
      message.success(`已仿真 ${res.periods} 期 · ${res.model_name}`);
    } catch {
      message.error("仿真失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card size="small" title={<><ExperimentOutlined /> 公司层 8 Stock What-if</>}>
        <Space wrap>
          <span>周期</span>
          <InputNumber min={4} max={36} value={periods} onChange={(v) => setPeriods(Number(v) || 12)} />
          <span>第 1 期品牌数脉冲</span>
          <InputNumber min={-20} max={30} value={s1Boost} onChange={(v) => setS1Boost(Number(v) || 0)} />
          <Button type="primary" loading={loading} onClick={() => void run()}>运行仿真</Button>
        </Space>
        {note ? <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>{note}</Typography.Paragraph> : null}
      </Card>
      {final ? (
        <Card size="small" title="期末存量">
          <div className="cf-sim-grid">
            {Object.entries(final).map(([id, v]) => (
              <div key={id} className="cf-sim-cell">
                <Typography.Text type="secondary">{labels[id] || id}</Typography.Text>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Empty description="点击运行仿真查看轨迹期末值" />
      )}
    </Space>
  );
}

function EvidencePane() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getCommerceEvidence>> | null>(null);
  useEffect(() => {
    getCommerceEvidence().then(setData).catch(() => message.error("加载证据图失败"));
  }, []);
  if (!data) return <Spin />;
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Alert
        type="info"
        showIcon
        message={`节点 ${data.counts.nodes} · 边 ${data.counts.edges}`}
        description={data.warnings.join(" ") || "来自本体样例 + 回路参与投影"}
      />
      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title="节点">
            <Table
              size="small"
              rowKey="id"
              dataSource={data.nodes}
              pagination={{ pageSize: 6 }}
              columns={[
                { title: "类型", dataIndex: "type", width: 100 },
                { title: "标签", dataIndex: "label" },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="边">
            <Table
              size="small"
              rowKey="id"
              dataSource={data.edges}
              pagination={{ pageSize: 6 }}
              columns={[
                { title: "关系", dataIndex: "label", width: 100, render: (_, r) => r.label || r.type },
                { title: "从", dataIndex: "source", ellipsis: true },
                { title: "到", dataIndex: "target", ellipsis: true },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function GovPane() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getCommerceGovernance>> | null>(null);
  useEffect(() => {
    getCommerceGovernance().then(setData).catch(() => message.error("加载治理状态失败"));
  }, []);
  if (!data) return <Spin />;
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Alert
        type="warning"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message={data.policy.default}
        description={`外部写回：${data.external_writes_enabled ? "开" : "关"} · 待审批 ${data.approvals.pending_count}`}
      />
      <Card size="small" title="工具闸机">
        <Table
          size="small"
          rowKey="tool"
          pagination={false}
          dataSource={data.tool_gates}
          columns={[
            { title: "工具", dataIndex: "tool" },
            { title: "动作", dataIndex: "action", width: 80 },
            {
              title: "需审批",
              dataIndex: "requires_approval",
              width: 90,
              render: (v: boolean) => (v ? <Tag color="red">是</Tag> : <Tag color="green">否</Tag>),
            },
          ]}
        />
      </Card>
      <Card size="small" title={`审批单 · ${data.approvals.items.length}`}>
        <Table
          size="small"
          rowKey="id"
          dataSource={data.approvals.items as { id: number; action: string; status: string; intent: string }[]}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: "动作", dataIndex: "action" },
            { title: "状态", dataIndex: "status", width: 90 },
            { title: "意图", dataIndex: "intent", ellipsis: true },
          ]}
        />
      </Card>
      <Card size="small" title="MCP 配置">
        <Space wrap>
          {data.mcp.servers.length === 0 ? (
            <Typography.Text type="secondary">暂无 MCP（{data.mcp.error || "空"}）</Typography.Text>
          ) : (
            data.mcp.servers.map((s) => (
              <Tag key={s.id} color={s.enabled ? "blue" : "default"}>{s.name}</Tag>
            ))
          )}
        </Space>
      </Card>
    </Space>
  );
}

function CouncilPane() {
  const [ctx, setCtx] = useState("计划在抖音加开两家店并加大投放，同时不扩团队。");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runCommerceCouncil>> | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      setResult(await runCommerceCouncil({ decision_context: ctx, domain: "ecommerce" }));
    } catch {
      message.error("评审失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card size="small" title={<><TeamOutlined /> 经营委员会（只读复核）</>}>
        <Input.TextArea rows={3} value={ctx} onChange={(e) => setCtx(e.target.value)} />
        <Button type="primary" style={{ marginTop: 12 }} loading={loading} onClick={() => void run()}>
          发起复核
        </Button>
      </Card>
      {result ? (
        <>
          <Alert type="info" showIcon message={result.summary} description={`否决准则：${result.kill_criteria.join("；")}`} />
          <Table
            size="small"
            rowKey="member"
            pagination={false}
            dataSource={result.votes}
            columns={[
              { title: "委员", dataIndex: "member", width: 120 },
              { title: "立场", dataIndex: "stance", width: 140 },
              { title: "理由", dataIndex: "reason" },
            ]}
          />
        </>
      ) : null}
    </Space>
  );
}

function AgentsPane({ nav }: { nav: ReturnType<typeof useNavigate> }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getCommerceAgents>> | null>(null);
  useEffect(() => {
    getCommerceAgents().then(setData).catch(() => message.error("加载 Agent 目录失败"));
  }, []);
  if (!data) return <Spin />;
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Alert
        type="success"
        showIcon
        icon={<ThunderboltOutlined />}
        message={`已迁入 ${data.counts.agents} 个经营 Agent + ${data.counts.supervisors} 个主管`}
        description={data.integration.hint}
      />
      <Button type="primary" onClick={() => nav(data.integration.chat_path)}>
        打开对话并 @AI
      </Button>
      <Card size="small" title="主管">
        <Space wrap>
          {data.supervisors.map((s) => <Tag key={s.id} color="gold">{s.title}</Tag>)}
        </Space>
      </Card>
      <Card size="small" title={<><ApartmentOutlined /> Agent 目录</>}>
        <Table
          size="small"
          rowKey="id"
          dataSource={data.agents}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "角色", dataIndex: "title", width: 120 },
            { title: "团队", dataIndex: "team", width: 100 },
            { title: "说明", dataIndex: "desc" },
            { title: "ID", dataIndex: "id", ellipsis: true },
          ]}
        />
      </Card>
    </Space>
  );
}
