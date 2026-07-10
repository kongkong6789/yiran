import { useEffect, useState } from "react";
import { Card, Table, Tag, Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { getAuditLogs } from "../api/client";

const decisionColor: Record<string, string> = {
  allow: "success",
  block: "error",
  need_approval: "warning",
  dry_run: "default",
};

export default function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    getAuditLogs().then((d) => setLogs(d.results || [])).finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <Card
      title="闸机审计日志"
      size="small"
      extra={<Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>}
    >
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={logs}
        expandable={{
          expandedRowRender: (r) => (
            <pre style={{ margin: 0, fontSize: 12 }}>
              {JSON.stringify({ payload: r.payload, checks: r.checks, result: r.result }, null, 2)}
            </pre>
          ),
        }}
        columns={[
          { title: "链路", dataIndex: "trace_id" },
          { title: "角色", dataIndex: "actor" },
          { title: "动作", dataIndex: "action" },
          {
            title: "闸机结论",
            dataIndex: "decision",
            render: (v: string) => <Tag color={decisionColor[v]}>{v}</Tag>,
          },
          { title: "时间", dataIndex: "created_at", render: (v: string) => v?.slice(0, 19).replace("T", " ") },
        ]}
      />
    </Card>
  );
}
