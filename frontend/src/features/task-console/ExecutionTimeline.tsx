import { Space, Tag, Timeline, Typography } from "antd";
import {
  CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled,
  LoadingOutlined, MinusCircleOutlined,
} from "@ant-design/icons";

export type ExecutionState = "waiting" | "running" | "completed" | "failed" | "skipped";

export interface ExecutionStep {
  key?: string;
  title: string;
  status: ExecutionState;
  time?: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: string;
  detail: string;
}

const STATE_META: Record<ExecutionState, { text: string; color: string }> = {
  waiting: { text: "等待中", color: "default" },
  running: { text: "执行中", color: "processing" },
  completed: { text: "已完成", color: "success" },
  failed: { text: "执行失败", color: "error" },
  skipped: { text: "已跳过", color: "default" },
};

function dotOf(status: ExecutionState) {
  if (status === "running") return <LoadingOutlined className="task-timeline-running" />;
  if (status === "completed") return <CheckCircleFilled className="task-timeline-success" />;
  if (status === "failed") return <CloseCircleFilled className="task-timeline-failed" />;
  if (status === "skipped") return <MinusCircleOutlined className="task-timeline-waiting" />;
  return <ClockCircleOutlined className="task-timeline-waiting" />;
}

export default function ExecutionTimeline({ steps }: { steps: ExecutionStep[] }) {
  if (steps.length === 0) return null;

  return (
    <Timeline
      className="task-execution-timeline"
      items={steps.map((step) => ({
        dot: dotOf(step.status),
        children: (
          <div className={`task-timeline-item is-${step.status}`}>
            <div className="task-timeline-title">
              <Typography.Text strong>{step.title}</Typography.Text>
              <Space size={8} wrap>
                {step.time && <Typography.Text type="secondary">{step.time}</Typography.Text>}
                <Tag color={STATE_META[step.status].color}>{STATE_META[step.status].text}</Tag>
              </Space>
            </div>
            <Typography.Text type="secondary" className="task-timeline-detail">{step.detail}</Typography.Text>
            {(step.startedAt || step.finishedAt || step.duration) && (
              <div className="task-timeline-meta">
                {step.startedAt && <span>开始：{step.startedAt}</span>}
                {step.finishedAt && <span>完成：{step.finishedAt}</span>}
                {step.duration && <span>耗时：{step.duration}</span>}
              </div>
            )}
          </div>
        ),
      }))}
    />
  );
}
