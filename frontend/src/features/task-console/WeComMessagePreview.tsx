import { Collapse, Typography } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import { getCachedWeComGroups, getCachedWeComUsers, type TaskAssignmentValue } from "./mockWeCom";

interface Props {
  task: string;
  roleLabel: string;
  assignment: TaskAssignmentValue;
}

function deadlineLabel(raw: string) {
  if (!raw) return "未设置";
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return raw;
  return value.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function WeComMessagePreview({ task, roleLabel, assignment }: Props) {
  const people = getCachedWeComUsers().filter((member) => assignment.assigneeIds.includes(member.key));
  const group = getCachedWeComGroups().find((item) => item.key === assignment.groupId);
  const receiver = assignment.notificationMode === "person"
    ? people.map((member) => member.name).join("、") || "未选择"
    : group?.name || "未选择";

  return (
    <Collapse
      className="task-message-collapse"
      ghost
      items={[{
        key: "message",
        label: <span><MessageOutlined /> 消息预览</span>,
        children: (
          <div className="task-message-preview">
            <Typography.Text strong>【新任务通知】</Typography.Text>
            <p>任务：{task || "未填写"}</p>
            <p>{assignment.notificationMode === "person" ? "负责人" : "通知群聊"}：{receiver}</p>
            <p>执行智能体：{roleLabel}</p>
            <p>截止时间：{deadlineLabel(assignment.deadline)}</p>
            <p className="task-message-ending">任务已进入良策智能协作工作台，请及时处理。</p>
          </div>
        ),
      }]}
    />
  );
}
