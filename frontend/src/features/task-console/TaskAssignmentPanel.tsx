import { Col, Input, Row, Select, Typography } from "antd";
import { CalendarOutlined, FlagOutlined } from "@ant-design/icons";
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
    <section className="task-editor-section task-assignment-panel">
      <div className="task-editor-section-heading">
        <div>
          <Typography.Title level={5}>负责人和通知</Typography.Title>
          <Typography.Text type="secondary">指定协作成员和企业微信触达方式</Typography.Text>
        </div>
        <span className="task-editor-agent-note">执行：{agentName || "系统自动匹配"}</span>
      </div>
      <div className="task-editor-section-body">
        <RecipientSelector
          value={value}
          onChange={onChange}
          refreshKey={contactsRefreshKey}
        />

        <Row gutter={[12, 12]} className="task-assignment-meta-row">
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
          <details className="task-notification-preview-details">
            <summary>预览企业微信通知内容</summary>
            <WeComMessagePreview task={task} roleLabel={agentName} assignment={value} />
          </details>
        )}
      </div>
    </section>
  );
}
