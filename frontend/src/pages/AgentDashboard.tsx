import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  EditOutlined,
  FolderOutlined,
  HistoryOutlined,
  LeftOutlined,
  MessageOutlined,
  ProfileOutlined,
  RightOutlined,
  ScheduleOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Skeleton, message } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  getSkillAssets,
  getSkills,
  listKnowledgeBases,
  listAgents,
  listSops,
  updateAgent,
  type Agent,
} from "../api/client";
import capabilityLogs from "../assets/staffdeck/capabilityLogs.png";
import capabilityTasks from "../assets/staffdeck/capabilityTasks.png";
import capabilityTools from "../assets/staffdeck/capabilityTools.png";
import {
  persistAgentAvatar,
  resolveAgentAvatar,
} from "../utils/agentAvatars";
import {
  AgentFormModal,
  type AgentAvatarSelection,
  type AgentFormValues,
  type CapabilityOption,
} from "./Agents";

type AgentProfileTab = "work" | "scheduled" | "memory" | "logs";
type TimelineMode = "day" | "week" | "month";

const FALLBACK_AGENT: Agent = {
  id: -1,
  name: "IT",
  emoji: "",
  group: "技术支持",
  role: "内部支持工程师",
  expertise: "处理账号权限、设备申领、常见故障排查等 IT 服务请求，能按 SOP 分流工单、调用内部系统接口开通权限，复杂问题转交人工工程师。",
  persona: "稳健、清晰、优先按标准流程排查问题。",
  execution_role: "operator",
  is_active: true,
  quota_limit: 10000,
  quota_used: 0,
  quota_remaining: 10000,
  status: "available",
  skill_ids: ["文本翻译", "日志分析", "诊断脚本执行"],
  sop_keys: [],
  knowledge_base_ids: [1, 2],
  capability_instructions: "故障报修受理 / 权限开通工单分流",
  created_at: "2026-07-08T00:00:00Z",
};

const PROFILE_TABS: Array<{ key: AgentProfileTab; label: string; icon: React.ReactNode }> = [
  { key: "work", label: "工作记录", icon: <ProfileOutlined /> },
  { key: "scheduled", label: "定时任务", icon: <ClockCircleOutlined /> },
  { key: "memory", label: "记忆", icon: <HistoryOutlined /> },
  { key: "logs", label: "对话日志", icon: <CalendarOutlined /> },
];

function dashboardError(error: unknown, fallback: string) {
  if (typeof error === "object" && error) {
    const response = (error as { response?: { data?: { detail?: string; error?: string } } }).response;
    return response?.data?.detail || response?.data?.error || fallback;
  }
  return fallback;
}

function formatDate(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("/");
}

function formatJoinedAt(value: string) {
  if (!value) return "2026-07-08";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function agentAvatar(agent: Agent, offset = 0) {
  return resolveAgentAvatar(agent, offset);
}

export default function AgentDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [capabilityOptionsLoading, setCapabilityOptionsLoading] = useState(false);
  const [skillOptions, setSkillOptions] = useState<CapabilityOption<string>[]>([]);
  const [sopOptions, setSopOptions] = useState<CapabilityOption<string>[]>([]);
  const [knowledgeBaseOptions, setKnowledgeBaseOptions] = useState<CapabilityOption<number>[]>([]);
  const [tab, setTab] = useState<AgentProfileTab>("work");
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("day");
  const [anchorDate, setAnchorDate] = useState(() => new Date(2026, 6, 23));

  const requestedId = Number(searchParams.get("agent"));
  const editing = searchParams.get("edit") === "1";

  const load = async () => {
    setLoading(true);
    try {
      const response = await listAgents();
      setAgents(response.results);
    } catch (error) {
      message.error(dashboardError(error, "智能体详情加载失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const loadCapabilityOptions = async () => {
    setCapabilityOptionsLoading(true);
    try {
      const [skillAssets, personalSkills, knowledgeBases, sops] = await Promise.all([
        getSkillAssets(),
        getSkills(),
        listKnowledgeBases(),
        listSops(),
      ]);
      const skillMap = new Map<string, CapabilityOption<string>>();
      (skillAssets.results || []).forEach((skill) => {
        skillMap.set(skill.skill_id, {
          value: skill.skill_id,
          label: skill.name || skill.skill_id,
          description: skill.description || "",
          meta: `${skill.visibility === "shared" ? "全员共享" : "个人"} · ${skill.has_scripts ? "含执行脚本" : "指令型"}`,
        });
      });
      (personalSkills.results || []).filter((skill) => skill.enabled).forEach((skill) => {
        const previous = skillMap.get(skill.skill_id);
        skillMap.set(skill.skill_id, {
          value: skill.skill_id,
          label: skill.name || skill.skill_id,
          description: skill.description || previous?.description || "",
          meta: "个人已启用 · 运行时直接加载",
        });
      });
      setSkillOptions(Array.from(skillMap.values())
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")));
      setSopOptions(
        (sops.results || [])
          .filter((sop) => sop.status === "published")
          .map((sop) => ({
            value: sop.key,
            label: sop.name || sop.key,
            description: sop.description || sop.actionName || "",
            meta: `已发布 · ${sop.key}${sop.currentVersion ? ` · v${sop.currentVersion}` : ""}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
      );
      setKnowledgeBaseOptions(knowledgeBases.map((knowledgeBase) => ({
        value: knowledgeBase.id,
        label: knowledgeBase.name,
        description: knowledgeBase.description || "",
        meta: `${knowledgeBase.visibility === "private" ? "个人" : knowledgeBase.visibility === "company" ? "公司" : "团队"} · ${knowledgeBase.file_count} 个文件 · ${knowledgeBase.status === "ready" ? "可用" : `状态：${knowledgeBase.status}`}`,
      })));
    } catch (error) {
      message.error(dashboardError(error, "Skill / SOP / 知识库加载失败，请稍后重试"));
    } finally {
      setCapabilityOptionsLoading(false);
    }
  };

  const selectedAgent = useMemo(() => {
    if (Number.isFinite(requestedId)) {
      const requested = agents.find((agent) => agent.id === requestedId);
      if (requested) return requested;
    }
    return agents[0] || FALLBACK_AGENT;
  }, [agents, requestedId]);

  useEffect(() => {
    if (editing) void loadCapabilityOptions();
  }, [editing]);

  const knowledgeCount = selectedAgent.knowledge_base_ids.length;
  const skillCount = selectedAgent.skill_ids.length;
  const sopCount = selectedAgent.sop_keys?.length || 0;
  const toolCount = selectedAgent.capability_instructions.trim() ? 2 : 0;

  const growthRecords = useMemo(() => {
    const skillNames = selectedAgent.skill_ids.length
      ? selectedAgent.skill_ids
      : ["文本翻译", "日志分析", "诊断脚本执行"];
    return [
      { kind: "新增 SOP", title: "权限开通工单分流" },
      { kind: "新增 SOP", title: "故障报修受理" },
      ...skillNames.slice(0, 3).map((title) => ({ kind: "技能升级", title })),
      { kind: "新增工具", title: "系统权限开通" },
      { kind: "新增工具", title: "IT 工单登记" },
    ].slice(0, 7);
  }, [selectedAgent.skill_ids]);

  const capabilityCards = [
    {
      key: "knowledge",
      title: "知识库",
      count: knowledgeCount,
      body: selectedAgent.knowledge_base_ids.length
        ? selectedAgent.knowledge_base_ids.map((id) => `知识库 ${id}`).join(" / ")
        : "暂无知识库",
      icon: <FolderOutlined />,
      dark: false,
    },
    {
      key: "skills",
      title: "技能",
      count: skillCount,
      body: selectedAgent.skill_ids.join(" / ") || "暂无启用技能",
      icon: <ToolOutlined />,
      dark: false,
    },
    {
      key: "sop",
      title: "SOP",
      count: sopCount,
      body: selectedAgent.capability_instructions || "暂无启用 SOP",
      icon: <ProfileOutlined />,
      dark: false,
    },
    {
      key: "tools",
      title: "工具",
      count: toolCount,
      body: toolCount ? "系统权限开通 / IT 工单登记" : "暂无启用工具",
      icon: <DatabaseOutlined />,
      dark: true,
      image: capabilityTools,
    },
    {
      key: "scheduled",
      title: "定时任务",
      count: 0,
      body: "暂无启用定时任务",
      icon: <ClockCircleOutlined />,
      dark: true,
      image: capabilityTasks,
    },
    {
      key: "logs",
      title: "对话日志",
      count: 0,
      body: "暂无对话任务",
      icon: <CalendarOutlined />,
      dark: true,
      image: capabilityLogs,
    },
  ];

  const setEditMode = (nextEditing: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (nextEditing) next.set("edit", "1");
    else next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  const saveProfile = async (values: AgentFormValues, avatar: AgentAvatarSelection) => {
    setSaving(true);
    try {
      if (selectedAgent.id < 0) {
        setAgents([{ ...selectedAgent, ...values, emoji: avatar.token }]);
      } else {
        await updateAgent(selectedAgent.id, { ...values, emoji: avatar.token });
        await load();
      }
      persistAgentAvatar(selectedAgent.id, avatar.customDataUrl);
      setEditMode(false);
      message.success("智能体资料已更新");
    } catch (error) {
      message.error(dashboardError(error, "保存失败，请检查后重试"));
    } finally {
      setSaving(false);
    }
  };

  const moveDate = (direction: -1 | 1) => {
    const next = new Date(anchorDate);
    next.setDate(next.getDate() + direction);
    setAnchorDate(next);
  };

  if (loading) {
    return (
      <div className="agent-dashboard-page is-loading">
        <Skeleton active avatar paragraph={{ rows: 14 }} />
      </div>
    );
  }

  return (
    <div className="agent-dashboard-page">
      <div className="agent-dashboard-back">
        <button type="button" onClick={() => navigate("/agents")}>
          <ArrowLeftOutlined />
          返回智能体列表
        </button>
      </div>
      <section className="agent-dashboard-hero">
        <div className="agent-dashboard-avatar-column">
          <div className="agent-dashboard-avatar">
            <img src={agentAvatar(selectedAgent)} alt={`${selectedAgent.name}头像`} />
          </div>
          <div className="agent-dashboard-hero-actions">
            <button type="button" onClick={() => navigate(`/agent?agent=${selectedAgent.id}`)}>
              <MessageOutlined /> 去对话
            </button>
            <button type="button" onClick={() => setEditMode(true)}>
              <EditOutlined /> 编辑资料
            </button>
          </div>
        </div>

        <div className="agent-dashboard-profile">
          <div className="agent-dashboard-title-row">
            <h1>{selectedAgent.name}</h1>
            <span>{selectedAgent.role || selectedAgent.group || "待补充岗位"}</span>
          </div>
          <div className="agent-dashboard-meta">
            <span className={`agent-dashboard-status${selectedAgent.status === "available" ? " is-online" : ""}`}>
              <i />
              {selectedAgent.status === "available" ? "在线" : "下线"}
            </span>
            <span>创建者：admin</span>
            <span>入职时间：{formatJoinedAt(selectedAgent.created_at)}</span>
          </div>
          <p>{selectedAgent.expertise || selectedAgent.persona || "负责接收任务、调用知识库、执行 SOP 并沉淀工作记录。"}</p>
          <div className="agent-dashboard-hero-metrics">
            <span><strong>{knowledgeCount}</strong> 资料</span>
            <span><strong>{skillCount}</strong> 技能</span>
            <span><strong>{sopCount}</strong> SOP</span>
            <span><strong>0</strong> 定时任务</span>
          </div>
        </div>
      </section>

      <AgentFormModal
        open={editing}
        editing={selectedAgent}
        groupOptions={Array.from(new Set(agents.map((agent) => agent.group || "未分类")))
          .sort((a, b) => a.localeCompare(b, "zh-CN"))
          .map((group) => ({ value: group }))}
        skillOptions={skillOptions}
        sopOptions={sopOptions}
        knowledgeBaseOptions={knowledgeBaseOptions}
        capabilityOptionsLoading={capabilityOptionsLoading}
        submitting={saving}
        onClose={() => setEditMode(false)}
        onSubmit={saveProfile}
      />

      <nav className="agent-dashboard-tabs" aria-label="智能体详情分类">
        {PROFILE_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? "is-active" : ""}
            onClick={() => setTab(item.key)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "work" ? (
        <section className="agent-dashboard-work">
          <div className="agent-dashboard-reply-metrics">
            <button type="button"><strong>0</strong><span>今日对话</span></button>
            <button type="button"><strong>0</strong><span>累计对话</span></button>
            <button type="button" className="is-positive"><strong>0%</strong><span>好评率</span></button>
            <button type="button" className="is-negative"><strong>0%</strong><span>差评率</span></button>
          </div>

          <div className="agent-dashboard-timeline-head">
            <span><CalendarOutlined /> {formatDate(anchorDate)}</span>
            <div className="agent-dashboard-date-stepper">
              <button type="button" onClick={() => moveDate(-1)} aria-label="前一天"><LeftOutlined /></button>
              <span>{formatDate(anchorDate)}</span>
              <button type="button" onClick={() => moveDate(1)} aria-label="后一天"><RightOutlined /></button>
            </div>
            <div className="agent-dashboard-timeline-modes">
              {(["day", "week", "month"] as TimelineMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={timelineMode === mode ? "is-active" : ""}
                  onClick={() => setTimelineMode(mode)}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="agent-dashboard-empty-timeline">
            <CalendarOutlined />
            <span>{timelineMode === "day" ? "当日暂无活动记录" : `当前 ${timelineMode} 暂无活动记录`}</span>
          </div>

          <section className="agent-dashboard-growth">
            <h2><ArrowUpOutlined /> 成长记录</h2>
            <div className="agent-dashboard-growth-track">
              {growthRecords.map((record, index) => (
                <article key={`${record.kind}-${record.title}-${index}`}>
                  <strong>7.22</strong>
                  <i />
                  <div>
                    <span>{record.kind}</span>
                    <b>{record.title}</b>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="agent-dashboard-capabilities" aria-label="智能体能力概览">
            {capabilityCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className={card.dark ? "is-dark" : ""}
                onClick={() => {
                  if (card.key === "scheduled") setTab("scheduled");
                  else if (card.key === "logs") setTab("logs");
                }}
              >
                <RightOutlined className="agent-dashboard-card-arrow" />
                <span className="agent-dashboard-card-title">{card.icon}{card.title}</span>
                <strong>{card.count}</strong>
                <i className="agent-dashboard-card-progress" />
                <p>{card.body}</p>
                {card.image && <img src={card.image} alt="" />}
              </button>
            ))}
          </section>
        </section>
      ) : (
        <section className="agent-dashboard-tab-empty">
          {tab === "scheduled" && <ClockCircleOutlined />}
          {tab === "memory" && <HistoryOutlined />}
          {tab === "logs" && <ScheduleOutlined />}
          <strong>
            {tab === "scheduled" ? "暂无定时任务" : tab === "memory" ? "暂无记忆记录" : "暂无对话日志"}
          </strong>
          <span>该智能体暂时还没有相关记录。</span>
        </section>
      )}
    </div>
  );
}
