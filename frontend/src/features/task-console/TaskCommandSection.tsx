import { Input, Tag, Typography } from "antd";
import { BulbOutlined } from "@ant-design/icons";
import TaskStepHeader from "./TaskStepHeader";

const { TextArea } = Input;

interface Props {
  value: string;
  onChange: (value: string) => void;
  recognized?: boolean;
}

const EXAMPLE = "帮我生成昨天的运营日报，并发送给运营负责人。";

export default function TaskCommandSection({ value, onChange, recognized }: Props) {
  return (
    <section className="task-step-section">
      <TaskStepHeader
        step={1}
        title="输入任务指令"
        description="用一句话描述你希望系统完成的工作。"
        extra={recognized ? <Tag color="success" className="task-step-badge">AI 已识别</Tag> : undefined}
      />
      <div className="task-step-body">
        <TextArea
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={EXAMPLE}
          className="task-command-input"
        />
        <div className="task-command-example">
          <BulbOutlined />
          <Typography.Text type="secondary">示例：{EXAMPLE}</Typography.Text>
        </div>
      </div>
    </section>
  );
}
