import {
  CheckCircleFilled, ClockCircleFilled, CloseCircleFilled, LoadingOutlined,
  WarningFilled,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { PublishedTask } from "./mockTasks";

const STATUS_META: Record<PublishedTask["status"], {
  label: string;
  icon: ReactNode;
}> = {
  pending: { label: "待处理", icon: <ClockCircleFilled /> },
  running: { label: "进行中", icon: <LoadingOutlined /> },
  completed: { label: "已完成", icon: <CheckCircleFilled /> },
  partial: { label: "部分完成", icon: <WarningFilled /> },
  failed: { label: "执行失败", icon: <CloseCircleFilled /> },
};

export default function TaskStatusBadge({
  status,
  label,
}: {
  status: PublishedTask["status"];
  label?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span className={`task-status-badge is-${status}`}>
      {meta.icon}
      <span>{label || meta.label}</span>
    </span>
  );
}
