import { RobotOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type { Agent } from "../../api/client";
import AgentSelector from "./AgentSelector";
import ExecutionInfoPanel from "./ExecutionInfoPanel";
import type { ExecutionField } from "./executionFields";

export default function TaskConfigSection({
  agents,
  agentId,
  loading,
  fields,
  onAgentChange,
  onFieldsChange,
}: {
  agents: Agent[];
  agentId?: number;
  loading: boolean;
  fields: ExecutionField[];
  onAgentChange: (id: number) => void;
  onFieldsChange: (fields: ExecutionField[]) => void;
}) {
  return (
    <section className="task-editor-section task-config-section">
      <div className="task-editor-section-heading">
        <div>
          <Typography.Title level={5}>任务配置</Typography.Title>
          <Typography.Text type="secondary">AI 已预填可识别信息，只需确认必要字段</Typography.Text>
        </div>
      </div>
      <div className="task-editor-section-body">
        <div className="task-config-agent-field">
          <div className="task-editor-field-label"><RobotOutlined /> 执行智能体</div>
          <AgentSelector
            agents={agents}
            value={agentId}
            loading={loading}
            onChange={onAgentChange}
          />
          <Typography.Text type="secondary">默认由系统匹配通用智能体，可按需修改。</Typography.Text>
        </div>
        {fields.length > 0 ? (
          <ExecutionInfoPanel fields={fields} onChange={onFieldsChange} embedded />
        ) : (
          <div className="task-config-empty">输入任务描述后，AI 会在这里补充数据日期、范围、输出方式和品牌等配置。</div>
        )}
      </div>
    </section>
  );
}
