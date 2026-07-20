import { Typography } from "antd";
import {
  CheckCircleOutlined, ClockCircleOutlined, DatabaseOutlined,
  MessageOutlined, PlayCircleOutlined, TeamOutlined,
} from "@ant-design/icons";

const PREVIEW_STEPS = [
  { icon: <PlayCircleOutlined />, title: "解析任务指令", detail: "识别任务意图与所需执行信息" },
  { icon: <CheckCircleOutlined />, title: "确认执行信息", detail: "校验数据日期、范围与输出方式" },
  { icon: <DatabaseOutlined />, title: "准备并同步数据", detail: "从业务系统拉取最新数据上下文" },
  { icon: <ClockCircleOutlined />, title: "运行 SOP", detail: "按编排流程执行并通过安全闸机" },
  { icon: <TeamOutlined />, title: "创建并分配任务", detail: "生成任务记录并匹配负责人" },
  { icon: <MessageOutlined />, title: "发送企业微信通知", detail: "将任务消息推送给指定成员或群聊" },
];

export default function ExecutionEmptyState() {
  return (
    <div className="task-execution-preview">
      <div className="task-execution-preview-intro">
        <Typography.Title level={5}>运行后将在这里查看完整过程</Typography.Title>
        <Typography.Text type="secondary">
          左侧填写任务信息并确认后，执行进度与结果会在此展示。
        </Typography.Text>
      </div>
      <ol className="task-execution-preview-steps">
        {PREVIEW_STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="task-execution-preview-index">{index + 1}</span>
            <div className="task-execution-preview-content">
              <span className="task-execution-preview-icon">{step.icon}</span>
              <div className="task-execution-preview-copy">
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <Typography.Text type="secondary" className="task-execution-preview-foot">
        任务完成后，还将在这里展示交付文件、业务结果和需要关注的问题。
      </Typography.Text>
    </div>
  );
}
