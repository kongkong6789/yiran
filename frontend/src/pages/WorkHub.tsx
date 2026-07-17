import { CheckSquareOutlined, FlagOutlined } from "@ant-design/icons";
import { Segmented, Typography } from "antd";
import { useSearchParams } from "react-router-dom";

import AgentConsole from "./AgentConsole";
import WorkTodos from "./WorkTodos";

type WorkSection = "tasks" | "todos";

export default function WorkHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section: WorkSection = searchParams.get("tab") === "todos" ? "todos" : "tasks";

  const changeSection = (value: string | number) => {
    const next = value as WorkSection;
    setSearchParams(next === "todos" ? { tab: "todos" } : {}, { replace: true });
  };

  return (
    <div className="work-hub-page">
      <div className="work-hub-header">
        <div className="work-hub-heading">
          <span className="work-hub-heading-mark">{section === "tasks" ? <FlagOutlined /> : <CheckSquareOutlined />}</span>
          <div>
            <Typography.Title level={3}>{section === "tasks" ? "任务工作台" : "待办工作台"}</Typography.Title>
            <Typography.Text type="secondary">
              {section === "tasks" ? "创建任务、跟踪执行过程与交付结果" : "集中处理个人待办与企业微信协作事项"}
            </Typography.Text>
          </div>
        </div>
        <Segmented
          value={section}
          onChange={changeSection}
          options={[
            { value: "tasks", label: "任务中心", icon: <FlagOutlined /> },
            { value: "todos", label: "待办中心", icon: <CheckSquareOutlined /> },
          ]}
        />
      </div>
      <div className="work-hub-content">
        {section === "tasks" ? <AgentConsole /> : <WorkTodos />}
      </div>
    </div>
  );
}
