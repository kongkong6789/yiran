import { QuestionCircleOutlined } from "@ant-design/icons";
import { Tooltip, Typography } from "antd";
import type { ReactNode } from "react";

interface Props {
  step: number;
  title: string;
  description?: string;
  tooltip?: string;
  extra?: ReactNode;
}

export default function TaskStepHeader({ step, title, description, tooltip, extra }: Props) {
  return (
    <div className="task-step-header">
      <div className="task-step-header-main">
        <span className="task-step-index">{step}</span>
        <div>
          <div className="task-step-title-row">
            <Typography.Text strong className="task-step-title">{title}</Typography.Text>
            {tooltip && (
              <Tooltip title={tooltip}>
                <QuestionCircleOutlined className="task-step-tooltip-icon" />
              </Tooltip>
            )}
            {extra}
          </div>
          {description && (
            <Typography.Text type="secondary" className="task-step-desc">{description}</Typography.Text>
          )}
        </div>
      </div>
    </div>
  );
}
