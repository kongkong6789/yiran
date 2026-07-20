import {
  BellOutlined, ClockCircleOutlined, FileTextOutlined, RobotOutlined, SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Typography } from "antd";
import type { Agent } from "../../api/client";
import type { ExecutionField } from "./executionFields";
import { executionFieldDisplayValue } from "./executionFields";
import type { TaskAssignmentValue } from "./mockWeCom";
import WeComConnectionStatus from "./WeComConnectionStatus";
import { authenticatedAvatarUrl } from "../../utils/avatar";

const fieldValue = (fields: ExecutionField[], key: string, fallback: string) => {
  const field = fields.find((item) => item.key === key);
  return field?.value ? executionFieldDisplayValue(field) : fallback;
};

export default function TaskPreviewPanel({
  text,
  agent,
  fields,
  assignment,
  blockers,
  loading,
  onSubmit,
}: {
  text: string;
  agent?: Agent;
  fields: ExecutionField[];
  assignment: TaskAssignmentValue;
  blockers: string[];
  loading: boolean;
  onSubmit: () => void;
}) {
  const notification = assignment.notificationMode === "person"
    ? "企业微信个人通知"
    : assignment.notificationMode === "group"
      ? "企业微信群聊通知"
      : "暂不通知";
  const taskType = fieldValue(fields, "output_type", "系统自动识别");
  const dataScope = fieldValue(fields, "scope", "按任务内容识别");

  return (
    <aside className="task-create-preview">
      <div className="task-create-preview-heading">
        <div>
          <Typography.Title level={5}>任务预览</Typography.Title>
          <Typography.Text type="secondary">发起前核对关键信息</Typography.Text>
        </div>
        <WeComConnectionStatus />
      </div>
      <div className="task-create-preview-title">
        <span><FileTextOutlined /></span>
        <div>
          <small>任务标题</small>
          <strong>{text.trim() || "尚未填写任务描述"}</strong>
        </div>
      </div>
      <dl className="task-create-preview-meta">
        <div><dt><RobotOutlined /> 任务类型</dt><dd>{taskType}</dd></div>
        <div><dt><ClockCircleOutlined /> 预计耗时</dt><dd>由实际数据量决定</dd></div>
        <div><dt><FileTextOutlined /> 涉及数据</dt><dd>{dataScope}</dd></div>
        <div><dt><UserOutlined /> 执行智能体</dt><dd>{agent?.name || "待系统匹配"}</dd></div>
        <div><dt><BellOutlined /> 通知方式</dt><dd>{notification}</dd></div>
      </dl>
      <div className="task-create-preview-output">
        <span>输出预览</span>
        <div className="task-output-thumbnail" aria-label="任务输出文档示意">
          <i /><i /><i /><i />
          <b />
        </div>
      </div>
      <div className="task-create-preview-owner">
        <span>负责人</span>
        <div>
          <Avatar.Group size={28}>
            {(assignment.assignees || []).slice(0, 3).map((member) => (
              <Avatar key={member.key} src={authenticatedAvatarUrl(member.avatar)} icon={!member.avatar ? <UserOutlined /> : undefined} />
            ))}
            {!assignment.assignees?.length && assignment.assigneeIds.slice(0, 3).map((id) => <Avatar key={id} icon={<UserOutlined />} />)}
          </Avatar.Group>
          <strong>{assignment.assigneeIds.length ? `${assignment.assigneeIds.length} 位负责人` : "尚未选择"}</strong>
        </div>
      </div>
      {blockers.length > 0 && (
        <button
          type="button"
          className="task-create-blocker-summary"
          onClick={() => {
            const target = document.querySelector<HTMLElement>(
              ".task-execution-field.is-pending, #task-command, .task-config-agent-field",
            );
            target?.scrollIntoView({ behavior: "smooth", block: "center" });
            target?.querySelector<HTMLElement>("input, textarea, button, [tabindex]")?.focus();
          }}
        >
          还需要补充 {blockers.length} 项：{blockers[0]}
        </button>
      )}
      <Button
        type="primary"
        size="large"
        block
        icon={<SendOutlined />}
        loading={loading}
        disabled={blockers.length > 0}
        onClick={onSubmit}
        className="task-create-preview-submit"
      >
        立即发起
      </Button>
    </aside>
  );
}
