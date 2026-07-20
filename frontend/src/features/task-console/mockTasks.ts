import { api } from "../../api/client";

export type TaskView = "sent" | "received";
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
  assignees: string[];
  deadline?: string | null;
  priority: "urgent" | "high" | "normal";
  priorityLabel: string;
  status: TaskProgressStatus;
  statusLabel: string;
  progress: number;
  updatedAt: string;
  notificationTarget: string;
  notificationStatus: string;
  notificationRecordId?: number | null;
  artifacts: TaskArtifact[];
  timeline: Array<{
    title: string;
    time?: string;
    status: "waiting" | "running" | "completed" | "failed";
    detail: string;
  }>;
}

export async function getPublishedTasks(view: TaskView) {
  return api.get<{ ok: boolean; count: number; results: PublishedTask[] }>("/tasks/", { params: { view } })
    .then((response) => response.data.results);
}
