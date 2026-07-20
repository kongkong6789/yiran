import { useEffect, useMemo, useState } from "react";
import { App, Button, Collapse, Input, Select, Space, Typography } from "antd";
import {
  CheckCircleFilled, ClockCircleOutlined, CopyOutlined, DownloadOutlined,
  ExclamationCircleFilled, EyeOutlined, FileExcelOutlined, FileOutlined,
  ReloadOutlined, SendOutlined, ToolOutlined, WarningFilled,
} from "@ant-design/icons";
import { api } from "../../api/client";
import { getWeComUsers } from "./mockWeCom";
import { openArtifactPreview } from "./openArtifactPreview";
import type { TaskBusinessResult } from "./taskBusinessResult";

interface Props { result: TaskBusinessResult; }
const STATUS_ICON = { success: <CheckCircleFilled />, partial_success: <WarningFilled />, failed: <ExclamationCircleFilled /> };
const SEVERITY_LABEL = { notice: "提醒", important: "重要", urgent: "紧急" };
const NOTIFICATION_STATUS = { pending: "等待发送", retry_waiting: "等待重试", accepted: "企业微信已受理", partial: "部分接收人失败", sent: "已发送", delivered: "已送达", failed: "发送失败" } as const;

function technicalText(result: TaskBusinessResult) {
  const details = result.technicalDetails || {};
  return [details.taskId && `任务 ID：${details.taskId}`, details.sopId && `SOP ID：${details.sopId}`, details.traceId && `Trace ID：${details.traceId}`, details.errorCode && `错误码：${details.errorCode}`, details.logs?.length && `执行日志：\n${details.logs.join("\n")}`, details.rawResult !== undefined && `原始结果：\n${JSON.stringify(details.rawResult, null, 2)}`].filter(Boolean).join("\n\n");
}

export default function TaskResultPanel({ result }: Props) {
  const { message, modal } = App.useApp();
  const displayed = result;
  const detailsText = useMemo(() => technicalText(displayed), [displayed]);
  const traceId = displayed.technicalDetails?.traceId || "";
  const [resolvedAttentionIds, setResolvedAttentionIds] = useState<string[]>([]);

  useEffect(() => {
    if (!traceId) return;
    void api.post("/task-results/", { traceId, sopId: displayed.technicalDetails?.sopId, status: displayed.status, title: displayed.title, snapshot: displayed })
      .then((response) => setResolvedAttentionIds(response.data.result.resolvedAttentionIds || []))
      .catch(() => undefined);
  }, [displayed, traceId]);

  const copyText = async (text: string, success: string) => { try { await navigator.clipboard.writeText(text); message.success(success); } catch { message.error("复制失败，请检查剪贴板权限"); } };
  const downloadBlob = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); };
  const previewArtifact = async (url: string, name: string, format?: string, filename?: string) => {
    await openArtifactPreview(modal, url, name, { format, filename, name }, (error) => message.error(error));
  };
  const downloadArtifact = async (url: string, name: string) => {
    const response = await api.get(url, { responseType: "blob" });
    downloadBlob(response.data, name);
  };

  const shareResult = async () => {
    const contacts = await getWeComUsers(); let recipients: string[] = [];
    modal.confirm({ title: "发送给其他人", content: <Select mode="multiple" style={{ width: "100%" }} placeholder="选择企业微信成员" options={contacts.map((item) => ({ label: `${item.name} · ${item.department}`, value: item.weComUserId }))} onChange={(value) => { recipients = value; }} />, okText: "发送", onOk: async () => {
      if (!recipients.length) throw new Error("请选择接收成员");
      await api.post("/wecom/notifications/", { mode: "person", recipientUserIds: recipients, task: `${displayed.title}\n${displayed.description}`, agentName: displayed.executor?.agentName, targetLabel: "其他接收人", taskTraceId: traceId, idempotencyKey: `${traceId}:share:${recipients.sort().join(",")}` });
      message.success("结果通知已被企业微信受理");
    } });
  };

  const handleAction = async (key: string) => {
    if (key === "retry-notification") {
      if (!displayed.notification?.recordId) { message.warning("没有可重试的通知记录"); return; }
      const response = await api.post(`/wecom/notifications/${displayed.notification.recordId}/retry/`, {});
      message.success(response.data.notification.status === "retry_waiting" ? "已进入自动重试队列" : "通知已被企业微信受理"); return;
    }
    if (key === "view") {
      const snapshot = traceId ? (await api.get(`/task-results/${traceId}/`)).data.result.snapshot : displayed;
      modal.info({ title: "完整任务结果", width: 760, content: <pre style={{ maxHeight: 520, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(snapshot, null, 2)}</pre> }); return;
    }
    if (key === "export") { const response = await api.get(`/task-results/${traceId}/export/`, { responseType: "blob" }); downloadBlob(response.data, `task-result-${traceId}.json`); message.success("任务结果已导出"); return; }
    if (key === "notify") { await shareResult(); return; }
    if (key === "follow") {
      let title = `跟进：${displayed.title}`; let description = displayed.attentionItems?.map((item) => item.title).join("；") || displayed.description;
      modal.confirm({ title: "创建跟进任务", content: <Space direction="vertical" style={{ width: "100%" }}><Input defaultValue={title} onChange={(e) => { title = e.target.value; }} /><Input.TextArea defaultValue={description} onChange={(e) => { description = e.target.value; }} /></Space>, onOk: async () => { await api.post(`/task-results/${traceId}/follow-ups/`, { title, description }); message.success("跟进任务已创建"); } }); return;
    }
    if (key === "handle") {
      const pending = (displayed.attentionItems || []).filter((item) => !resolvedAttentionIds.includes(item.id));
      modal.confirm({ title: "处理未完成事项", content: `确认将 ${pending.length} 项事项标记为已处理？`, onOk: async () => { for (const item of pending) await api.post(`/task-results/${traceId}/attention/${encodeURIComponent(item.id)}/resolve/`, {}); setResolvedAttentionIds((displayed.attentionItems || []).map((item) => item.id)); message.success("未完成事项已更新"); } }); return;
    }
    if (key === "retry") { window.scrollTo({ top: 0, behavior: "smooth" }); message.info("请修改左侧参数后重新执行"); }
  };

  return <section className={`task-business-result is-${displayed.status}`}>
    <div className="task-business-result-heading"><div><Typography.Title level={5}>任务结果</Typography.Title><Typography.Text type="secondary">本次任务的真实执行结果与交付内容</Typography.Text></div></div>
    <div className="task-result-status-card"><span className="task-result-status-icon">{STATUS_ICON[displayed.status]}</span><div className="task-result-status-copy"><Typography.Title level={4}>{displayed.title}</Typography.Title><Typography.Text>{displayed.description}</Typography.Text><div className="task-result-meta">{displayed.completedAt && <span><ClockCircleOutlined /> 完成时间：{displayed.completedAt}</span>}{displayed.duration && <span>执行耗时：{displayed.duration}</span>}{displayed.executor?.agentName && <span>执行智能体：{displayed.executor.agentName}</span>}{displayed.executor?.ownerName && <span>任务负责人：{displayed.executor.ownerName}</span>}</div></div></div>
    <div className="task-result-section"><Typography.Title level={5}>结果摘要</Typography.Title><div className="task-result-summary-list">{displayed.summary.map((item) => <div className={`is-${item.type || "info"}`} key={item.id}><span />{item.text}</div>)}</div></div>
    {!!displayed.metrics?.length && <div className="task-result-metrics">{displayed.metrics.slice(0, 4).map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}<small>{metric.unit}</small></strong></div>)}</div>}
    {!!displayed.deliverables?.length && <div className="task-result-section"><Typography.Title level={5}>交付内容</Typography.Title><div className="task-deliverable-list">{displayed.deliverables.map((item) => <div className="task-deliverable-item" key={item.id}><span className="task-deliverable-icon">{item.format?.toLowerCase().includes("excel") ? <FileExcelOutlined /> : <FileOutlined />}</span><div className="task-deliverable-copy"><Typography.Text strong>{item.name}</Typography.Text><span>{[item.format, item.createdAt, item.size].filter(Boolean).join(" · ")}</span></div><Space className="task-deliverable-actions" size={6} wrap><Button size="small" icon={<EyeOutlined />} disabled={!item.previewUrl} onClick={() => item.previewUrl && void previewArtifact(item.previewUrl, item.name, item.format, item.filename)}>在线查看</Button><Button size="small" type="primary" ghost icon={<DownloadOutlined />} disabled={!item.downloadUrl} onClick={() => item.downloadUrl && void downloadArtifact(item.downloadUrl, item.filename || item.name)}>下载文件</Button><Button size="small" icon={<CopyOutlined />} disabled={!item.previewUrl} onClick={async () => { if (!item.previewUrl) return; const response = await api.get(item.previewUrl, { responseType: "text" }); await copyText(typeof response.data === "string" ? response.data : JSON.stringify(response.data), "产物内容已复制"); }}>复制内容</Button><Button size="small" icon={<SendOutlined />} onClick={() => void shareResult()}>发送给其他人</Button></Space></div>)}</div></div>}
    {!!displayed.attentionItems?.length && <div className="task-result-section task-attention-section"><Typography.Title level={5}>需要关注</Typography.Title><div className="task-attention-list">{displayed.attentionItems.map((item, index) => <div className={`severity-${item.severity}`} key={item.id}><span className="task-attention-index">{index + 1}</span><div><div><Typography.Text strong delete={resolvedAttentionIds.includes(item.id)}>{item.title}</Typography.Text><span className="task-severity-text">{resolvedAttentionIds.includes(item.id) ? "已处理" : SEVERITY_LABEL[item.severity]}</span></div>{item.description && <Typography.Text type="secondary">{item.description}</Typography.Text>}{item.suggestedAction && <small>建议：{item.suggestedAction}</small>}</div></div>)}</div></div>}
    {displayed.notification && <div className={`task-notification-result is-${displayed.notification.status}`}><div><Typography.Title level={5}>通知状态</Typography.Title><span>接收人：{displayed.notification.targetName}</span><span>通知渠道：企业微信</span><span>发送状态：{NOTIFICATION_STATUS[displayed.notification.status]}</span>{displayed.notification.sentAt && <span>发送时间：{displayed.notification.sentAt}</span>}{displayed.notification.failureReason && <Typography.Text type="danger">{displayed.notification.failureReason}</Typography.Text>}</div>{["failed", "partial", "retry_waiting"].includes(displayed.notification.status) && <Button icon={<ReloadOutlined />} onClick={() => void handleAction("retry-notification")}>重新发送通知</Button>}</div>}
    <div className="task-result-next-actions"><div><Typography.Title level={5}>下一步</Typography.Title><Typography.Text type="secondary">根据本次结果继续处理</Typography.Text></div><Space wrap>{displayed.availableActions?.map((action) => <Button key={action.key} type={action.type === "primary" ? "primary" : "default"} onClick={() => void handleAction(action.key)}>{action.label}</Button>)}</Space></div>
    <Collapse className="task-technical-details" ghost defaultActiveKey={[]} items={[{ key: "technical", label: <span><ToolOutlined /> <strong>技术详情</strong><small>供技术人员排查任务执行问题</small></span>, children: <div><Space className="task-technical-actions"><Button size="small" icon={<CopyOutlined />} onClick={() => void copyText(detailsText, "技术日志已复制")}>复制日志</Button><Button size="small" icon={<DownloadOutlined />} onClick={() => downloadBlob(new Blob([detailsText], { type: "text/plain;charset=utf-8" }), `task-log-${traceId || "result"}.txt`)}>下载日志</Button></Space><pre>{detailsText || "暂无技术详情"}</pre></div> }]} />
  </section>;
}
