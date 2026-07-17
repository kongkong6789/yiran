import type { ReactNode } from "react";
import { api } from "../../api/client";
import TaskArtifactPreview from "./TaskArtifactPreview";
import type { ArtifactPreviewMeta } from "./artifactPreview";

interface ArtifactPreviewModal {
  info: (config: {
    title?: ReactNode;
    width?: number | string;
    centered?: boolean;
    closable?: boolean;
    maskClosable?: boolean;
    footer?: null;
    className?: string;
    content?: ReactNode;
  }) => unknown;
}

export async function openArtifactPreview(
  modal: ArtifactPreviewModal,
  url: string,
  name: string,
  meta: ArtifactPreviewMeta = {},
  onError?: (message: string) => void,
) {
  try {
    const response = await api.get(url, { responseType: "text" });
    const content = typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2);
    modal.info({
      title: name,
      width: 860,
      centered: true,
      closable: true,
      maskClosable: true,
      footer: null,
      className: "task-artifact-preview-modal",
      content: <TaskArtifactPreview content={content} meta={{ ...meta, name }} />,
    });
  } catch (error: any) {
    onError?.(error?.response?.data?.detail || "产物预览失败");
  }
}
