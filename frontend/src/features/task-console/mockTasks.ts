import { api } from "../../api/client";

export type TaskView = "all" | "sent" | "received";
export type TaskProgressStatus = "pending" | "running" | "completed" | "partial" | "failed";

export interface TaskArtifact {
  id: number;
  name: string;
  filename: string;
  format: string;
  size: string;
  preview_url?: string;
  download_url: string;
}

export interface PublishedTask {
  id: number;
  traceId: string;
  title: string;
  sopId: string;
  sender: string;
  senderAvatar?: string;
  senderId?: number;
  assignees: string[];
  assigneeMembers?: Array<{ id: number; name: string; avatarUrl: string }>;
  agentName?: string;
  deadline?: string | null;
  priority: "urgent" | "high" | "normal";
  priorityLabel: string;
  status: TaskProgressStatus;
  statusLabel: string;
  progress: number;
  updatedAt: string;
  notificationTarget: string;
  notificationMode?: "person" | "group" | "none" | string;
  notificationStatus: string;
  notificationRecordId?: number | null;
  artifacts: TaskArtifact[];
  createdAt?: string;
  timeline: Array<{
    title: string;
    time?: string;
    status: "waiting" | "running" | "completed" | "failed" | "skipped";
    detail: string;
  }>;
  taskSource?: "sent" | "received";
}

export async function getPublishedTasks(view: TaskView) {
  if (view === "all") {
    const [sent, received] = await Promise.all([
      getPublishedTasks("sent"),
      getPublishedTasks("received"),
    ]);
    const unique = new Map<number, PublishedTask>();
    sent.forEach((task) => unique.set(task.id, { ...task, taskSource: "sent" }));
    received.forEach((task) => {
      if (!unique.has(task.id)) unique.set(task.id, { ...task, taskSource: "received" });
    });
    return [...unique.values()].sort((a, b) => (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ));
  }
  return api.get<{ ok: boolean; count: number; results: PublishedTask[] }>("/tasks/", { params: { view } })
    .then((response) => response.data.results.map((task) => ({ ...task, taskSource: view })));
}
