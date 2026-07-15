import { useEffect, useState } from "react";
import {
  Card, Input, Button, Select, Space, Steps, Tag, Typography,
  Descriptions, message, Alert, Form, Row, Col,
} from "antd";
import {
  getCatalog, runSop, resumeSop, syncJackyun,
  type ActionContract, type SopResult,
} from "../api/client";

const { TextArea } = Input;

const decisionTag: Record<string, { color: string; text: string }> = {
  allow: { color: "success", text: "放行执行" },
  block: { color: "error", text: "闸机拦截" },
  need_approval: { color: "warning", text: "待人工审批" },
  need_input: { color: "processing", text: "需补全信息" },
};

const stepStatus = (s: string): "finish" | "error" | "process" | "wait" => {
  if (s === "done" || s === "allow") return "finish";
  if (s === "block") return "error";
  if (s === "need_approval" || s === "need_input" || s === "warn") return "process";
  return "wait";
};

export default function AgentConsole() {
  const [text, setText] = useState("帮我生成昨天的日报");
  const [role, setRole] = useState("operator");
  const [actions, setActions] = useState<ActionContract[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [form] = Form.useForm();
  const [result, setResult] = useState<SopResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    getCatalog().then((d) => setActions(d.actions));
  }, []);

  useEffect(() => {
    const low = text.toLowerCase();
    const guess = actions.find((a) => {
      const kw = a.title + a.name;
      return low.includes("日报") && a.name === "report.generate"
        || low.includes("改价") && a.name === "price_change.apply"
        || (low.includes("采购") || low.includes("补货")) && a.name === "purchase.create"
        || (low.includes("吉客云") || low.includes("同步")) && a.name === "jackyun.sync"
        || low.includes(kw);
    });
    setFields(guess ? guess.required_fields : {});
  }, [text, actions]);

  const submit = async () => {
    setLoading(true);
    try {
      const payload = await form.validateFields().catch(() => ({}));
      const cleaned: Record<string, unknown> = {};
      Object.entries(payload || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== "") {
          const t = fields[k];
          cleaned[k] = t === "number" ? Number(v) : v;
        }
      });
      // 改价动作默认补齐前置状态,便于演示审批流
      if (text.includes("改价") || text.includes("调价")) {
        if (!cleaned.current_state) cleaned.current_state = "approved";
      }
      const res = await runSop({ text, payload: cleaned, role });
      setResult(res);
    } catch {
      message.error("执行失败,请检查后端服务");
    } finally {
      setLoading(false);
    }
  };

  const decide = async (approve: boolean) => {
    if (!result?.approval_id) return;
    setApproving(true);
    try {
      const res = await resumeSop({
        approval_id: result.approval_id,
        approve,
        approver: role === "operator" ? "manager" : role,
        comment: approve ? "控制台批准续跑" : "控制台驳回",
      });
      if (!res.ok) {
        message.error(res.error || "审批失败");
        return;
      }
      message.success(approve ? "已批准并执行" : "已驳回");
      setResult({
        ...result,
        decision: res.decision || (approve ? "allow" : "block"),
        result: res.result || {},
        steps: [
          ...result.steps,
          {
            node: approve ? "审批续跑" : "审批驳回",
            status: approve ? "done" : "block",
            detail: approve
              ? `审批单 #${res.approval_id} 已执行`
              : `审批单 #${res.approval_id} 已驳回`,
            data: res.result || {},
          },
        ],
      });
    } catch {
      message.error("审批请求失败");
    } finally {
      setApproving(false);
    }
  };

  const doSyncJackyun = async () => {
    setSyncing(true);
    try {
      const res = await syncJackyun();
      if (!res.ok) {
        message.error(res.error || "同步失败");
        return;
      }
      const w = res.written || {};
      message.success(
        `吉客云同步完成(${res.goods_mode}/${res.trades_mode}): ` +
        `商品 ${w.products ?? 0} / 销售 ${w.sales ?? 0} → ${w.backend}`
      );
    } catch (e: any) {
      message.error(e?.response?.data?.error || "吉客云同步失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Row gutter={16}>
      <Col xs={24} lg={10}>
        <Card title="发起指令" size="small">
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <TextArea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="用自然语言描述你的诉求,如:帮我给 SKU-1001 改价 / 采购补货 / 生成日报 / 同步吉客云"
            />
            <Space>
              <span>操作角色:</span>
              <Select
                value={role}
                style={{ width: 160 }}
                onChange={setRole}
                options={[
                  { value: "operator", label: "运营(额度1万)" },
                  { value: "manager", label: "主管(额度10万)" },
                  { value: "director", label: "总监(额度100万)" },
                ]}
              />
            </Space>

            {Object.keys(fields).length > 0 && (
              <Card size="small" type="inner" title="信息收集 / 表单补全">
                <Form form={form} layout="vertical">
                  {Object.entries(fields).map(([name, type]) => (
                    <Form.Item key={name} label={`${name} (${type})`} name={name}>
                      <Input placeholder={`请输入 ${name}`} />
                    </Form.Item>
                  ))}
                </Form>
              </Card>
            )}

            <Button type="primary" loading={loading} onClick={submit} block>
              运行 SOP 编排
            </Button>
            <Button loading={syncing} onClick={doSyncJackyun} block>
              同步吉客云 → DataLake
            </Button>
          </Space>
        </Card>
      </Col>

      <Col xs={24} lg={14}>
        <Card title="执行轨迹" size="small">
          {!result && <Typography.Text type="secondary">尚未执行</Typography.Text>}
          {result && (
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <Space wrap>
                <span>链路:</span>
                <Tag>{result.trace_id}</Tag>
                <Tag color={decisionTag[result.decision]?.color}>
                  {decisionTag[result.decision]?.text ?? result.decision}
                </Tag>
                {result.action && <Tag color="blue">{result.action}</Tag>}
                {result.approval_id && <Tag color="orange">审批单 #{result.approval_id}</Tag>}
              </Space>

              {result.decision === "need_input" && (
                <Alert
                  type="info"
                  showIcon
                  message={`需补全字段:${(result.missing || []).join(", ")}`}
                />
              )}

              {result.decision === "need_approval" && result.approval_id && (
                <Alert
                  type="warning"
                  showIcon
                  message="高风险动作已挂起,请审批后续跑"
                  action={
                    <Space>
                      <Button size="small" type="primary" loading={approving} onClick={() => decide(true)}>
                        批准执行
                      </Button>
                      <Button size="small" danger loading={approving} onClick={() => decide(false)}>
                        驳回
                      </Button>
                    </Space>
                  }
                />
              )}

              <Steps
                direction="vertical"
                size="small"
                items={result.steps.map((s) => ({
                  title: s.node,
                  status: stepStatus(s.status),
                  description: <span style={{ fontSize: 12 }}>{s.detail}</span>,
                }))}
              />

              {result.result && Object.keys(result.result).length > 0 && (
                <Descriptions title="执行回执" size="small" column={1} bordered>
                  {Object.entries(result.result).map(([k, v]) => (
                    <Descriptions.Item key={k} label={k}>
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              )}
            </Space>
          )}
        </Card>
      </Col>
    </Row>
  );
}
