import { Empty, Select, Skeleton, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import type { Agent } from "../../api/client";

interface Props {
  agents: Agent[];
  value?: number;
  loading?: boolean;
  onChange: (value: number) => void;
}

const statusText: Record<Agent["status"], string> = {
  available: "可用",
  disabled: "已停用",
  quota_exhausted: "额度已用尽",
};

const formatQuota = (value?: number) => {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return safeValue >= 10000 && safeValue % 10000 === 0
    ? `${safeValue / 10000} 万`
    : safeValue.toLocaleString("zh-CN");
};

export default function AgentSelector({ agents, value, loading = false, onChange }: Props) {
  const selected = agents.find((agent) => agent.id === value);

  if (loading) {
    return <div className="task-agent-selector"><Skeleton.Input active block /></div>;
  }

  return (
    <div className="task-agent-selector">
      <div className="task-field-label"><RobotOutlined /> 执行智能体</div>
      <Select
        value={value}
        onChange={onChange}
        placeholder="请选择管理模块中已配置的智能体"
        notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="管理模块中还没有可用智能体" />}
        options={agents.map((agent) => ({
          value: agent.id,
          label: `${agent.emoji || "🤖"} ${agent.name}`,
          disabled: agent.status !== "available",
        }))}
        optionRender={(option) => {
          const agent = agents.find((item) => Number(item.id) === Number(option.value));
          const status = agent?.status || "available";
          return agent ? (
            <div className="task-agent-option">
              <div>
                <strong>{agent.emoji || "🤖"} {agent.name}</strong>
                <span className={`task-agent-availability is-${status}`}>
                  {statusText[status] || "可用"}
                </span>
              </div>
              <Typography.Text type="secondary">
                {agent.expertise || agent.persona || agent.role || "尚未填写能力说明"}
              </Typography.Text>
              <small>{agent.group || "未分类"} · 剩余额度：{formatQuota(agent.quota_remaining)}</small>
            </div>
          ) : option.label;
        }}
        style={{ width: "100%" }}
      />
      {selected ? (
        <div className="task-agent-meta">
          <span>{selected.expertise || selected.persona || selected.role || "尚未填写能力说明"}</span>
          <span>剩余额度：{formatQuota(selected.quota_remaining)}</span>
        </div>
      ) : (
        <div className="task-agent-meta">
          <span>请先在“管理 → 对象”中创建并启用智能体。</span>
        </div>
      )}
      <Typography.Text className="task-agent-help" type="secondary">
        决定本次任务使用的知识、技能、数据权限和执行规则。执行智能体负责实际执行任务，任务负责人负责接收、跟进和验收。
      </Typography.Text>
    </div>
  );
}
