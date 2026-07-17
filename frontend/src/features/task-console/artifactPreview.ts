export type ArtifactPreviewKind = "markdown" | "json" | "text";

export interface ArtifactPreviewMeta {
  name?: string;
  filename?: string;
  format?: string;
  type?: string;
}

export function inferArtifactPreviewKind(meta: ArtifactPreviewMeta, content?: string): ArtifactPreviewKind {
  const hint = `${meta.format || ""} ${meta.filename || ""} ${meta.name || ""} ${meta.type || ""}`.toLowerCase();
  if (hint.includes("markdown") || hint.includes(".md") || meta.type === "document") return "markdown";
  if (hint.includes("json") || hint.includes(".json") || meta.type === "data") return "json";
  if (content) {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch {
        return "text";
      }
    }
    if (/^#{1,6}\s/m.test(trimmed) || /^[-*]\s/m.test(trimmed) || /^\|.+\|/m.test(trimmed)) {
      return "markdown";
    }
  }
  return "text";
}

export function parseArtifactContent(content: string, kind: ArtifactPreviewKind): unknown {
  if (kind !== "json") return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}
