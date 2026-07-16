import { Empty, Space, Tag, Timeline, Typography } from "antd";
import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, LoadingOutlined } from "@ant-design/icons";

export type ExecutionState = "waiting" | "running" | "completed" | "failed";

export interface ExecutionStep {
  key: string;
  title: string;
  status: ExecutionState;
  time?: string;
  detail: string;
}

const STATE_META: Record<ExecutionState, { text: string; color: string }> = {
  waiting: { text: "等待中", color: "default" },
  running: { text: "执行中", color: "processing" },
  completed: { text: "已完成", color: "success" },
  failed: { text: "执行失败", color: "error" },
};

function dotOf(status: ExecutionState) {
  if (status === "running") return <LoadingOutlined className="task-timeline-running" />;
  if (status === "completed") return <CheckCircleFilled className="task-timeline-success" />;
  if (status === "failed") return <CloseCircleFilled className="task-timeline-failed" />;
  return <ClockCircleOutlined className="task-timeline-waiting" />;
}

export default function ExecutionTimeline({ steps }: { steps: ExecutionStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="task-empty-state">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />
        <Typography.Title level={5}>任务尚未执行</Typography.Title>
        <Typography.Text type="secondary">
          填写左侧任务信息并运行后，可在此查看完整执行过程。
        </Typography.Text>
      </div>
    );
  }

  return (
    <Timeline
      className="task-execution-timeline"
      items={steps.map((step) => ({
        dot: dotOf(step.status),
        children: (
          <div className={`task-timeline-item is-${step.status}`}>
            <div className="task-timeline-title">
              <Typography.Text strong>{step.title}</Typography.Text>
              <Space size={8}>
                {step.time && <Typography.Text type="secondary">{step.time}</Typography.Text>}
                <Tag color={STATE_META[step.status].color}>{STATE_META[step.status].text}</Tag>
              </Space>
            </div>
            <Typography.Text type="secondary">{step.detail}</Typography.Text>
          </div>
        ),
      }))}
    />
  );
}

