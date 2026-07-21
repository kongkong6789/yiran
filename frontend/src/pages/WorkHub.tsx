import {
  FileTextOutlined, MenuOutlined, PlusOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Space, Typography } from "antd";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import TaskModuleSidebar, { type TaskModuleView } from "../features/task-console/TaskModuleSidebar";
import WeComConnectionStatus from "../features/task-console/WeComConnectionStatus";
import type { TaskView } from "../features/task-console/mockTasks";
import AgentConsole from "./AgentConsole";
import WorkAutomation from "./WorkAutomation";
import WorkTodos from "./WorkTodos";

export default function WorkHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [todoCreateRequestId, setTodoCreateRequestId] = useState(0);
  const [automationCreateRequestId, setAutomationCreateRequestId] = useState(0);
  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const isTodos = searchParams.get("tab") === "todos";
  const isAutomation = searchParams.get("tab") === "automation";
  const rawView = searchParams.get("view");
  const taskView: "create" | TaskView = rawView === "create" || rawView === "sent" || rawView === "received"
    ? rawView
    : "all";
  const active: TaskModuleView = isTodos ? "todos" : isAutomation ? "automation" : taskView;

  const changeSection = (next: TaskModuleView) => {
    setMobileNavOpen(false);
    setTaskDetailOpen(false);
    if (next === "todos") {
      setSearchParams({ tab: "todos" });
      return;
    }
    if (next === "automation") {
      setSearchParams({ tab: "automation" });
      return;
    }
    setSearchParams(next === "all" ? {} : { view: next });
  };

  return (
    <div className="task-workspace">
      <Drawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        placement="left"
        width={248}
        className="task-workspace-mobile-drawer"
        styles={{ body: { padding: 0 } }}
      >
        <TaskModuleSidebar active={active} onChange={changeSection} />
      </Drawer>
      <main className="task-workspace-main">
        {taskView !== "create" && !taskDetailOpen && (
          <header className="task-workspace-header">
            <div className="task-workspace-title">
              <Button
                type="text"
                className="task-workspace-menu-button"
                icon={<MenuOutlined />}
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开任务导航"
              />
              <div>
                <Typography.Title level={2}>{isTodos ? "待办" : isAutomation ? "自动化" : "任务中心"}</Typography.Title>
                <Typography.Text type="secondary">
                  {isTodos
                    ? "集中处理需要跟进的个人与企业协作事项"
                    : isAutomation
                      ? "把重复工作配置成可复用、可追踪的自动化流程"
                      : "高效协作，让 AI 帮你完成更多工作"}
                </Typography.Text>
              </div>
            </div>
            <Space className="task-workspace-header-actions">
              <WeComConnectionStatus />
              {isTodos ? (
                <>
                  <Button onClick={() => navigate("/connectors?section=wecom&tab=cli")}>企业微信连接</Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setTodoCreateRequestId((value) => value + 1)}>创建待办</Button>
                </>
              ) : isAutomation ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setAutomationCreateRequestId((value) => value + 1)}>
                  新建自动化
                </Button>
              ) : (
                <>
                  <Button icon={<FileTextOutlined />} onClick={() => navigate("/skills?context=tasks")}>模板中心</Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => changeSection("create")}>新建任务</Button>
                </>
              )}
            </Space>
          </header>
        )}
        <div className={`task-workspace-content${taskDetailOpen ? " is-task-detail" : ""}`}>
          {isTodos
            ? <WorkTodos embedded createRequestId={todoCreateRequestId} />
            : isAutomation
              ? <WorkAutomation createRequestId={automationCreateRequestId} />
            : (
              <AgentConsole
                view={taskView}
                onViewChange={changeSection}
                onDetailChange={setTaskDetailOpen}
              />
            )}
        </div>
      </main>
    </div>
  );
}
