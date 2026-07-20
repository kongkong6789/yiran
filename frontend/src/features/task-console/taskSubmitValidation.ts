import type { Agent } from "../../api/client";
import {
  isExecutionFieldPending,
  type ExecutionField,
} from "./executionFields";
import type { TaskAssignmentValue } from "./mockWeCom";

export function collectSubmitBlockers(input: {
  text: string;
  selectedAgent?: Agent;
  executionFields: ExecutionField[];
  assignment: TaskAssignmentValue;
}): string[] {
  const blockers: string[] = [];
  if (!input.text.trim()) blockers.push("任务指令");
  if (!input.selectedAgent) blockers.push("执行智能体");
  input.executionFields
    .filter(isExecutionFieldPending)
    .forEach((field) => blockers.push(field.label));
  if (input.assignment.notificationMode === "person" && input.assignment.assigneeIds.length === 0) {
    blockers.push("任务负责人");
  }
  if (input.assignment.notificationMode === "group" && !input.assignment.groupId) {
    blockers.push("通知群聊");
  }
  return blockers;
}

export function formatBlockerMessage(blockers: string[]): string {
  if (blockers.length === 0) return "";
  if (blockers.length === 1) {
    const item = blockers[0];
    if (item === "任务指令") return "请先输入任务指令";
    if (item === "执行智能体") return "请先选择执行智能体";
    if (item === "任务负责人") return "请先选择任务负责人";
    if (item === "通知群聊") return "请先选择通知群聊";
    return `请先${item.startsWith("请") ? item : `选择${item}`}`;
  }
  return `请先完成：${blockers.join("、")}`;
}
