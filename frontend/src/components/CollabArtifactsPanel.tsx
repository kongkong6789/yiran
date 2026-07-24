import { useEffect, useMemo, useState } from "react";
import {
  CloseOutlined,
  CodeOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { Button, Empty, Tooltip } from "antd";
import type { CollabMessage } from "../api/client";
import ChatMarkdown from "./ChatMarkdown";
import "./CollabArtifactsPanel.css";

type ArtifactKind = "image" | "pdf" | "spreadsheet" | "document" | "markdown" | "html" | "text" | "file";

export type CollabArtifact = {
  id: string;
  name: string;
  kind: ArtifactKind;
  size: number;
  createdAt: string;
  messageId: number;
  previewUrl?: string;
  downloadUrl?: string;
};

type PreviewPayload = {
  kind?: "spreadsheet" | "document" | "markdown" | "html" | "text" | "unsupported" | "error";
  text?: string;
  html?: string;
  message?: string;
  sheets?: Array<{ name: string; rows: string[][] }>;
};

type CollabArtifactsPanelProps = {
  messages: CollabMessage[];
  attachmentUrl: (url?: string, download?: boolean) => string;
  onClose: () => void;
  onJumpToMessage?: (messageId: number) => void;
  selectedArtifactId?: string;
  onSelectArtifact?: (artifactId: string) => void;
};

function artifactKind(name: string, mime = ""): ArtifactKind {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "tsv"].includes(ext)) return "spreadsheet";
  if (["doc", "docx"].includes(ext)) return "document";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["html", "htm"].includes(ext)) return "html";
  if (mime.startsWith("text/") || ["txt", "json", "xml", "yaml", "yml", "log", "py"].includes(ext)) return "text";
  return "file";
}

export function collabArtifactId(messageId: number, attachmentId: string) {
  return `attachment-${messageId}-${attachmentId}`;
}

export function buildCollabArtifacts(
  messages: CollabMessage[],
  attachmentUrl: (url?: string, download?: boolean) => string,
): CollabArtifact[] {
  const artifacts: CollabArtifact[] = [];
  for (const message of messages) {
    if (message.status === "deleted" || message.status === "recalled" || message.msg_type !== "ai") continue;
    for (const attachment of message.attachments || []) {
      if (!attachment.url) continue;
      artifacts.push({
        id: collabArtifactId(message.id, attachment.id),
        name: attachment.name || "AI 产物",
        kind: artifactKind(attachment.name || "", attachment.mime || ""),
        size: attachment.size || 0,
        createdAt: message.created_at,
        messageId: message.id,
        previewUrl: attachmentUrl(attachment.url),
        downloadUrl: attachmentUrl(attachment.url, true),
      });
    }
  }
  return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function artifactIcon(kind: ArtifactKind) {
  if (kind === "image") return <FileImageOutlined />;
  if (kind === "pdf") return <FilePdfOutlined />;
  if (kind === "spreadsheet") return <FileExcelOutlined />;
  if (kind === "markdown") return <FileMarkdownOutlined />;
  if (kind === "html") return <CodeOutlined />;
  return <FileTextOutlined />;
}

function artifactKindLabel(kind: ArtifactKind) {
  const labels: Record<ArtifactKind, string> = {
    image: "图片",
    pdf: "PDF",
    spreadsheet: "表格",
    document: "文档",
    markdown: "Markdown",
    html: "网页",
    text: "文本",
    file: "文件",
  };
  return labels[kind];
}

function previewEndpoint(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}preview=1`;
}

export function CollabArtifactsPanel({
  messages,
  attachmentUrl,
  onClose,
  onJumpToMessage,
  selectedArtifactId,
  onSelectArtifact,
}: CollabArtifactsPanelProps) {
  const artifacts = useMemo(
    () => buildCollabArtifacts(messages, attachmentUrl),
    [attachmentUrl, messages],
  );
  const [localSelectedId, setLocalSelectedId] = useState<string>("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const activeSelectedId = selectedArtifactId ?? localSelectedId;
  const selected = artifacts.find((item) => item.id === activeSelectedId) || artifacts[0] || null;

  useEffect(() => {
    if (!artifacts.length) {
      if (selectedArtifactId === undefined) setLocalSelectedId("");
      return;
    }
    if (!artifacts.some((item) => item.id === activeSelectedId)) {
      if (onSelectArtifact) onSelectArtifact(artifacts[0].id);
      else setLocalSelectedId(artifacts[0].id);
    }
  }, [activeSelectedId, artifacts, onSelectArtifact, selectedArtifactId]);

  useEffect(() => {
    setPreview(null);
    if (
      !selected
      || !selected.previewUrl
      || selected.kind === "image"
      || selected.kind === "pdf"
      || selected.kind === "file"
    ) {
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    const url = selected.kind === "html"
      ? selected.previewUrl
      : previewEndpoint(selected.previewUrl);
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (selected.kind === "html") {
          return { kind: "html", html: await response.text() } as PreviewPayload;
        }
        return response.json() as Promise<PreviewPayload>;
      })
      .then(setPreview)
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setPreview({ kind: "error", message: "预览加载失败，可下载后查看。" });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  return (
    <aside className="collab-artifacts" aria-label="AI 产物侧边栏">
      <header className="collab-artifacts__head">
        <div>
          <span className="collab-artifacts__glyph"><FolderOpenOutlined /></span>
          <span>
            <strong>AI 产物</strong>
            <small>{artifacts.length ? `${artifacts.length} 个真实文件` : "仅收集 AI 生成的文件"}</small>
          </span>
        </div>
        <Tooltip title="收起产物栏" placement="left">
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} aria-label="收起产物栏" />
        </Tooltip>
      </header>

      {!artifacts.length ? (
        <div className="collab-artifacts__empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <span>
                暂无 AI 文件产物
                <small>AI 生成并返回的表格、文档、PDF 或图片会显示在这里；普通对话不会被收录。</small>
              </span>
            )}
          />
        </div>
      ) : (
        <>
          <div className="collab-artifacts__list" role="listbox" aria-label="产物列表">
            {artifacts.map((artifact) => (
              <button
                type="button"
                key={artifact.id}
                className={artifact.id === selected?.id ? "is-active" : ""}
                onClick={() => {
                  if (onSelectArtifact) onSelectArtifact(artifact.id);
                  else setLocalSelectedId(artifact.id);
                }}
                role="option"
                aria-selected={artifact.id === selected?.id}
              >
                <span className={`is-${artifact.kind}`}>{artifactIcon(artifact.kind)}</span>
                <span>
                  <strong>{artifact.name}</strong>
                  <small>
                    {artifactKindLabel(artifact.kind)} · {fileSize(artifact.size)} · {new Date(artifact.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </small>
                </span>
              </button>
            ))}
          </div>

          {selected ? (
            <section className="collab-artifacts__preview" aria-label={`${selected.name} 预览`}>
              <div className="collab-artifacts__preview-head">
                <span>
                  <strong>{selected.name}</strong>
                  <small>AI 生成 · {artifactKindLabel(selected.kind)}</small>
                </span>
                <span>
                  {onJumpToMessage ? (
                    <Button type="link" size="small" onClick={() => onJumpToMessage(selected.messageId)}>
                      定位消息
                    </Button>
                  ) : null}
                  <Tooltip title="下载产物">
                    <Button
                      type="text"
                      size="small"
                      icon={<DownloadOutlined />}
                      href={selected.downloadUrl}
                      download={selected.name}
                      aria-label="下载产物"
                    >
                      下载
                    </Button>
                  </Tooltip>
                </span>
              </div>

              <div className="collab-artifacts__preview-body">
                {selected.kind === "image" && selected.previewUrl ? (
                  <img src={selected.previewUrl} alt={selected.name} />
                ) : selected.kind === "pdf" && selected.previewUrl ? (
                  <iframe src={selected.previewUrl} title={selected.name} />
                ) : selected.kind === "html" && preview?.html ? (
                  <iframe
                    sandbox=""
                    srcDoc={preview.html}
                    title={selected.name}
                    referrerPolicy="no-referrer"
                  />
                ) : previewLoading ? (
                  <div className="collab-artifacts__loading"><LoadingOutlined spin /> 正在生成预览…</div>
                ) : preview?.kind === "spreadsheet" ? (
                  <div className="collab-artifacts__sheets">
                    {(preview.sheets || []).map((sheet) => (
                      <section key={sheet.name}>
                        <strong>{sheet.name}</strong>
                        <div>
                          <table>
                            <tbody>
                              {sheet.rows.map((row, rowIndex) => (
                                <tr key={`${sheet.name}-${rowIndex}`}>
                                  {row.map((cell, cellIndex) => (
                                    <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : preview?.text ? (
                  preview.kind === "markdown" ? (
                    <div className="collab-artifacts__markdown"><ChatMarkdown content={preview.text} /></div>
                  ) : <pre>{preview.text}</pre>
                ) : (
                  <div className="collab-artifacts__unsupported">
                    {artifactIcon(selected.kind)}
                    <strong>暂不支持完整在线预览</strong>
                    <span>{preview?.message || "可以下载文件后使用本地应用打开。"}</span>
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}
