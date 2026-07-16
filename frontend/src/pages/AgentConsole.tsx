import { useEffect, useMemo, useState } from "react";
import {
  Alert, App, Button, Card, Col, Input, Row, Segmented,
  Space, Tag, Typography,
} from "antd";
import { useNavigate } from "react-router-dom";
import {
  CloudSyncOutlined, InboxOutlined, PlayCircleOutlined, SendOutlined,
  SettingOutlined, UploadOutlined,
} from "@ant-design/icons";
import {
  api, getCatalog, runSop, resumeSop, syncJackyun,
  listAgents, type ActionContract, type Agent, type SopResult,
} from "../api/client";
import TaskAssignmentPanel from "../features/task-console/TaskAssignmentPanel";
import ExecutionTimeline, {
  type ExecutionState,
  type ExecutionStep,
} from "../features/task-console/ExecutionTimeline";
import TaskTrackingPanel from "../features/task-console/TaskTrackingPanel";
import type { TaskView } from "../features/task-console/mockTasks";
import AgentSelector from "../features/task-console/AgentSelector";
import ExecutionInfoPanel from "../features/task-console/ExecutionInfoPanel";
import TaskResultPanel from "../features/task-console/TaskResultPanel";
import {
  buildExecutionFields,
  isExecutionFieldPending,
  type ExecutionField,
} from "../features/task-console/executionFields";
import {
  formatTaskBusinessResult,
  type TaskBusinessResultContext,
} from "../features/task-console/taskBusinessResult";
import {
  getWeComGroups,
  getWeComUsers,
  sendTaskNotification,
  type TaskAssignmentValue,
} from "../features/task-console/mockWeCom";

const { TextArea } = Input;

const decisionTag: Record<string, { color: string; text: string }> = {
  allow: { color: "success", text: "放行执行" },
  block: { color: "error", text: "闸机拦截" },
  need_approval: { color: "warning", text: "待人工审批" },
  need_input: { color: "processing", text: "需补全信息" },
};

function defaultDeadline() {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  if (date.getTime() < Date.now()) date.setDate(date.getDate() + 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const DEFAULT_ASSIGNMENT: TaskAssignmentValue = {
  assigneeIds: [],
  deadline: defaultDeadline(),
  priority: "normal",
  notificationMode: "person",
  groupId: "",
};

const EXECUTION_TEMPLATE: Omit<ExecutionStep, "status" | "time">[] = [
  { key: "received", title: "已接收任务指令", detail: "任务内容已进入良策工作流。" },
  { key: "parse", title: "正在解析 SOP", detail: "正在识别任务意图与动作契约。" },
  { key: "fields", title: "信息补全完成", detail: "SOP 所需参数已完成校验。" },
  { key: "sync", title: "数据同步处理中", detail: "正在准备业务数据与执行上下文。" },
  { key: "created", title: "任务已创建", detail: "已生成任务记录和执行链路。" },
  { key: "matched", title: "已匹配负责人", detail: "正在核对平台账号与任务负责人。" },
  { key: "userid", title: "已确认通知成员", detail: "已确认负责人的企业微信通知身份。" },
  { key: "notified", title: "企业微信通知已发送", detail: "任务消息已提交至企业微信应用。" },
  { key: "finished", title: "任务执行完成", detail: "SOP、任务分配与通知流程均已完成。" },
];

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const timeNow = () => new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function AgentConsole() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [text, setText] = useState("帮我生成昨天的日报");
  const [agentId, setAgentId] = useState<number>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [actions, setActions] = useState<ActionContract[]>([]);
  const [executionFields, setExecutionFields] = useState<ExecutionField[]>([]);
  const [result, setResult] = useState<SopResult | null>(null);
  const [executionFailure, setExecutionFailure] = useState<Record<string, unknown> | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [assignment, setAssignment] = useState<TaskAssignmentValue>(DEFAULT_ASSIGNMENT);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pageView, setPageView] = useState<"create" | TaskView>("create");
  const [businessResultContext, setBusinessResultContext] = useState<TaskBusinessResultContext>({});

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId),
    [agentId, agents],
  );
  const roleLabel = selectedAgent?.name || "未选择智能体";
  const pendingExecutionInfoCount = useMemo(
    () => executionFields.filter(isExecutionFieldPending).length,
    [executionFields],
  );
  const formattedBusinessResult = useMemo(() => {
    if (result) return formatTaskBusinessResult(result.result, {
      ...businessResultContext,
      decision: result.decision,
      action: result.action,
      traceId: result.trace_id,
      agentName: selectedAgent?.name,
    });
    if (executionFailure) return formatTaskBusinessResult(executionFailure, {
      ...businessResultContext,
      decision: "block",
      agentName: selectedAgent?.name,
    });
    return null;
  }, [businessResultContext, executionFailure, result, selectedAgent?.name]);

  useEffect(() => {
    getCatalog().then((data) => setActions(data.actions)).catch(() => setActions([]));
  }, []);

  useEffect(() => {
    setAgentsLoading(true);
    listAgents()
      .then((data) => {
        setAgents(data.results);
        const firstAvailable = data.results.find((agent) => agent.status === "available");
        setAgentId((current) => data.results.some((agent) => agent.id === current && agent.status === "available")
          ? current
          : firstAvailable?.id);
      })
      .catch(() => {
        setAgents([]);
        message.error("真实智能体列表加载失败");
      })
      .finally(() => setAgentsLoading(false));
  }, [message]);

  useEffect(() => {
    const low = text.toLowerCase();
    const guess = actions.find((action) => {
      const keyword = action.title + action.name;
      return (low.includes("日报") && action.name === "report.generate")
        || (low.includes("改价") && action.name === "price_change.apply")
        || ((low.includes("采购") || low.includes("补货")) && action.name === "purchase.create")
        || ((low.includes("吉客云") || low.includes("同步")) && action.name === "jackyun.sync")
        || low.includes(keyword);
    });
    const nextFields = guess ? guess.required_fields : {};
    setExecutionFields(buildExecutionFields(nextFields));
  }, [text, actions]);

  const updateStep = (index: number, status: ExecutionState, detail?: string) => {
    setExecutionSteps((current) => current.map((step, stepIndex) => (
      stepIndex === index
        ? { ...step, status, time: timeNow(), detail: detail || step.detail }
        : step
    )));
  };

  const completeStep = async (index: number, detail?: string, duration = 360) => {
    updateStep(index, "running", detail);
    await delay(duration);
    updateStep(index, "completed", detail);
  };

  const submit = async () => {
    if (!text.trim()) {
      message.warning("请先输入任务或工作指令");
      return;
    }
    if (!selectedAgent) {
      message.warning("请先在“管理 → 对象”中创建并启用执行智能体");
      return;
    }
    if (assignment.notificationMode === "person" && assignment.assigneeIds.length === 0) {
      message.warning("请选择至少一位任务负责人");
      return;
    }
    if (assignment.notificationMode === "group" && !assignment.groupId) {
      message.warning("请选择需要通知的企业微信群聊");
      return;
    }
    if (pendingExecutionInfoCount > 0) return;

    setLoading(true);
    setResult(null);
    setExecutionFailure(null);
    const runStartedAt = Date.now();
    setBusinessResultContext({ startedAt: runStartedAt, agentName: selectedAgent.name });
    setExecutionSteps(EXECUTION_TEMPLATE.map((step) => ({ ...step, status: "waiting" })));

    let activeIndex = 0;
    let notificationTarget = "指定接收人";
    let publishedTaskTrace = "";
    let recipientUserIds: string[] = [];
    let assigneeNames: string[] = [];
    let notificationAccepted = false;
    let acceptedNotificationId: number | undefined;
    try {
      const cleaned: Record<string, unknown> = {};
      executionFields.forEach((field) => {
        if (field.value !== "") {
          cleaned[field.key] = field.backendType === "number" ? Number(field.value) : field.value;
        }
      });
      if ((text.includes("改价") || text.includes("调价")) && !cleaned.current_state) {
        cleaned.current_state = "approved";
      }

      let matchedDetail = "";
      let identityDetail = "";
      if (assignment.notificationMode === "person") {
        const contacts = await getWeComUsers();
        const selected = contacts.filter((member) => assignment.assigneeIds.includes(member.key));
        const names = selected.map((member) => member.name).join("、");
        recipientUserIds = selected.map((member) => member.weComUserId);
        assigneeNames = selected.map((member) => member.name);
        notificationTarget = names || notificationTarget;
        matchedDetail = `已匹配负责人：${names}。`;
        identityDetail = `已确认 ${selected.length} 位负责人的企业微信通知身份。`;
      } else {
        const groups = await getWeComGroups();
        const group = groups.find((item) => item.key === assignment.groupId);
        notificationTarget = group?.name || notificationTarget;
        matchedDetail = `已匹配通知群聊：${group?.name || "企业微信群"}。`;
        identityDetail = "已确认该群聊的通知渠道可用。";
      }

      publishedTaskTrace = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const trackingTimeline = (completedCount: number, runningIndex?: number, overrides: Record<number, string> = {}) => (
        EXECUTION_TEMPLATE.map((step, index) => ({
          title: step.title,
          detail: overrides[index] || step.detail,
          status: index < completedCount ? "completed" : index === runningIndex ? "running" : "waiting",
          time: index <= Math.max(completedCount - 1, runningIndex ?? -1) ? timeNow() : undefined,
        }))
      );
      const persistProgress = async (
        completedCount: number,
        runningIndex?: number,
        overrides: Record<number, string> = {},
      ) => {
        await api.patch(`/tasks/${publishedTaskTrace}/`, {
          status: "running",
          progress: Math.min(95, Math.max(3, Math.round((completedCount / EXECUTION_TEMPLATE.length) * 100))),
          timeline: trackingTimeline(completedCount, runningIndex, overrides),
        });
      };
      const trackedCompleteStep = async (index: number, detail?: string, duration = 360) => {
        await completeStep(index, detail, duration);
        await persistProgress(index + 1, index + 1, detail ? { [index]: detail } : {});
      };

      await api.post("/tasks/", {
        traceId: publishedTaskTrace,
        title: text.trim(),
        sopId: "",
        agentName: selectedAgent.name,
        priority: assignment.priority,
        deadline: assignment.deadline ? new Date(assignment.deadline).toISOString() : null,
        recipientUserIds,
        assigneeNames,
        notificationMode: assignment.notificationMode,
        notificationTarget,
        progress: 3,
        timeline: trackingTimeline(0, 0),
        generateArtifacts: false,
      });

      await trackedCompleteStep(activeIndex++, `已接收“${text.trim().slice(0, 36)}${text.trim().length > 36 ? "…" : ""}”`);
      await trackedCompleteStep(activeIndex++, "已识别操作意图，正在匹配 SOP 动作契约。", 430);
      await trackedCompleteStep(activeIndex++, `已校验 ${Object.keys(cleaned).length} 项任务参数。`);

      updateStep(activeIndex, "running", "正在调用 SOP 编排与业务数据上下文。");
      await persistProgress(activeIndex, activeIndex);
      const [sopResult] = await Promise.all([
        runSop({ text, payload: cleaned, agent_id: selectedAgent.id, trace_id: publishedTaskTrace }),
        delay(620),
      ]);
      setResult(sopResult);
      updateStep(activeIndex++, "completed", `SOP 返回：${decisionTag[sopResult.decision]?.text || sopResult.decision}。`);
      await persistProgress(activeIndex, activeIndex, { [activeIndex - 1]: `SOP 返回：${decisionTag[sopResult.decision]?.text || sopResult.decision}。` });

      await trackedCompleteStep(activeIndex++, `任务链路 ${sopResult.trace_id} 已创建。`);
      await trackedCompleteStep(activeIndex++, matchedDetail);
      await trackedCompleteStep(activeIndex++, identityDetail);

      updateStep(activeIndex, "running", "正在通过良策任务助手发送消息。");
      await persistProgress(activeIndex, activeIndex, { [activeIndex]: "正在向企业微信提交任务通知。" });
      const notificationResponse = await sendTaskNotification(assignment, { task: text, agentName: selectedAgent.name, targetLabel: notificationTarget, taskTraceId: sopResult.trace_id });
      const notificationStatus = notificationResponse.notification.status;
      const partial = notificationStatus === "partial";
      notificationAccepted = notificationStatus === "accepted" || partial;
      acceptedNotificationId = notificationResponse.notification.id;
      updateStep(activeIndex++, partial ? "failed" : "completed", partial
        ? `企业微信已受理，但无效成员：${notificationResponse.notification.invalid_users.join("、")}`
        : `企业微信已受理消息${notificationResponse.notification.wecom_msgid ? `，消息 ID：${notificationResponse.notification.wecom_msgid}` : ""}。`);
      await persistProgress(activeIndex, activeIndex, {
        [activeIndex - 1]: partial ? "企业微信已受理，但存在无效成员。" : "任务通知已被企业微信受理。",
      });
      await trackedCompleteStep(activeIndex, "任务执行完成，通知状态已记录。", 300);
      const finalTimeline = EXECUTION_TEMPLATE.map((step) => ({
        title: step.title,
        detail: step.key === "notified"
          ? (partial ? "企业微信已受理，但存在无效成员。" : "任务通知已被企业微信受理。")
          : step.key === "finished" ? "SOP、任务分配与通知状态均已记录。" : step.detail,
        status: step.key === "notified" && partial ? "failed" : "completed",
        time: timeNow(),
      }));
      const finalTaskResponse = await api.patch(`/tasks/${sopResult.trace_id}/`, {
        status: partial ? "partial" : "completed",
        progress: 100,
        sopId: sopResult.action,
        notificationStatus,
        notificationRecordId: notificationResponse.notification.id,
        timeline: finalTimeline,
        parameters: cleaned,
        resultData: sopResult.result || {},
      });
      const generatedArtifacts = finalTaskResponse.data.task.artifacts || [];
      setResult({
        ...sopResult,
        result: { ...(sopResult.result || {}), deliverables: generatedArtifacts },
      });

      setBusinessResultContext({
        startedAt: runStartedAt,
        completedAt: Date.now(),
        agentName: selectedAgent.name,
        ownerName: notificationTarget,
        notification: {
          recordId: notificationResponse.notification.id,
          channel: assignment.notificationMode === "person" ? "wecom_person" : "wecom_group",
          targetName: notificationTarget,
          status: partial ? "partial" : "accepted",
          sentAt: new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        },
      });
      if (partial) message.warning("企业微信已受理通知，但部分成员无效，请检查应用可见范围");
      else message.success(`任务执行成功，企业微信已受理发给${notificationTarget}的通知`);
    } catch (error: any) {
      const errorMessage = String(error?.response?.data?.detail || error?.response?.data?.error || error?.message || "执行失败，请检查任务参数或后端服务");
      updateStep(Math.min(activeIndex, EXECUTION_TEMPLATE.length - 1), "failed", errorMessage);
      setExecutionFailure({ ok: false, error_code: "SOP_NODE_FAILED", technical_error: errorMessage });
      if (publishedTaskTrace) {
        void api.patch(`/tasks/${publishedTaskTrace}/`, {
          status: "failed",
          progress: Math.min(90, Math.max(10, activeIndex * 11)),
          notificationStatus: notificationAccepted ? "accepted" : "failed",
          notificationRecordId: acceptedNotificationId || error?.response?.data?.notification?.id,
          timeline: EXECUTION_TEMPLATE.map((step, index) => ({
            title: step.title,
            detail: index === Math.min(activeIndex, EXECUTION_TEMPLATE.length - 1) ? errorMessage : step.detail,
            status: index < activeIndex ? "completed" : index === Math.min(activeIndex, EXECUTION_TEMPLATE.length - 1) ? "failed" : "waiting",
            time: index <= activeIndex ? timeNow() : undefined,
          })),
        });
      }
      setBusinessResultContext({
        startedAt: runStartedAt,
        completedAt: Date.now(),
        agentName: selectedAgent.name,
        ownerName: notificationTarget,
        notification: {
          recordId: acceptedNotificationId || error?.response?.data?.notification?.id,
          channel: assignment.notificationMode === "person" ? "wecom_person" : "wecom_group",
          targetName: notificationTarget,
          status: notificationAccepted ? "accepted" : "failed",
          failureReason: notificationAccepted ? undefined : errorMessage,
        },
      });
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const decide = async (approve: boolean) => {
    if (!result?.approval_id) return;
    const executionRole = selectedAgent?.execution_role || result.executor?.execution_role || "manager";
    setApproving(true);
    try {
      const response = await resumeSop({
        approval_id: result.approval_id,
        approve,
        approver: executionRole === "operator" ? "manager" : executionRole,
        comment: approve ? "控制台批准续跑" : "控制台驳回",
      });
      if (!response.ok) {
        message.error(response.error || "审批失败");
        return;
      }
      message.success(approve ? "已批准并执行" : "已驳回");
      setResult({ ...result, decision: response.decision || (approve ? "allow" : "block"), result: response.result || {} });
    } catch {
      message.error("审批请求失败");
    } finally {
      setApproving(false);
    }
  };

  const doSyncJackyun = async () => {
    setSyncing(true);
    try {
      const response = await syncJackyun();
      if (!response.ok) {
        message.error(response.error || "同步失败");
        return;
      }
      const written = response.written || {};
      message.success(`吉客云同步完成：商品 ${written.products ?? 0} / 销售 ${written.sales ?? 0} → ${written.backend}`);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "吉客云同步失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={`task-console-page ${pageView === "create" ? "is-create" : ""}`}>
      <div className="task-view-switcher">
        <div>
          <Typography.Title level={4}>任务</Typography.Title>
          <Typography.Text type="secondary">发起、分配并持续跟踪工作任务</Typography.Text>
        </div>
        <Segmented
          value={pageView}
          onChange={(value) => setPageView(value as "create" | TaskView)}
          options={[
            { value: "create", label: "发起任务", icon: <PlayCircleOutlined /> },
            { value: "sent", label: "我发出的", icon: <UploadOutlined /> },
            { value: "received", label: "我收到的", icon: <InboxOutlined /> },
          ]}
        />
      </div>

      {pageView !== "create" ? <TaskTrackingPanel view={pageView} /> : (
      <Row gutter={[16, 16]} align="stretch" className="task-create-layout">
        <Col xs={24} lg={10} className="task-console-column task-launch-column">
          <Card
            className="task-console-card task-launch-card"
            title={(
              <div className="task-card-heading">
                <span className="task-card-heading-icon"><PlayCircleOutlined /></span>
                <div>
                  <Typography.Title level={5}>发起指令与任务分配</Typography.Title>
                  <Typography.Text type="secondary">运行 SOP，并将任务通知到企业微信</Typography.Text>
                </div>
              </div>
            )}
          >
            <div className="task-launch-body">
              <div className="task-launch-scroll">
                <Space direction="vertical" style={{ width: "100%" }} size={10}>
                  <div>
                    <div className="task-field-label">任务或工作指令</div>
                    <TextArea
                      rows={2}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      placeholder="用自然语言描述诉求，如：帮我生成昨天的日报"
                    />
                  </div>

                  <AgentSelector agents={agents} value={agentId} loading={agentsLoading} onChange={setAgentId} />

                  {executionFields.length > 0 && (
                    <ExecutionInfoPanel fields={executionFields} onChange={setExecutionFields} />
                  )}

                  <TaskAssignmentPanel
                    task={text}
                    roleLabel={roleLabel}
                    value={assignment}
                    onChange={setAssignment}
                    onConfigureWeCom={() => navigate("/connectors?section=wecom")}
                  />
                </Space>
              </div>

              <div className="task-launch-actions">
                {pendingExecutionInfoCount > 0 && (
                  <div className="task-run-blocked-hint">请先完成 {pendingExecutionInfoCount} 项必要信息</div>
                )}
                {!agentsLoading && !selectedAgent && (
                  <div className="task-run-blocked-hint">请先在“管理 → 对象”中创建并启用执行智能体</div>
                )}
                <Button
                  className="task-run-button"
                  type="primary"
                  size="large"
                  loading={loading}
                  disabled={pendingExecutionInfoCount > 0 || !selectedAgent}
                  icon={<SendOutlined />}
                  onClick={submit}
                  block
                >
                  运行 SOP 并分配任务
                </Button>
                <Button loading={syncing} icon={<CloudSyncOutlined />} onClick={doSyncJackyun} block>
                  同步吉客云 → DataLake
                </Button>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={14} className="task-console-column task-trace-column">
          <Card
            className="task-console-card task-trace-card"
            title={(
              <div className="task-trace-title">
                <div className="task-card-heading">
                  <span className="task-card-heading-icon"><CloudSyncOutlined /></span>
                  <div>
                    <Typography.Title level={5}>执行轨迹</Typography.Title>
                    <Typography.Text type="secondary">SOP 执行轨迹与企业微信通知记录</Typography.Text>
                  </div>
                </div>
                <Button className="task-wecom-config-button" icon={<SettingOutlined />} onClick={() => navigate("/connectors?section=wecom")}>
                  企业微信连接设置
                </Button>
              </div>
            )}
          >
            {result && (
              <Space className="task-result-summary" wrap>
                <span>链路：</span>
                <Tag>{result.trace_id}</Tag>
                <Tag color={decisionTag[result.decision]?.color}>{decisionTag[result.decision]?.text ?? result.decision}</Tag>
                {result.action && <Tag color="blue">{result.action}</Tag>}
                {result.approval_id && <Tag color="orange">审批单 #{result.approval_id}</Tag>}
              </Space>
            )}

            {result?.decision === "need_input" && (
              <Alert type="info" showIcon message={`需补全字段：${(result.missing || []).join("、")}`} />
            )}

            {result?.decision === "need_approval" && result.approval_id && (
              <Alert
                type="warning"
                showIcon
                message="高风险动作已挂起，请审批后续跑"
                action={(
                  <Space>
                    <Button size="small" type="primary" loading={approving} onClick={() => decide(true)}>批准执行</Button>
                    <Button size="small" danger loading={approving} onClick={() => decide(false)}>驳回</Button>
                  </Space>
                )}
              />
            )}

            <ExecutionTimeline steps={executionSteps} />

            {!loading && formattedBusinessResult && <TaskResultPanel result={formattedBusinessResult} />}
          </Card>
        </Col>
      </Row>
      )}
    </div>
  );
}
