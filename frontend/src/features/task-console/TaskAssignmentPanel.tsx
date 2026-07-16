import { Col, Input, Row, Select, Typography } from "antd";
import { CalendarOutlined, FlagOutlined, TeamOutlined } from "@ant-design/icons";
import RecipientSelector from "./RecipientSelector";
import WeComMessagePreview from "./WeComMessagePreview";
import type { TaskAssignmentValue } from "./mockWeCom";

interface Props {
  task: string;
  roleLabel: string;
  value: TaskAssignmentValue;
  onChange: (next: TaskAssignmentValue) => void;
  onConfigureWeCom: () => void;
  contactsRefreshKey?: number;
}

export default function TaskAssignmentPanel({ task, roleLabel, value, onChange, onConfigureWeCom, contactsRefreshKey }: Props) {
  return (
    <section className="task-assignment-panel">
      <div className="task-section-heading">
        <span className="task-section-icon"><TeamOutlined /></span>
        <div>
          <Typography.Text strong>任务分配</Typography.Text>
          <Typography.Text type="secondary">指定负责人并选择企业微信通知范围</Typography.Text>
        </div>
      </div>

      <div className="task-field-label">任务负责人 / 通知对象</div>
      <RecipientSelector
        value={value}
        onChange={onChange}
        onConfigureWeCom={onConfigureWeCom}
        refreshKey={contactsRefreshKey}
      />

      <Row gutter={10}>
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

      <WeComMessagePreview task={task} roleLabel={roleLabel} assignment={value} />
    </section>
  );
}
