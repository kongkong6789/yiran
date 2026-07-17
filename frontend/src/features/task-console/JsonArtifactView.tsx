import { Collapse, Descriptions, Tag, Typography } from "antd";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const LABELS: Record<string, string> = {
  traceId: "任务编号",
  task: "任务名称",
  sopId: "SOP",
  priority: "优先级",
  parameters: "执行参数",
  result: "执行结果",
  ok: "执行状态",
  processed_count: "处理数量",
  decision: "决策结果",
  message: "结果说明",
  summary: "结果摘要",
  title: "标题",
  description: "说明",
  metrics: "关键指标",
  status: "状态",
};

function labelFor(key: string) {
  return LABELS[key] || key.replace(/_/g, " ");
}

function displayValue(value: JsonValue): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("zh-CN") : String(value);
  if (typeof value === "string") return value.trim() || "—";
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    if (value.every((item) => typeof item === "string" || typeof item === "number")) {
      return value.map(String).join("、");
    }
    return `${value.length} 项`;
  }
  return "查看详情";
}

function isPlainScalar(value: JsonValue) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function ScalarTable({ data }: { data: Record<string, JsonValue> }) {
  const rows = Object.entries(data).filter(([, value]) => isPlainScalar(value));
  if (!rows.length) return null;
  return (
    <Descriptions bordered size="small" column={1} className="task-artifact-descriptions">
      {rows.map(([key, value]) => (
        <Descriptions.Item key={key} label={labelFor(key)}>
          {displayValue(value)}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function NestedSection({ title, value }: { title: string; value: JsonValue }) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    if (value.every((item) => typeof item === "string")) {
      return (
        <section className="task-artifact-json-section">
          <Typography.Title level={5}>{labelFor(title)}</Typography.Title>
          <ul className="task-artifact-json-list">
            {value.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
          </ul>
        </section>
      );
    }
    return (
      <section className="task-artifact-json-section">
        <Typography.Title level={5}>{labelFor(title)}</Typography.Title>
        <div className="task-artifact-json-cards">
          {value.map((item, index) => (
            <div className="task-artifact-json-card" key={`${title}-${index}`}>
              {typeof item === "object" && item && !Array.isArray(item)
                ? <ScalarTable data={item as Record<string, JsonValue>} />
                : <Typography.Text>{displayValue(item as JsonValue)}</Typography.Text>}
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (typeof value === "object") {
    const record = value as Record<string, JsonValue>;
    const scalars = Object.fromEntries(Object.entries(record).filter(([, item]) => isPlainScalar(item)));
    const nested = Object.entries(record).filter(([, item]) => !isPlainScalar(item));
    return (
      <section className="task-artifact-json-section">
        <Typography.Title level={5}>{labelFor(title)}</Typography.Title>
        <ScalarTable data={scalars} />
        {nested.map(([key, item]) => (
          <NestedSection key={key} title={key} value={item} />
        ))}
      </section>
    );
  }
  return (
    <section className="task-artifact-json-section">
      <Typography.Title level={5}>{labelFor(title)}</Typography.Title>
      <Typography.Paragraph>{displayValue(value)}</Typography.Paragraph>
    </section>
  );
}

function TaskReportView({ data }: { data: Record<string, JsonValue> }) {
  const overview = [
    ["traceId", data.traceId],
    ["task", data.task],
    ["sopId", data.sopId],
    ["priority", data.priority],
  ].filter(([, value]) => value !== undefined);

  return (
    <div className="task-artifact-json-report">
      {!!overview.length && (
        <section className="task-artifact-json-section">
          <Typography.Title level={5}>任务概览</Typography.Title>
          <Descriptions bordered size="small" column={1} className="task-artifact-descriptions">
            {overview.map(([key, value]) => (
              <Descriptions.Item key={String(key)} label={labelFor(String(key))}>
                {displayValue(value as JsonValue)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </section>
      )}
      {"parameters" in data && <NestedSection title="parameters" value={data.parameters} />}
      {"result" in data && <NestedSection title="result" value={data.result} />}
    </div>
  );
}

export default function JsonArtifactView({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") {
    return <Typography.Paragraph>{displayValue(data as JsonValue)}</Typography.Paragraph>;
  }

  if (Array.isArray(data)) {
    return <NestedSection title="items" value={data as JsonValue[]} />;
  }

  const record = data as Record<string, JsonValue>;
  const looksLikeTaskReport = "traceId" in record || ("task" in record && ("parameters" in record || "result" in record));

  if (looksLikeTaskReport) {
    return <TaskReportView data={record} />;
  }

  const scalars = Object.fromEntries(Object.entries(record).filter(([, value]) => isPlainScalar(value)));
  const nested = Object.entries(record).filter(([, value]) => !isPlainScalar(value));

  return (
    <div className="task-artifact-json-report">
      <ScalarTable data={scalars} />
      {nested.map(([key, value]) => (
        <NestedSection key={key} title={key} value={value} />
      ))}
      {!Object.keys(record).length && <Typography.Text type="secondary">暂无数据</Typography.Text>}
    </div>
  );
}

export function JsonArtifactRawToggle({ raw }: { raw: string }) {
  return (
    <Collapse
      ghost
      className="task-artifact-raw-toggle"
      items={[{
        key: "raw",
        label: <span><Tag>原始数据</Tag> 查看 JSON 原文（供技术人员排查）</span>,
        children: <pre className="task-artifact-raw">{raw}</pre>,
      }]}
    />
  );
}
