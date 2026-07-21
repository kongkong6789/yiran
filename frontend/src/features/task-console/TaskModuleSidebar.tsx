import {
  AppstoreOutlined, CheckSquareOutlined, FileTextOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import WeComConnectionStatus from "./WeComConnectionStatus";

export type TaskModuleView = "all" | "received" | "sent" | "todos" | "automation" | "templates" | "create";

const PRIMARY_ITEMS: Array<{
  key: TaskModuleView;
  label: string;
  icon: ReactNode;
}> = [
  { key: "all", label: "任务中心", icon: <AppstoreOutlined /> },
  { key: "todos", label: "待办", icon: <CheckSquareOutlined /> },
];

const SECONDARY_ITEMS: Array<{
  key: Extract<TaskModuleView, "templates" | "automation">;
  label: string;
  icon: ReactNode;
}> = [
  { key: "templates", label: "模板中心", icon: <FileTextOutlined /> },
  { key: "automation", label: "自动化", icon: <PlayCircleOutlined /> },
];

function isTaskCenterView(view: TaskModuleView) {
  return view === "all" || view === "received" || view === "sent" || view === "create";
}

export default function TaskModuleSidebar({
  active,
  onChange,
}: {
  active: TaskModuleView;
  onChange: (view: TaskModuleView) => void;
}) {
  return (
    <aside className="task-module-sidebar" aria-label="任务模块导航">
      <nav className="task-module-nav">
        {PRIMARY_ITEMS.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`task-module-nav-item${
              item.key === "all"
                ? isTaskCenterView(active) ? " is-active" : ""
                : active === item.key ? " is-active" : ""
            }`}
            onClick={() => onChange(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        <div className="task-module-nav-separator" />
        {SECONDARY_ITEMS.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`task-module-nav-item${active === item.key ? " is-active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="task-module-sidebar-footer">
        <WeComConnectionStatus />
      </div>
    </aside>
  );
}
