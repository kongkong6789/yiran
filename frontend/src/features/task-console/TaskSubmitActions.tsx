import { Button, Typography } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { formatBlockerMessage } from "./taskSubmitValidation";

interface Props {
  loading: boolean;
  blockers: string[];
  onSubmit: () => void;
}

export default function TaskSubmitActions({ loading, blockers, onSubmit }: Props) {
  const disabled = blockers.length > 0;
  const hint = formatBlockerMessage(blockers);

  return (
    <section className="task-submit-actions">
      {disabled && hint && (
        <Typography.Text type="danger" className="task-submit-blocker">{hint}</Typography.Text>
      )}
      <Button
        className="task-run-button"
        type="primary"
        size="large"
        loading={loading}
        disabled={disabled}
        icon={<PlayCircleOutlined />}
        onClick={onSubmit}
        block
      >
        确认并执行任务
      </Button>
      <Typography.Text type="secondary" className="task-submit-hint">
        将运行 SOP、创建任务并按设置发送企业微信通知。
      </Typography.Text>
    </section>
  );
}
