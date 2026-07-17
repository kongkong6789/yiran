import { Segmented } from "antd";
import { useMemo, useState } from "react";
import ChatMarkdown from "../../components/ChatMarkdown";
import JsonArtifactView, { JsonArtifactRawToggle } from "./JsonArtifactView";
import { inferArtifactPreviewKind, type ArtifactPreviewKind, type ArtifactPreviewMeta } from "./artifactPreview";

interface Props {
  content: string;
  meta?: ArtifactPreviewMeta;
}

export default function TaskArtifactPreview({ content, meta = {} }: Props) {
  const kind = useMemo(() => inferArtifactPreviewKind(meta, content), [content, meta]);
  const [view, setView] = useState<"readable" | "source">("readable");

  if (kind === "markdown") {
    return (
      <div className="task-artifact-preview-shell">
        <ChatMarkdown content={content} variant="report" />
      </div>
    );
  }

  if (kind === "json") {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }

    return (
      <div className="task-artifact-preview-shell">
        <div className="task-artifact-preview-toolbar">
          <Segmented
            size="small"
            value={view}
            onChange={(value) => setView(value as "readable" | "source")}
            options={[
              { label: "阅读视图", value: "readable" },
              { label: "原始 JSON", value: "source" },
            ]}
          />
        </div>
        {view === "readable" && parsed !== null
          ? (
            <>
              <JsonArtifactView data={parsed} />
              <JsonArtifactRawToggle raw={content} />
            </>
          )
          : <pre className="task-artifact-raw">{content}</pre>}
      </div>
    );
  }

  return (
    <div className="task-artifact-preview-shell">
      <pre className="task-artifact-text">{content}</pre>
    </div>
  );
}

export type { ArtifactPreviewKind, ArtifactPreviewMeta };
