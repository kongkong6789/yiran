import { useEffect, useMemo, useState } from "react";
import {
  Alert, App, Button, Card, Segmented,
  Space, Typography,
} from "antd";
import {
  ArrowLeftOutlined, SaveOutlined,
} from "@ant-design/icons";
import {
  api, getCatalog, runSop, resumeSop,
  listAgents, type ActionContract, type Agent, type SopResult,
} from "../api/client";
import TaskAssignmentPanel from "../features/task-console/TaskAssignmentPanel";
import ExecutionTimeline, {
  type ExecutionStep,
} from "../features/task-console/ExecutionTimeline";
import WeComConnectionStatus from "../features/task-console/WeComConnectionStatus";
import TaskTrackingPanel from "../features/task-console/TaskTrackingPanel";
import type { TaskView } from "../features/task-console/mockTasks";
import TaskResultPanel from "../features/task-console/TaskResultPanel";
import TaskCommandSection from "../features/task-console/TaskCommandSection";
import TaskConfigSection from "../features/task-console/TaskConfigSection";
import TaskPreviewPanel from "../features/task-console/TaskPreviewPanel";
import {
  buildExecutionFields,
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
import { collectSubmitBlockers } from "../features/task-console/taskSubmitValidation";
import { getTaskTemplate } from "../features/task-console/taskTemplates";
import { createTaskTraceId } from "../utils/traceId";

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
const sopFailureDetail = (result: SopResult) => {
  const raw = result.result || {};
  const explicit = raw.user_message || raw.failure_reason || raw.error || raw.detail;
  if (explicit) return String(explicit);
  const failedStep = [...(result.steps || [])].reverse().find((step) => (
    ["block", "failed", "error", "warn"].includes(step.status)
  ));
  return failedStep?.detail || "未能识别可执行的 SOP，请补充更明确的任务目标。";
};

export default function AgentConsole({
  view = "create",
  templateKey,
  onViewChange,
  onDetailChange,
}: {
  view?: "create" | TaskView;
  templateKey?: string | null;
  onViewChange?: (view: "create" | TaskView) => void;
  onDetailChange?: (open: boolean) => void;
}) {
  const { message } = App.useApp();
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
  const [rightPanelTab, setRightPanelTab] = useState<"result" | "process">("process");
  const [businessResultContext, setBusinessResultContext] = useState<TaskBusinessResultContext>({});

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId),
    [agentId, agents],
  );
  const roleLabel = selectedAgent?.name || "未选择智能体";
  const submitBlockers = useMemo(
    () => collectSubmitBlockers({ text, selectedAgent, executionFields, assignment }),
    [assignment, executionFields, selectedAgent, text],
  );
  const commandRecognized = useMemo(
    () => Boolean(text.trim() && executionFields.length > 0),
    [executionFields.length, text],
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
    if (formattedBusinessResult && !loading) {
      setRightPanelTab("result");
    }
  }, [formattedBusinessResult, loading]);

  useEffect(() => {
    if (view !== "create") return;
    const template = getTaskTemplate(templateKey);
    if (template) setText(template.prompt);
  }, [view, templateKey]);

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

  const updateStep = (index: number, status: ExecutionStep["status"], detail?: string) => {
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
    if (submitBlockers.length > 0) return;

    setLoading(true);
    setResult(null);
    setExecutionFailure(null);
    setRightPanelTab("process");
    const runStartedAt = Date.now();
    setBusinessResultContext({ startedAt: runStartedAt, agentName: selectedAgent!.name });

    setExecutionSteps(EXECUTION_TEMPLATE.map((step) => ({ ...step, status: "waiting" })));

    let activeIndex = 0;
    let notificationTarget = "指定接收人";
    let publishedTaskTrace = "";
    let recipientContactIds: number[] = [];
    let assigneeWeComContactIds: number[] = [];
    let assigneeNames: string[] = [];
    let notificationAccepted = false;
    let acceptedNotificationId: number | undefined;
    let partial = false;
    let notificationStatus: string | undefined;
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
      const selectedAssignees = assignment.assigneeIds.length > 0
        ? (await getWeComUsers()).filter((member) => assignment.assigneeIds.includes(member.key))
        : [];
      assigneeWeComContactIds = selectedAssignees.map((member) => member.contactId);
      assigneeNames = selectedAssignees.map((member) => member.name);

      if (assignment.notificationMode === "person") {
        const names = assigneeNames.join("、");
        recipientContactIds = assigneeWeComContactIds;
        notificationTarget = names || notificationTarget;
        matchedDetail = `已匹配负责人：${names || "未指定"}。`;
        identityDetail = `已确认 ${selectedAssignees.length} 位负责人的企业微信通知身份。`;
      } else if (assignment.notificationMode === "group") {
        const groups = await getWeComGroups();
        const group = groups.find((item) => item.key === assignment.groupId);
        notificationTarget = group?.name || notificationTarget;
        matchedDetail = `已匹配通知群聊：${group?.name || "企业微信群"}。`;
        identityDetail = "已确认该群聊的通知渠道可用。";
      } else {
        if (assigneeNames.length > 0) {
          matchedDetail = `已指定负责人：${assigneeNames.join("、")}（不发送企微通知）。`;
        } else {
          matchedDetail = "已选择暂不发送企业微信通知。";
        }
        identityDetail = "通知步骤已跳过。";
      }

      publishedTaskTrace = createTaskTraceId();
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
        agentName: selectedAgent?.name,
        priority: assignment.priority,
        deadline: assignment.deadline ? new Date(assignment.deadline).toISOString() : null,
        assigneeWeComContactIds,
        recipientContactIds,
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
        runSop({ text, payload: cleaned, agent_id: selectedAgent!.id, trace_id: publishedTaskTrace }),
        delay(620),
      ]);

      const executionRejected = sopResult.decision === "block" || (
        sopResult.decision === "allow" && sopResult.result?.ok === false
      );
      if (executionRejected) {
        const failureDetail = sopFailureDetail(sopResult);
        const errorCode = sopResult.action ? "SOP_EXECUTION_FAILED" : "SOP_NOT_MATCHED";
        const failedResult: SopResult = {
          ...sopResult,
          result: {
            ...(sopResult.result || {}),
            ok: false,
            error_code: errorCode,
            user_message: failureDetail,
          },
        };
        const failedTimeline = EXECUTION_TEMPLATE.map((step, index) => ({
          title: step.title,
          detail: index === 1 ? failureDetail : step.detail,
          status: index === 0 ? "completed" as const : index === 1 ? "failed" as const : "waiting" as const,
          time: index <= 1 ? timeNow() : undefined,
        }));
        setResult(failedResult);
        setExecutionSteps(EXECUTION_TEMPLATE.map((step, index) => ({
          ...step,
          detail: index === 1 ? failureDetail : step.detail,
          status: index === 0 ? "completed" : index === 1 ? "failed" : "waiting",
          time: index <= 1 ? timeNow() : undefined,
        })));
        await api.patch(`/tasks/${sopResult.trace_id}/`, {
          status: "failed",
          progress: 22,
          sopId: sopResult.action,
          notificationStatus: "skipped",
          timeline: failedTimeline,
        });
        setBusinessResultContext({
          startedAt: runStartedAt,
          completedAt: Date.now(),
          agentName: selectedAgent!.name,
          ownerName: assigneeNames.join("、") || undefined,
        });
        message.error(failureDetail);
        return;
      }

      setResult(sopResult);
      updateStep(activeIndex++, "completed", `SOP 返回：${decisionTag[sopResult.decision]?.text || sopResult.decision}。`);
      await persistProgress(activeIndex, activeIndex, { [activeIndex - 1]: `SOP 返回：${decisionTag[sopResult.decision]?.text || sopResult.decision}。` });

      await trackedCompleteStep(activeIndex++, `任务链路 ${sopResult.trace_id} 已创建。`);
      await trackedCompleteStep(activeIndex++, matchedDetail);
      if (assignment.notificationMode === "none") {
        updateStep(activeIndex++, "skipped", identityDetail);
        await persistProgress(activeIndex, activeIndex, { [activeIndex - 1]: identityDetail });
        updateStep(activeIndex++, "skipped", "已跳过企业微信通知。");
        await persistProgress(activeIndex, activeIndex, { [activeIndex - 1]: "已跳过企业微信通知。" });
      } else {
        await trackedCompleteStep(activeIndex++, identityDetail);
        updateStep(activeIndex, "running", "正在通过良策任务助手发送消息。");
        await persistProgress(activeIndex, activeIndex, { [activeIndex]: "正在向企业微信提交任务通知。" });
        const notificationResponse = await sendTaskNotification(assignment, { task: text, agentName: selectedAgent!.name, targetLabel: notificationTarget, taskTraceId: sopResult.trace_id });
        notificationStatus = notificationResponse.notification.status;
        partial = notificationStatus === "partial";
        notificationAccepted = notificationStatus === "accepted" || partial || notificationStatus === "retry_waiting";
        acceptedNotificationId = notificationResponse.notification.id;
        updateStep(activeIndex++, partial ? "failed" : "completed", partial
          ? `企业微信已受理，但无效成员：${notificationResponse.notification.invalid_users.join("、")}`
          : `企业微信已受理消息${notificationResponse.notification.wecom_msgid ? `，消息 ID：${notificationResponse.notification.wecom_msgid}` : ""}。`);
        await persistProgress(activeIndex, activeIndex, {
          [activeIndex - 1]: partial ? "企业微信已受理，但存在无效成员。" : "任务通知已被企业微信受理。",
        });
      }
      await trackedCompleteStep(activeIndex, "任务执行完成，通知状态已记录。", 300);
      const finalTimeline = EXECUTION_TEMPLATE.map((step) => ({
        title: step.title,
        detail: step.key === "notified"
          ? (assignment.notificationMode === "none"
            ? "已跳过企业微信通知。"
            : partial ? "企业微信已受理，但存在无效成员。" : "任务通知已被企业微信受理。")
          : step.key === "finished" ? "SOP、任务分配与通知状态均已记录。" : step.detail,
        status: (step.key === "notified" && assignment.notificationMode === "none")
          ? "skipped"
          : (step.key === "notified" && partial ? "failed" : "completed"),
        time: timeNow(),
      }));
      const finalTaskResponse = await api.patch(`/tasks/${sopResult.trace_id}/`, {
        status: assignment.notificationMode === "none" ? "completed" : (partial ? "partial" : "completed"),
        progress: 100,
        sopId: sopResult.action,
        notificationStatus: assignment.notificationMode === "none" ? "skipped" : notificationStatus,
        notificationRecordId: assignment.notificationMode === "none" ? undefined : acceptedNotificationId,
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
        agentName: selectedAgent!.name,
        ownerName: notificationTarget,
        notification: assignment.notificationMode === "none" ? undefined : {
          recordId: acceptedNotificationId,
          channel: assignment.notificationMode === "person" ? "wecom_person" : "wecom_group",
          targetName: notificationTarget,
          status: partial ? "partial" : (notificationStatus === "retry_waiting" ? "retry_waiting" : "accepted"),
          sentAt: new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        },
      });
      if (assignment.notificationMode === "none") {
        message.success("任务执行成功");
      } else if (partial) {
        message.warning("企业微信已受理通知，但部分成员无效，请检查应用可见范围");
      } else {
        message.success(`任务执行成功，企业微信已受理发给${notificationTarget}的通知`);
      }
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
        agentName: selectedAgent?.name,
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

  const saveDraft = () => {
    window.localStorage.setItem("liangce-task-draft", JSON.stringify({
      text,
      agentId,
      executionFields,
      assignment,
      savedAt: new Date().toISOString(),
    }));
    message.success("草稿已保存在当前浏览器");
  };

  return (
    <div className={`task-console-page ${view === "create" ? "is-create" : ""}`}>
      {view !== "create" ? (
        <TaskTrackingPanel
          view={view}
          onCreate={() => onViewChange?.("create")}
          onDetailChange={onDetailChange}
        />
      ) : (
      <>
        <div className="task-create-page-heading">
          <button type="button" onClick={() => onViewChange?.("all")}><ArrowLeftOutlined /> 返回任务中心</button>
          <div className="task-create-page-title">
            <div>
              <Typography.Title level={3}>新建任务</Typography.Title>
              <Typography.Text type="secondary">告诉 AI 你想做什么，剩下的交给我们</Typography.Text>
            </div>
            <Space>
              <Button icon={<SaveOutlined />} onClick={saveDraft}>保存草稿</Button>
              <Button type="primary" onClick={() => void submit()} loading={loading} disabled={submitBlockers.length > 0}>立即发起</Button>
            </Space>
          </div>
        </div>
        <div className="task-create-layout">
          <main className="task-create-editor">
            <TaskCommandSection value={text} onChange={setText} recognized={commandRecognized} />
            <TaskConfigSection
              agents={agents}
              agentId={agentId}
              loading={agentsLoading}
              fields={executionFields}
              onAgentChange={setAgentId}
              onFieldsChange={setExecutionFields}
            />
            <TaskAssignmentPanel
              task={text}
              agentName={roleLabel}
              value={assignment}
              onChange={setAssignment}
            />
          </main>

          <div className="task-create-side">
            {executionSteps.length === 0 && !formattedBusinessResult && !loading ? (
              <TaskPreviewPanel
                text={text}
                agent={selectedAgent}
                fields={executionFields}
                assignment={assignment}
                blockers={submitBlockers}
                loading={loading}
                onSubmit={() => void submit()}
              />
            ) : (
          <Card className="task-console-card task-trace-card" title={(
            <div className="task-trace-title">
              <div className="task-card-heading">
                <div>
                  <Typography.Title level={5}>{formattedBusinessResult && !loading ? "任务结果" : "执行进度"}</Typography.Title>
                  <Typography.Text type="secondary">{formattedBusinessResult && !loading ? "查看交付内容与关键结论" : "实时查看任务执行进度"}</Typography.Text>
                </div>
              </div>
              <WeComConnectionStatus />
            </div>
          )}>
            {formattedBusinessResult && !loading && (
              <div className="task-right-tabs">
                <Segmented
                  value={rightPanelTab}
                  onChange={(value) => setRightPanelTab(value as "result" | "process")}
                  options={[
                    { label: "任务结果", value: "result" },
                    { label: "执行过程", value: "process" },
                  ]}
                />
              </div>
            )}

            {result?.decision === "need_input" && (
              <Alert type="info" showIcon message={`需补全字段：${(result.missing || []).join("、")}`} className="task-trace-alert" />
            )}

            {result?.decision === "need_approval" && result.approval_id && (
              <Alert
                type="warning"
                showIcon
                className="task-trace-alert"
                message="高风险动作已挂起，请审批后续跑"
                action={(
                  <Space>
                    <Button size="small" type="primary" loading={approving} onClick={() => decide(true)}>批准执行</Button>
                    <Button size="small" danger loading={approving} onClick={() => decide(false)}>驳回</Button>
                  </Space>
                )}
              />
            )}

            {rightPanelTab === "result" && formattedBusinessResult && !loading ? (
              <TaskResultPanel result={formattedBusinessResult} />
            ) : executionSteps.length > 0 || loading ? (
              <ExecutionTimeline steps={executionSteps} />
            ) : (
              null
            )}
          </Card>
            )}
          </div>
        </div>
      </>
      )}
    </div>
  );
}
