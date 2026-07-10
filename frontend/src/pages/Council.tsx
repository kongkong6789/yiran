import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card, Row, Col, Input, Button, Space, Select, Tag, Empty, message,
  Typography, Modal, Segmented, Avatar, Tooltip, Table, Alert, Spin,
} from "antd";
import {
  SendOutlined, StopOutlined, PlayCircleOutlined, PauseCircleOutlined,
  FileTextOutlined, DownloadOutlined, ShareAltOutlined, HistoryOutlined,
  ArrowLeftOutlined, ReloadOutlined, FileExcelOutlined, Html5Outlined,
  EyeOutlined,
} from "@ant-design/icons";
import RoundTable from "../components/RoundTable";
import {
  listAgents, listMeetings, createMeeting, getMeeting, tickMeeting, interject,
  stopMeeting, previewGraphRefs, downloadDeliverable,
  type Agent, type CouncilMessage, type Meeting, type Deliverable, type GraphRef,
} from "../api/client";

const KIND_META: Record<Deliverable["kind"], { label: string; color: string; icon: ReactNode }> = {
  md: { label: "Markdown 方案", color: "purple", icon: <FileTextOutlined /> },
  html: { label: "HTML 分析报告", color: "geekblue", icon: <Html5Outlined /> },
  xlsx: { label: "Excel 指标表", color: "green", icon: <FileExcelOutlined /> },
};

const TICK_MS = 1500;

/** 与当前 AGE 图谱内容匹配较好的示例问题 */
const GRAPH_EXAMPLES = [
  "如何优化 UniGateway 的 P99 Latency?",
  "Hybrid Search 检索接口如何设计鉴权?",
  "GraphCore 实体抽取如何影响检索性能?",
];

export default function Council() {
  const [phase, setPhase] = useState<"setup" | "meeting">("setup");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [history, setHistory] = useState<Meeting[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [question, setQuestion] = useState(GRAPH_EXAMPLES[0]);
  const [selected, setSelected] = useState<number[]>([]);
  const [previewRefs, setPreviewRefs] = useState<GraphRef[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [, setDeliverable] = useState<Deliverable | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [graphRefs, setGraphRefs] = useState<GraphRef[]>([]);
  const nav = useNavigate();
  const [running, setRunning] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [previewItem, setPreviewItem] = useState<Deliverable | null>(null);

  const busy = useRef(false);
  const timer = useRef<number | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const meetingRef = useRef<Meeting | null>(null);
  const previewTimer = useRef<number | null>(null);
  meetingRef.current = meeting;

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    listMeetings()
      .then((d) => setHistory(d.results))
      .catch(() => message.error("加载会议历史失败"))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    listAgents().then((d) => setAgents(d.results)).catch(() => {});
    loadHistory();
  }, [loadHistory]);

  // 发起前预览:问题将引用哪些图谱实体
  useEffect(() => {
    if (phase !== "setup") return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    const q = question.trim();
    if (!q) {
      setPreviewRefs([]);
      return;
    }
    previewTimer.current = window.setTimeout(() => {
      setPreviewLoading(true);
      previewGraphRefs(q)
        .then((r) => setPreviewRefs(r.refs || []))
        .catch(() => setPreviewRefs([]))
        .finally(() => setPreviewLoading(false));
    }, 500);
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [question, phase]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const appendMsg = (m: CouncilMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    if (m.speaker_type === "agent" && m.agent_id) setActiveAgentId(m.agent_id);
  };

  const openMeeting = async (id: number, resume = false) => {
    try {
      const detail = await getMeeting(id);
      setMeeting(detail.meeting);
      setMessages(detail.messages);
      setDeliverable(detail.deliverable);
      setDeliverables(detail.deliverables || []);
      setGraphRefs(detail.graph_refs || []);
      setPhase("meeting");
      setRunning(resume && detail.meeting.status === "active");
    } catch {
      message.error("加载会议失败");
    }
  };

  const doTick = async () => {
    const mt = meetingRef.current;
    if (!mt || busy.current || mt.status === "stopped") return;
    busy.current = true;
    try {
      const res = await tickMeeting(mt.id);
      if (res.stopped) {
        setRunning(false);
      } else if (res.messages?.length) {
        res.messages.forEach(appendMsg);
      }
    } catch (e: any) {
      setRunning(false);
      message.error(e?.response?.data?.error || "推进会议失败");
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (running) {
      timer.current = window.setInterval(doTick, TICK_MS);
      doTick();
    }
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = async () => {
    if (!question.trim()) return message.warning("请输入你的核心问题");
    if (selected.length < 2) return message.warning("至少拉 2 个对象进会议");
    setStarting(true);
    try {
      const m = await createMeeting({ question, agent_ids: selected });
      await openMeeting(m.id, true);
      loadHistory();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "创建会议失败");
    } finally {
      setStarting(false);
    }
  };

  const sendInterject = async () => {
    if (!meeting || !draft.trim()) return;
    try {
      const m = await interject(meeting.id, draft.trim());
      appendMsg(m);
      setDraft("");
      message.success("已插话,后续发言会围绕你的补充");
    } catch {
      message.error("插话失败");
    }
  };

  const finish = async () => {
    if (!meeting || finishing) return;
    setRunning(false);
    setFinishing(true);
    message.loading({ content: "正在生成 Markdown / HTML 报告 / Excel 指标表…", key: "stop", duration: 0 });
    try {
      const res = await stopMeeting(meeting.id);
      setDeliverable(res.deliverable);
      setDeliverables(res.deliverables || []);
      setMeeting({ ...meeting, status: "stopped" });
      if (res.deliverables?.length) setPreviewItem(res.deliverables[0]);
      loadHistory();
      const g = res.graph;
      if (g && !g.error && !g.already_stopped) {
        message.success({
          key: "stop",
          content: `已生成 3 份产物并回写图谱(引用 ${g.referenced_entities ?? 0} 实体)`,
        });
      } else if (g?.already_stopped) {
        message.info({ key: "stop", content: "会议已结束,已打开已有方案" });
      } else {
        message.success({ key: "stop", content: "会议结束,已生成方案" });
      }
    } catch (e: any) {
      message.error({
        key: "stop",
        content: e?.response?.data?.error || e?.message || "结束会议失败,请稍后重试",
      });
    } finally {
      setFinishing(false);
    }
  };

  const backToSetup = () => {
    setRunning(false);
    setPhase("setup");
    setMeeting(null);
    setMessages([]);
    setDeliverable(null);
    setDeliverables([]);
    setGraphRefs([]);
    setPreviewItem(null);
    loadHistory();
  };

  const downloadFile = async (item: Deliverable) => {
    if (!meeting) return;
    try {
      const blob = await downloadDeliverable(meeting.id, item.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename || `deliverable.${item.kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error("下载失败");
    }
  };

  const deliverablesCard = () => (
    <Card size="small" style={{ marginTop: 12 }} title="会议产物">
      {deliverables.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          会议结束后将自动生成:Markdown 方案、HTML 图表分析报告、Excel 指标表
        </Typography.Text>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          {deliverables.map((item) => {
            const meta = KIND_META[item.kind] || KIND_META.md;
            return (
              <div
                key={item.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 10px", background: "rgba(8,10,20,0.5)", borderRadius: 8,
                  border: "1px solid #2a2e42",
                }}
              >
                <Space>
                  <Tag color={meta.color} icon={meta.icon}>{meta.label}</Tag>
                  <span style={{ fontSize: 13 }}>{item.title}</span>
                  <Tag>v{item.version}</Tag>
                </Space>
                <Space>
                  {item.kind !== "xlsx" && item.content && (
                    <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewItem(item)}>
                      预览
                    </Button>
                  )}
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadFile(item)}>
                    下载
                  </Button>
                </Space>
              </div>
            );
          })}
        </Space>
      )}
    </Card>
  );

  const graphCard = (refs: GraphRef[], emptyHint?: string) => (
    <Card
      size="small"
      style={{ marginTop: 12 }}
      title={<><ShareAltOutlined /> 会议引用的图谱实体</>}
    >
      {refs.length > 0 ? (
        <>
          <Space wrap size={[6, 8]}>
            {refs.map((r) => (
              <Tooltip key={r.id} title={r.description || r.name}>
                <Tag
                  color="geekblue"
                  style={{ cursor: "pointer", marginInlineEnd: 0 }}
                  onClick={() => nav(`/ontology?focus=${r.id}`)}
                >
                  {r.otype} · {r.name}
                </Tag>
              </Tooltip>
            ))}
          </Space>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
            Agent 发言时会注入上述实体及关系作为参考资料,点击可跳转图谱定位
          </Typography.Text>
        </>
      ) : (
        <Alert
          type="info"
          showIcon
          message="当前问题未匹配到图谱实体"
          description={
            emptyHint ||
            "AGE 图谱以系统/API/指标类实体为主。可点击上方示例问题,或换用与 UniGateway、P99 Latency、Hybrid Search 相关的问题。"
          }
        />
      )}
    </Card>
  );

  // ---------- 准备阶段 ----------
  if (phase === "setup") {
    return (
      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card title="发起圆桌会议" size="small">
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div>
                <Typography.Text strong>你的核心问题(全程围绕它)</Typography.Text>
                <Input.TextArea
                  rows={3}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="描述你想解决的问题,所有 Agent 会围绕它讨论"
                />
                <Space wrap style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>图谱示例:</Typography.Text>
                  {GRAPH_EXAMPLES.map((q) => (
                    <Tag
                      key={q}
                      style={{ cursor: "pointer" }}
                      color={question === q ? "purple" : "default"}
                      onClick={() => setQuestion(q)}
                    >
                      {q.length > 28 ? `${q.slice(0, 28)}…` : q}
                    </Tag>
                  ))}
                </Space>
              </div>
              <div>
                <Typography.Text strong>拉哪些对象进会议(至少 2 个)</Typography.Text>
                {agents.length === 0 ? (
                  <Empty description="还没有对象,请先到「对象管理」创建" />
                ) : (
                  <Select
                    mode="multiple"
                    style={{ width: "100%" }}
                    placeholder="选择参会 Agent"
                    value={selected}
                    onChange={setSelected}
                    options={agents.map((a) => ({
                      value: a.id,
                      label: `${a.emoji} ${a.name}${a.role ? " · " + a.role : ""}`,
                    }))}
                  />
                )}
              </div>
              <Button type="primary" size="large" onClick={start} loading={starting} block>
                开始会议
              </Button>
            </Space>
          </Card>
          {previewLoading ? (
            <Card size="small" style={{ marginTop: 12 }}><Spin tip="预览图谱匹配…" /></Card>
          ) : (
            graphCard(previewRefs, "输入问题后将自动预览可引用的图谱实体")
          )}
        </Col>
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={<><HistoryOutlined /> 会议历史</>}
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={loadHistory} loading={historyLoading} />
            }
          >
            <Table
              size="small"
              rowKey="id"
              loading={historyLoading}
              pagination={{ pageSize: 8, size: "small", hideOnSinglePage: true }}
              dataSource={history}
              locale={{ emptyText: "暂无会议记录" }}
              columns={[
                {
                  title: "问题",
                  dataIndex: "question",
                  ellipsis: true,
                  render: (q: string, r: Meeting) => (
                    <Tooltip title={q}>
                      <span>{r.title || q}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 72,
                  render: (s: string) => (
                    <Tag color={s === "stopped" ? "default" : "processing"}>
                      {s === "stopped" ? "已结束" : "进行中"}
                    </Tag>
                  ),
                },
                {
                  title: "图谱",
                  width: 52,
                  render: (_: unknown, r: Meeting) => (
                    <Tag color={r.graph_ref_count ? "geekblue" : "default"}>
                      {r.graph_ref_count ?? 0}
                    </Tag>
                  ),
                },
                {
                  title: "操作",
                  width: 100,
                  render: (_: unknown, r: Meeting) => (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => openMeeting(r.id, r.status === "active")}
                    >
                      {r.status === "active" ? "继续" : "查看"}
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    );
  }

  // ---------- 会议阶段 ----------
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={backToSetup}>
          返回会议列表
        </Button>
      </div>
      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title="圆桌"
            extra={
              <Tag color={meeting?.status === "stopped" ? "default" : "processing"}>
                {meeting?.status === "stopped"
                  ? "已结束"
                  : `进行中 · 第 ${messages.filter((m) => m.speaker_type === "agent").length} 发言`}
              </Tag>
            }
          >
            <RoundTable
              question={meeting?.question || ""}
              agents={meeting?.participants || []}
              activeAgentId={activeAgentId}
            />
            <Space style={{ marginTop: 12, width: "100%", justifyContent: "center" }} wrap>
              {meeting?.status !== "stopped" && (
                <Segmented
                  value={running ? "run" : "pause"}
                  onChange={(v) => setRunning(v === "run")}
                  options={[
                    { label: "自动推进", value: "run", icon: <PlayCircleOutlined /> },
                    { label: "暂停", value: "pause", icon: <PauseCircleOutlined /> },
                  ]}
                />
              )}
              <Button
                danger
                icon={<StopOutlined />}
                onClick={finish}
                loading={finishing}
                disabled={meeting?.status === "stopped" || finishing}
              >
                结束并生成产物
              </Button>
            </Space>
          </Card>
          {deliverablesCard()}
          {graphCard(graphRefs)}
        </Col>

        <Col xs={24} lg={14}>
          <Card size="small" title="讨论记录" styles={{ body: { padding: 0 } }}>
            <div
              ref={chatRef}
              style={{ height: 460, overflowY: "auto", padding: 16, background: "rgba(8,10,20,0.6)" }}
            >
              {messages.map((m) => (
                <ChatBubble key={m.id} m={m} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #232636" }}>
              <Input
                placeholder={meeting?.status === "stopped" ? "会议已结束" : "插一句话,引导讨论方向…"}
                value={draft}
                disabled={meeting?.status === "stopped"}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={sendInterject}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={sendInterject}
                disabled={meeting?.status === "stopped"}
              >
                插话
              </Button>
            </div>
          </Card>
        </Col>
      </Row>

      <Modal
        title={previewItem ? `${KIND_META[previewItem.kind]?.label || ""} · ${previewItem.title}` : ""}
        open={!!previewItem}
        onCancel={() => setPreviewItem(null)}
        width={previewItem?.kind === "html" ? 960 : 760}
        footer={[
          previewItem && (
            <Button key="dl" icon={<DownloadOutlined />} onClick={() => downloadFile(previewItem)}>
              下载
            </Button>
          ),
          <Button key="close" type="primary" onClick={() => setPreviewItem(null)}>
            关闭
          </Button>,
        ]}
      >
        {previewItem?.kind === "html" ? (
          <iframe
            title="html-report"
            srcDoc={previewItem.content}
            style={{ width: "100%", height: 520, border: "1px solid #2a2e42", borderRadius: 8, background: "#fff" }}
          />
        ) : (
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", maxHeight: 500, overflow: "auto" }}>
            {previewItem?.content}
          </pre>
        )}
      </Modal>
    </>
  );
}

function ChatBubble({ m }: { m: CouncilMessage }) {
  if (m.speaker_type === "system") {
    return (
      <div style={{ textAlign: "center", margin: "10px 0" }}>
        <Tag color="default">{m.content}</Tag>
      </div>
    );
  }
  const mine = m.speaker_type === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: mine ? "row-reverse" : "row",
        marginBottom: 14,
        gap: 8,
      }}
    >
      <Avatar style={{ background: "#161a2c", border: "1px solid #2a2e42", fontSize: 18 }}>
        {m.emoji}
      </Avatar>
      <div style={{ maxWidth: "72%" }}>
        <div style={{ fontSize: 12, color: "#8a90ad", textAlign: mine ? "right" : "left" }}>
          {m.speaker_name}
        </div>
        <div
          style={{
            marginTop: 2,
            padding: "8px 12px",
            borderRadius: 10,
            background: mine ? "linear-gradient(135deg,#b45cff,#ff53c8)" : "#1a1e30",
            color: mine ? "#fff" : "#e7e9f3",
            border: mine ? "none" : "1px solid #262a3e",
            boxShadow: "0 2px 8px rgba(0,0,0,.35)",
            lineHeight: 1.6,
          }}
        >
          {m.content}
        </div>
      </div>
    </div>
  );
}
