import {
  AppstoreOutlined, CheckSquareOutlined, FileTextOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import WeComConnectionStatus from "./WeComConnectionStatus";

export type TaskModuleView = "all" | "received" | "sent" | "todos" | "automation" | "create";

const PRIMARY_ITEMS: Array<{
  key: TaskModuleView;
  label: string;
  icon: ReactNode;
}> = [
  { key: "all", label: "任务中心", icon: <AppstoreOutlined /> },
  { key: "todos", label: "待办", icon: <CheckSquareOutlined /> },
];

export default function TaskModuleSidebar({
  active,
  onChange,
}: {
  active: TaskModuleView;
  onChange: (view: TaskModuleView) => void;
}) {
  const navigate = useNavigate();
  const linkedItems = [
    { key: "templates", label: "模板中心", icon: <FileTextOutlined />, path: "/skills?context=tasks" },
    { key: "automation", label: "自动化", icon: <PlayCircleOutlined />, path: "/work?tab=automation" },
  ];

  return (
    <aside className="task-module-sidebar" aria-label="任务模块导航">
      <nav className="task-module-nav">
        {PRIMARY_ITEMS.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`task-module-nav-item${
              item.key === "all"
                ? active !== "todos" ? " is-active" : ""
                : active === item.key ? " is-active" : ""
            }`}
            onClick={() => onChange(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        <div className="task-module-nav-separator" />
        {linkedItems.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`task-module-nav-item${item.key === "automation" && active === "automation" ? " is-active" : ""}`}
            onClick={() => item.key === "automation" ? onChange("automation") : navigate(item.path)}
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
