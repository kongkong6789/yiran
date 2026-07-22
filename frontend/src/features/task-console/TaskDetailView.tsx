import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftOutlined, CheckCircleFilled, ClockCircleFilled, CloseCircleFilled,
  DownloadOutlined, EllipsisOutlined,
  EyeOutlined, FileOutlined, ReloadOutlined, SendOutlined, ShareAltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App, Avatar, Button, Collapse, Descriptions, Dropdown, Empty, Select, Skeleton,
  Space, Tabs, Typography,
} from "antd";
import { api } from "../../api/client";
import ExecutionTimeline from "./ExecutionTimeline";
import { getWeComUsers } from "./mockWeCom";
import { openArtifactPreview } from "./openArtifactPreview";
import type { PublishedTask, TaskArtifact, TaskView } from "./mockTasks";
import type { TaskBusinessResult } from "./taskBusinessResult";
import TaskStatusBadge from "./TaskStatusBadge";
import { authenticatedAvatarUrl } from "../../utils/avatar";

const fmtTime = (value?: string | null) => value
  ? new Date(value).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
  : "未设置";

const notificationLabel = (task: PublishedTask) => {
  if (task.notificationMode === "none") return "不发送通知";
  if (task.notificationMode === "group") return `企业微信群聊 · ${task.notificationTarget || "未设置"}`;
  return `企业微信个人 · ${task.notificationTarget || "未设置"}`;
};

export default function TaskDetailView({
  task,
  view,
  onBack,
  onCreate,
}: {
  task: PublishedTask;
  view: TaskView;
  onBack: () => void;
  onCreate?: () => void;
}) {
  const { message, modal } = App.useApp();
  const [snapshot, setSnapshot] = useState<TaskBusinessResult | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    setSnapshot(null);
    setSnapshotLoading(true);
    api.get(`/task-results/${task.traceId}/`)
      .then((response) => setSnapshot(response.data?.result?.snapshot || null))
      .catch(() => setSnapshot(null))
      .finally(() => setSnapshotLoading(false));
  }, [task.traceId]);

  const previewArtifact = async (artifact: TaskArtifact) => {
    if (!artifact.preview_url) return;
    await openArtifactPreview(
      modal,
      artifact.preview_url,
      artifact.name,
      { format: artifact.format, filename: artifact.filename, name: artifact.name },
      (error) => message.error(error),
    );
  };

  const downloadArtifact = async (artifact: TaskArtifact) => {
    try {
      const response = await api.get(artifact.download_url, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = artifact.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "产物下载失败");
    }
  };

  const shareResult = async () => {
    try {
      const contacts = await getWeComUsers();
      let recipients: number[] = [];
      modal.confirm({
        title: "发送任务结果到企业微信",
        centered: true,
        content: (
          <Select
            mode="multiple"
            style={{ width: "100%" }}
            placeholder="选择企业微信成员"
            options={contacts.map((item) => ({
              label: `${item.name} · ${item.department || "未设置部门"}`,
              value: item.contactId,
            }))}
            onChange={(value) => { recipients = value; }}
          />
        ),
        okText: "发送",
        onOk: async () => {
          if (!recipients.length) throw new Error("请选择接收成员");
          await api.post("/wecom/notifications/", {
            mode: "person",
            recipientContactIds: recipients,
            task: task.title,
            agentName: task.agentName,
            targetLabel: "任务结果接收人",
            taskTraceId: task.traceId,
            idempotencyKey: `${task.traceId}:share:${recipients.sort((a, b) => a - b).join(",")}`,
          });
          message.success("任务结果已提交到企业微信");
        },
      });
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "企业微信通讯录加载失败");
    }
  };

  const retryNotification = async () => {
    if (!task.notificationRecordId) {
      message.warning("当前任务没有可重试的通知记录");
      return;
    }
    await api.post(`/wecom/notifications/${task.notificationRecordId}/retry/`, {});
    message.success("通知已重新提交");
  };

  const summary = snapshot?.summary || [];
  const metrics = snapshot?.metrics || [];
  const completed = task.status === "completed" || task.status === "partial";
  const failed = task.status === "failed";
  const businessTimeline = useMemo(() => (
    (task.timeline || []).map((step) => ({
      ...step,
      title: step.title
        .replace("SOP", "任务流程")
        .replace("信息补全完成", "任务信息已确认")
        .replace("已确认通知成员", "通知对象已确认")
        .replace("数据同步处理中", "业务数据处理中"),
      detail: step.detail
        .replace(/SOP/g, "任务流程")
        .replace(/动作契约/g, "执行方式")
        .replace(/业务上下文/g, "业务数据"),
    }))
  ), [task.timeline]);

  const resultTab = (
    <div className="task-detail-result-layout">
      <div className="task-detail-result-main">
        <section className={`task-detail-outcome is-${task.status}`}>
          <span className="task-detail-outcome-icon">
            {completed
              ? <CheckCircleFilled />
              : failed ? <CloseCircleFilled /> : <ClockCircleFilled />}
          </span>
          <div className="task-detail-outcome-copy">
            <Typography.Title level={4}>
              {snapshot?.title || (completed ? "任务已完成，结果可以查看" : task.statusLabel)}
            </Typography.Title>
            <Typography.Text>{snapshot?.description || `当前进度 ${task.progress}%`}</Typography.Text>
            <div className="task-detail-outcome-meta">
              <span>{completed ? "完成" : "更新"}时间：{fmtTime(task.updatedAt)}</span>
              {snapshot?.duration && <span>用时：{snapshot.duration}</span>}
            </div>
            {!failed && <Space wrap className="task-detail-primary-actions">
              {task.artifacts.find((artifact) => artifact.preview_url) && (
                <Button
                  type="primary"
                  icon={<EyeOutlined />}
                  onClick={() => void previewArtifact(task.artifacts.find((artifact) => artifact.preview_url)!)}
                >
                  在线查看报告
                </Button>
              )}
              {task.artifacts[0] && (
                <Button icon={<DownloadOutlined />} onClick={() => void downloadArtifact(task.artifacts[0])}>
                  下载报告
                </Button>
              )}
              <Button icon={<SendOutlined />} onClick={() => void shareResult()}>发送到企业微信</Button>
            </Space>}
          </div>
          <div className="task-detail-data-overview">
            {metrics.length > 0 ? metrics.slice(0, 3).map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}<small>{metric.unit}</small></strong>
              </div>
            )) : (
              <>
                <div><span>任务进度</span><strong>{task.progress}<small>%</small></strong></div>
                <div><span>结果文件</span><strong>{task.artifacts.length}<small>份</small></strong></div>
                <div><span>协作成员</span><strong>{task.assignees.length}<small>人</small></strong></div>
              </>
            )}
          </div>
        </section>

        {snapshotLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : summary.length > 0 ? (
          <section className="task-detail-content-section">
            <Typography.Title level={5}>关键摘要</Typography.Title>
            <div className={`task-detail-summary-list${failed ? " is-failed" : ""}`}>
              {summary.map((item) => (
                <div key={item.id}>
                  {failed ? <CloseCircleFilled /> : <CheckCircleFilled />}
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="task-detail-content-section">
          <div className="task-detail-section-heading">
            <div>
              <Typography.Title level={5}>任务产物</Typography.Title>
              <Typography.Text type="secondary">报告、数据附件与结果文件</Typography.Text>
            </div>
          </div>
          {task.artifacts.length ? (
            <div className="task-detail-artifacts">
              {task.artifacts.map((artifact) => (
                <div className="task-detail-artifact" key={artifact.id}>
                  <span className="task-detail-artifact-icon"><FileOutlined /></span>
                  <div className="task-detail-artifact-copy">
                    <strong>{artifact.name}</strong>
                    <span>{artifact.format} · {artifact.size}</span>
                  </div>
                  <Space className="task-detail-artifact-actions" size={8}>
                    {artifact.preview_url && <Button size="small" onClick={() => void previewArtifact(artifact)}>查看</Button>}
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => void downloadArtifact(artifact)}>下载</Button>
                  </Space>
                </div>
              ))}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="任务完成后，结果文件会显示在这里" />}
          {snapshot?.technicalDetails && (
            <Collapse
              ghost
              className="task-detail-technical"
              items={[{
                key: "technical",
                label: "查看技术详情",
                children: <pre>{JSON.stringify(snapshot.technicalDetails, null, 2)}</pre>,
              }]}
            />
          )}
        </section>
      </div>
      <aside className="task-detail-info-sidebar">
        <Typography.Title level={5}>任务信息</Typography.Title>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label="执行智能体">{task.agentName || "系统自动匹配"}</Descriptions.Item>
          <Descriptions.Item label="任务类型">{task.sopId || "通用任务"}</Descriptions.Item>
          <Descriptions.Item label="截止时间">{fmtTime(task.deadline)}</Descriptions.Item>
          <Descriptions.Item label="优先级">{task.priorityLabel}</Descriptions.Item>
          <Descriptions.Item label="通知方式">{notificationLabel(task)}</Descriptions.Item>
        </Descriptions>
        <div className="task-detail-members">
          <span>相关成员</span>
          <div>
            {task.assigneeMembers?.length ? task.assigneeMembers.map((member) => (
              <span className="task-detail-member" key={member.id}>
                <Avatar size={26} src={authenticatedAvatarUrl(member.avatarUrl)} icon={!member.avatarUrl ? <UserOutlined /> : undefined} />
                {member.name}
              </span>
            )) : (
              <span className="task-detail-member">
                <Avatar size={26} src={authenticatedAvatarUrl(task.senderAvatar)} icon={!task.senderAvatar ? <UserOutlined /> : undefined} />
                {task.sender}
              </span>
            )}
          </div>
        </div>
      </aside>
    </div>
  );

  const configTab = (
    <section className="task-detail-tab-panel">
      <Typography.Title level={5}>任务配置</Typography.Title>
      <Descriptions bordered column={{ xs: 1, sm: 2 }} colon={false}>
        <Descriptions.Item label="任务标题">{task.title}</Descriptions.Item>
        <Descriptions.Item label="执行智能体">{task.agentName || "系统自动匹配"}</Descriptions.Item>
        <Descriptions.Item label="任务流程">{task.sopId || "通用任务"}</Descriptions.Item>
        <Descriptions.Item label="优先级">{task.priorityLabel}</Descriptions.Item>
        <Descriptions.Item label="截止时间">{fmtTime(task.deadline)}</Descriptions.Item>
        <Descriptions.Item label="负责人">{task.assignees.join("、") || "未指定"}</Descriptions.Item>
        <Descriptions.Item label="通知方式">{notificationLabel(task)}</Descriptions.Item>
        <Descriptions.Item label="通知状态">{task.notificationStatus || "未发送"}</Descriptions.Item>
      </Descriptions>
    </section>
  );

  const collaborationTab = (
    <section className="task-detail-tab-panel">
      <Typography.Title level={5}>协作记录</Typography.Title>
      <div className="task-collaboration-list">
        <div><Avatar src={authenticatedAvatarUrl(task.senderAvatar)} icon={!task.senderAvatar ? <UserOutlined /> : undefined} /><span><strong>{task.sender}</strong> 创建了任务<small>{fmtTime(task.createdAt)}</small></span></div>
        {task.assignees.length > 0 && (
          <div>
            <Avatar.Group size={32} max={{ count: 3 }}>
              {(task.assigneeMembers || []).map((member) => (
                <Avatar key={member.id} src={authenticatedAvatarUrl(member.avatarUrl)} icon={!member.avatarUrl ? <UserOutlined /> : undefined} />
              ))}
              {!task.assigneeMembers?.length && <Avatar icon={<UserOutlined />} />}
            </Avatar.Group>
            <span><strong>{task.assignees.join("、")}</strong> 被设为负责人<small>{fmtTime(task.createdAt)}</small></span>
          </div>
        )}
        {task.notificationStatus && task.notificationStatus !== "skipped" && (
          <div><Avatar icon={<SendOutlined />} /><span><strong>良策任务助手</strong> 更新了企业微信通知状态<small>{fmtTime(task.updatedAt)}</small></span></div>
        )}
      </div>
    </section>
  );

  return (
    <div className="task-detail-view">
      <button type="button" className="task-detail-back" onClick={onBack}>
        <ArrowLeftOutlined /> 返回任务中心
      </button>
      <header className="task-detail-header">
        <div>
          <div className="task-detail-title-line">
            <Typography.Title level={3}>{task.title}</Typography.Title>
            <TaskStatusBadge status={task.status} label={task.statusLabel} />
          </div>
          <div className="task-detail-header-meta">
            <span>任务 ID：{task.traceId}</span>
            <span>创建人：{task.sender}</span>
            <span>负责人：{task.assignees.join("、") || "未指定"}</span>
            <span>截止：{fmtTime(task.deadline)}</span>
          </div>
        </div>
        <Space className="task-detail-header-actions">
          <Button icon={<ReloadOutlined />} onClick={onCreate}>再次执行</Button>
          {!failed && <Button type="primary" icon={<ShareAltOutlined />} onClick={() => void shareResult()}>分享结果</Button>}
          <Dropdown menu={{ items: [
            ...(task.notificationStatus === "failed" ? [{ key: "retry", label: "重试企业微信通知" }] : []),
            { key: "download", label: "下载首个结果文件", disabled: !task.artifacts[0] },
          ], onClick: ({ key }) => {
            if (key === "retry") void retryNotification();
            if (key === "download" && task.artifacts[0]) void downloadArtifact(task.artifacts[0]);
          } }}>
            <Button icon={<EllipsisOutlined />} aria-label="更多操作" />
          </Dropdown>
        </Space>
      </header>
      <Tabs
        className="task-detail-tabs"
        defaultActiveKey="result"
        items={[
          { key: "result", label: "任务结果", children: resultTab },
          { key: "timeline", label: "执行记录", children: <section className="task-detail-tab-panel"><ExecutionTimeline steps={businessTimeline} /></section> },
          { key: "config", label: "任务配置", children: configTab },
          { key: "collaboration", label: "协作记录", children: collaborationTab },
        ]}
      />
      <span className="sr-only">当前列表视图：{view}</span>
    </div>
  );
}
