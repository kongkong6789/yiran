import { Empty, Select, Skeleton, Tooltip, Typography } from "antd";
import { ApiOutlined } from "@ant-design/icons";
import type { Agent } from "../../api/client";

interface Props {
  agents: Agent[];
  value?: number;
  loading?: boolean;
  onChange: (value: number) => void;
}

const statusText: Record<Agent["status"], string> = {
  available: "可用",
  pending: "待审批",
  disabled: "已停用",
};

const AGENT_TOOLTIP = "决定本次任务使用的知识、技能、数据权限和执行规则。执行智能体负责实际执行任务，任务负责人负责接收、跟进和验收。";

export default function AgentSelector({ agents, value, loading = false, onChange }: Props) {
  const selected = agents.find((agent) => agent.id === value);

  if (loading) {
    return <div className="task-agent-selector"><Skeleton.Input active block /></div>;
  }

  return (
    <div className="task-agent-selector">
      <Select
        value={value}
        onChange={onChange}
        placeholder="请选择执行智能体"
        notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="管理模块中还没有可用智能体" />}
        options={agents.map((agent) => ({
          value: agent.id,
          label: agent.name,
          disabled: agent.status !== "available",
        }))}
        optionRender={(option) => {
          const agent = agents.find((item) => Number(item.id) === Number(option.value));
          const status = agent?.status || "available";
          return agent ? (
            <div className="task-agent-option">
              <div>
                <strong>{agent.name}</strong>
                <span className={`task-agent-availability is-${status}`}>
                  {statusText[status] || "可用"}
                </span>
              </div>
              <Typography.Text type="secondary" className="task-agent-option-desc" ellipsis={{ tooltip: true }}>
                {agent.expertise || agent.persona || agent.role || "尚未填写能力说明"}
              </Typography.Text>
            </div>
          ) : option.label;
        }}
        style={{ width: "100%" }}
      />
      {selected ? (
        <div className="task-agent-card">
          <span className="task-agent-card-icon"><ApiOutlined /></span>
          <div>
            <div className="task-agent-card-title">
              <strong>{selected.name}</strong>
              <Tooltip title={AGENT_TOOLTIP}>
                <span className="task-agent-card-help">说明</span>
              </Tooltip>
            </div>
            <Typography.Paragraph
              type="secondary"
              className="task-agent-card-desc"
              ellipsis={{ rows: 2, tooltip: true }}
            >
              {selected.expertise || selected.persona || selected.role || "适合跨部门查询、整理和常规协作"}
            </Typography.Paragraph>
            <div className="task-agent-card-meta">
              <span className={`task-agent-availability is-${selected.status}`}>
                {statusText[selected.status]}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <Typography.Text type="secondary" className="task-agent-empty">
          请先在「管理 → 对象」中创建并启用智能体。
        </Typography.Text>
      )}
    </div>
  );
}
