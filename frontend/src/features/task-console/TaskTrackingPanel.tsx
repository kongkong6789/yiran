import { useEffect, useMemo, useState } from "react";
import {
  BellOutlined, ClockCircleOutlined, DownloadOutlined, EyeOutlined, FileOutlined, FlagOutlined,
  PlusOutlined, ReloadOutlined, UserOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Col, Empty, Progress, Row, Skeleton, Space, Tag, Typography } from "antd";
import { api } from "../../api/client";
import ExecutionTimeline, { type ExecutionStep } from "./ExecutionTimeline";
import { openArtifactPreview } from "./openArtifactPreview";
import { getPublishedTasks, type PublishedTask, type TaskArtifact, type TaskView } from "./mockTasks";

const STATUS_META: Record<PublishedTask["status"], { text: string; color: string }> = {
  pending: { text: "待处理", color: "default" },
  running: { text: "执行中", color: "processing" },
  completed: { text: "已完成", color: "success" },
  partial: { text: "部分完成", color: "warning" },
  failed: { text: "执行失败", color: "error" },
};
const PRIORITY_LABEL = { urgent: "紧急", high: "高优先级", normal: "普通" };
const fmtTime = (value?: string | null) => value
  ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  : "未设置";

export default function TaskTrackingPanel({ view, onCreate }: { view: TaskView; onCreate?: () => void }) {
  const { message, modal } = App.useApp();
  const [tasks, setTasks] = useState<PublishedTask[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const rows = await getPublishedTasks(view);
      setTasks(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "加载任务失败");
      setTasks([]);
    } finally { if (!silent) setLoading(false); }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 2000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const selected = useMemo(() => tasks.find((task) => task.id === selectedId) || tasks[0], [selectedId, tasks]);

  if (loading) return <Card className="task-console-card"><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  if (!selected) return <Card className="task-console-card"><Empty description={view === "sent" ? "尚未发出任务" : "尚未收到任务"} /></Card>;

  const retryNotification = async () => {
    if (!selected.notificationRecordId) return;
    setRetrying(true);
    try {
      await api.post(`/wecom/notifications/${selected.notificationRecordId}/retry/`, {});
      message.success("通知已重新提交给企业微信");
      await load();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "重新发送失败");
    } finally { setRetrying(false); }
  };

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

  const downloadArtifact = async (url: string, filename: string) => {
    try {
      const response = await api.get(url, { responseType: "blob" });
      const objectUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "产物下载失败");
    }
  };

  return <Row gutter={[16, 16]} align="stretch" className="task-tracking-layout">
    <Col xs={24} lg={10} className="task-console-column">
      <Card
        className="task-console-card task-list-card"
        title={<div className="task-list-heading"><span>{view === "sent" ? "我发出的任务" : "我收到的任务"}</span><small>{tasks.length} 项任务</small></div>}
        extra={<Space size={6}><Button type="text" icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>{onCreate && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新建任务</Button>}</Space>}
      >
        <div className="task-list-subtitle">{view === "sent" ? "跟踪已分配任务的执行与通知情况" : "查看真实分配给当前账号的工作任务"}</div>
        <div className="task-record-list">{tasks.map((task) => <button type="button" className={`task-record-item${task.id === selected.id ? " is-active" : ""}`} key={task.id} onClick={() => setSelectedId(task.id)}>
          <div className="task-record-topline"><Typography.Text strong>{task.title}</Typography.Text><Tag color={STATUS_META[task.status].color}>{task.statusLabel || STATUS_META[task.status].text}</Tag></div>
          <div className="task-record-meta"><span>{task.traceId}</span><span><ClockCircleOutlined /> {fmtTime(task.deadline)}</span><span className={`task-priority-mini is-${task.priority}`}><FlagOutlined /> {PRIORITY_LABEL[task.priority]}</span></div>
          <Progress percent={task.progress} size="small" status={task.status === "failed" ? "exception" : "normal"} showInfo={false} />
          <div className="task-record-footer"><span>{view === "sent" ? `负责人：${task.assignees.join("、") || "未匹配平台账号"}` : `发起人：${task.sender}`}</span><span>更新于 {fmtTime(task.updatedAt)}</span></div>
        </button>)}</div>
      </Card>
    </Col>
    <Col xs={24} lg={14} className="task-console-column">
      <Card className="task-console-card task-detail-card" title={<div className="task-detail-heading"><div><Typography.Text type="secondary" className="task-detail-eyebrow">任务执行详情</Typography.Text><Typography.Title level={5}>{selected.title}</Typography.Title><Typography.Text type="secondary">{selected.traceId} · {selected.sopId || "未匹配 SOP"}</Typography.Text></div><Tag color={STATUS_META[selected.status].color}>{selected.statusLabel || STATUS_META[selected.status].text}</Tag></div>}>
        <div className="task-detail-summary">
          <div><UserOutlined /><span>{view === "sent" ? "负责人" : "发起人"}</span><strong>{view === "sent" ? selected.assignees.join("、") || "尚未匹配平台账号" : selected.sender}</strong></div>
          <div><ClockCircleOutlined /><span>截止时间</span><strong>{fmtTime(selected.deadline)}</strong></div>
          <div className="task-priority-summary"><FlagOutlined /><span>优先级</span><strong className={`task-priority-indicator is-${selected.priority}`}><i />{PRIORITY_LABEL[selected.priority]}</strong></div>
        </div>
        {!!selected.artifacts?.length && <section className="task-tracking-artifacts">
          <div className="task-tracking-artifacts-heading"><FileOutlined /><span><strong>任务产物</strong><small>执行生成的报告和数据文件，支持阅读视图查看</small></span></div>
          <div className="task-tracking-artifact-list">{selected.artifacts.map((artifact) => <div className="task-tracking-artifact" key={artifact.id}>
            <span><strong>{artifact.name}</strong><small>{artifact.format} · {artifact.size}</small></span>
            <Space size={6}>
              {!!artifact.preview_url && <Button size="small" icon={<EyeOutlined />} onClick={() => void previewArtifact(artifact)}>查看</Button>}
              <Button size="small" type="primary" ghost icon={<DownloadOutlined />} onClick={() => void downloadArtifact(artifact.download_url, artifact.filename)}>下载</Button>
            </Space>
          </div>)}</div>
        </section>}
        <section className="task-notification-record"><div><BellOutlined /><span><strong>企业微信通知</strong><small>接收方：{selected.notificationTarget || "未设置"}</small></span></div><Space><Tag color={selected.notificationStatus === "accepted" ? "success" : selected.notificationStatus === "failed" ? "error" : "default"}>{selected.notificationStatus === "accepted" ? "企业微信已受理" : selected.notificationStatus === "failed" ? "发送失败" : selected.notificationStatus || "待发送"}</Tag>{selected.notificationStatus === "failed" && selected.notificationRecordId && <Button size="small" loading={retrying} onClick={() => void retryNotification()}>重新发送</Button>}</Space></section>
        <div className="task-detail-progress"><span>任务进度</span><Progress percent={selected.progress} status={selected.status === "failed" ? "exception" : selected.status === "completed" ? "success" : "active"} /></div>
        <ExecutionTimeline steps={selected.timeline as ExecutionStep[]} />
      </Card>
    </Col>
  </Row>;
}
