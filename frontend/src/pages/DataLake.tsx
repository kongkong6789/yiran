import { useEffect, useState } from "react";
import { Card, Table, Tag, Row, Col, Statistic, Space, Typography, Button, message } from "antd";
import { DatabaseOutlined, CloudSyncOutlined } from "@ant-design/icons";
import { getTables, getMetrics, getAnomalies, syncJackyun } from "../api/client";

export default function DataLake() {
  const [tables, setTables] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [source, setSource] = useState<string>("");
  const [path, setPath] = useState<string>("");
  const [syncing, setSyncing] = useState(false);

  const reload = () => {
    getTables().then((d) => {
      setTables(d.tables || []);
      setSource(d.source || "");
      setPath(d.path || "");
    });
    getMetrics().then((d) => setMetrics(d.results || []));
    getAnomalies().then((d) => setAnomalies(d.results || []));
  };

  useEffect(() => { reload(); }, []);

  const doSync = async () => {
    setSyncing(true);
    try {
      const res = await syncJackyun();
      if (!res.ok) {
        message.error(res.error || "同步失败");
        return;
      }
      const w = res.written || {};
      message.success(
        `吉客云已写入 ${w.backend}:商品 ${w.products ?? 0} / 销售 ${w.sales ?? 0}` +
        (res.configured ? " (live)" : " (fixture)")
      );
      reload();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  // 按建模分层给表分组上色
  const layerOf = (t: string) =>
    t.startsWith("dim_") ? "维度" :
    t.startsWith("dwd_") ? "明细" :
    t.startsWith("dws_") ? "汇总" :
    t.startsWith("ads_") ? "应用" :
    t.startsWith("ont_") ? "本体镜像" :
    t === "biz_object_event" ? "动作留痕" : "其他";
  const layerColor: Record<string, string> = {
    维度: "geekblue", 明细: "cyan", 汇总: "purple", 应用: "gold",
    本体镜像: "green", 动作留痕: "magenta", 其他: "default",
  };

  return (
    <Space className="data-lake-page" direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small">
        <Space wrap>
          <DatabaseOutlined />
          <Typography.Text strong>数据源:</Typography.Text>
          <Tag color={source === "postgres" ? "green" : "orange"}>
            {source === "postgres" ? "PostgreSQL(主库)" : "DuckDB(本地降级)"}
          </Tag>
          <Typography.Text type="secondary">{path}</Typography.Text>
          <Button
            size="small"
            type="primary"
            icon={<CloudSyncOutlined />}
            loading={syncing}
            onClick={doSync}
          >
            同步吉客云
          </Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {tables.map((t) => (
          <Col key={t.table} xs={12} md={6}>
            <Card size="small">
              <Statistic title={t.table} value={t.rows} suffix="行" />
              <Tag color={layerColor[layerOf(t.table)]} style={{ marginTop: 6 }}>
                {layerOf(t.table)}
              </Tag>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="指标快照(口径与数值分离)" size="small">
        <Table
          rowKey={(r) => `${r.metric}-${r.dim}-${r.dt}`}
          size="small"
          pagination={false}
          dataSource={metrics}
          columns={[
            { title: "日期", dataIndex: "dt" },
            { title: "指标", dataIndex: "metric" },
            { title: "维度", dataIndex: "dim" },
            {
              title: "数值",
              dataIndex: "value",
              render: (v: number) => (typeof v === "number" ? +v.toFixed(4) : v),
            },
            {
              title: "环比",
              dataIndex: "mom",
              render: (v: number | null) =>
                v == null ? <Tag>—</Tag> : (
                  <Tag color={v >= 0 ? "green" : "red"}>{(v * 100).toFixed(1)}%</Tag>
                ),
            },
            {
              title: "口径",
              dataIndex: "formula",
              render: (v: string) => v ? <code style={{ fontSize: 12 }}>{v}</code> : "—",
            },
          ]}
        />
      </Card>

      <Card title="异常预警(带触发规则)" size="small">
        <Table
          rowKey={(r) => `${r.scope}-${r.metric}-${r.dt}`}
          size="small"
          pagination={false}
          dataSource={anomalies}
          columns={[
            { title: "日期", dataIndex: "dt" },
            { title: "范围", dataIndex: "scope" },
            { title: "指标", dataIndex: "metric" },
            {
              title: "级别",
              dataIndex: "level",
              render: (v: string) => (
                <Tag color={v === "critical" ? "red" : v === "warning" ? "orange" : "blue"}>
                  {v}
                </Tag>
              ),
            },
            { title: "详情", dataIndex: "detail" },
            {
              title: "规则",
              dataIndex: "rule",
              render: (v: string) => v ? <code style={{ fontSize: 12 }}>{v}</code> : "—",
            },
          ]}
        />
      </Card>
    </Space>
  );
}
