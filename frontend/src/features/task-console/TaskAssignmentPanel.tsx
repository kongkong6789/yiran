import { Col, Input, Row, Select } from "antd";
import { CalendarOutlined, FlagOutlined } from "@ant-design/icons";
import TaskStepHeader from "./TaskStepHeader";
import RecipientSelector from "./RecipientSelector";
import WeComMessagePreview from "./WeComMessagePreview";
import type { TaskAssignmentValue } from "./mockWeCom";

interface Props {
  task: string;
  agentName: string;
  value: TaskAssignmentValue;
  onChange: (next: TaskAssignmentValue) => void;
  contactsRefreshKey?: number;
}

export default function TaskAssignmentPanel({
  task,
  agentName,
  value,
  onChange,
  contactsRefreshKey,
}: Props) {
  return (
    <section className="task-step-section task-assignment-panel">
      <TaskStepHeader
        step={4}
        title="分配负责人并通知"
        description="执行智能体负责执行任务，任务负责人负责跟进、接收和验收。"
      />
      <div className="task-step-body">
        <div className="task-role-hint">
          <div><span>执行智能体</span><strong>{agentName || "未选择"}</strong></div>
          <div><span>任务负责人</span><strong>{value.notificationMode === "none" ? "可选，用于任务跟踪" : "负责接收与验收"}</strong></div>
        </div>

        <RecipientSelector
          value={value}
          onChange={onChange}
          refreshKey={contactsRefreshKey}
        />

        <Row gutter={10} className="task-assignment-meta-row">
          <Col xs={24} sm={14}>
            <div className="task-field-label"><CalendarOutlined /> 截止时间</div>
            <Input
              type="datetime-local"
              value={value.deadline}
              onChange={(event) => onChange({ ...value, deadline: event.target.value })}
            />
          </Col>
          <Col xs={24} sm={10}>
            <div className="task-field-label"><FlagOutlined /> 优先级</div>
            <Select
              value={value.priority}
              style={{ width: "100%" }}
              onChange={(priority) => onChange({ ...value, priority })}
              options={[
                { value: "normal", label: "普通" },
                { value: "high", label: "高" },
                { value: "urgent", label: "紧急" },
              ]}
            />
          </Col>
        </Row>

        {value.notificationMode !== "none" && (
          <WeComMessagePreview task={task} roleLabel={agentName} assignment={value} />
        )}
      </div>
    </section>
  );
}
