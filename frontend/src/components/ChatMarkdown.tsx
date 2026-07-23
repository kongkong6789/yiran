import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAuthToken } from "../api/client";
import MermaidBlock from "./MermaidBlock";

function isReportLike(content: string): boolean {
  return /分析报告|品牌分析|##\s*结论|###\s*结论|可落地建议|数据附录/.test(content);
}

/** 有标题 / 列表 / 表格 / 代码块时，适合块状 HTML 展示 */
function looksBlocky(content: string): boolean {
  return /(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*+]\s+\S|(^|\n)\s*\d+\.\s+\S|```|\|[^\n]+\|/.test(content);
}

/** 按 ## / ### 切成独立区块，便于卡片式排版 */
function splitIntoSections(md: string): string[] {
  const trimmed = md.trim();
  if (!trimmed) return [];
  const chunks = trimmed
    .split(/(?=^#{2,3}\s)/m)
    .map((s) => s.trim())
    .filter(Boolean);
  return chunks.length > 1 ? chunks : [trimmed];
}

/** 附件图 URL 补 ?token=，便于 <img> 直链拉取 */
function withAuthToken(src?: string): string {
  if (!src) return "";
  if (!src.includes("/api/agent/attachments/")) return src;
  if (/[?&]token=/.test(src)) return src;
  const token = getAuthToken();
  if (!token) return src;
  const joiner = src.includes("?") ? "&" : "?";
  return `${src}${joiner}token=${encodeURIComponent(token)}`;
}

const mdComponents: Components = {
  h1: ({ children }) => <h1 className="agent-md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="agent-md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="agent-md-h3">{children}</h3>,
  h4: ({ children }) => <h4 className="agent-md-h4">{children}</h4>,
  p: ({ children }) => <p className="agent-md-p">{children}</p>,
  strong: ({ children }) => <strong className="agent-md-strong">{children}</strong>,
  em: ({ children }) => <em className="agent-md-em">{children}</em>,
  hr: () => <hr className="agent-md-hr" />,
  ul: ({ children }) => <ul className="agent-md-list">{children}</ul>,
  ol: ({ children }) => <ol className="agent-md-list ordered">{children}</ol>,
  li: ({ children }) => <li className="agent-md-li">{children}</li>,
  blockquote: ({ children }) => <blockquote className="agent-md-quote">{children}</blockquote>,
  table: ({ children }) => (
    <div className="agent-md-table-wrap">
      <table className="agent-md-table">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
  code: ({ node, className, children }) => {
    const lang = /language-([\w-]+)/.exec(className || "")?.[1] || "";
    const text = String(children ?? "").replace(/\n$/, "");
    const isBlock = Boolean(className?.includes("language-"))
      || Boolean(node?.position && node.position.start.line < node.position.end.line)
      || String(children ?? "").includes("\n");
    if (lang === "mermaid") {
      return <MermaidBlock code={text} />;
    }
    if (isBlock) {
      return (
        <pre className="agent-md-pre">
          <code className={className || undefined}>{children}</code>
        </pre>
      );
    }
    return <code className="agent-md-code">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => (
    <a className="agent-md-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img className="agent-md-img" src={withAuthToken(src)} alt={alt || "生成图片"} loading="lazy" />
  ),
};

type Props = {
  content: string;
  /** default=行内排版；blocks=HTML 分块卡片；report=报告样式；auto=智能选择 */
  variant?: "default" | "auto" | "report" | "blocks";
};

function MdBody({ content, report }: { content: string; report?: boolean }) {
  return (
    <div className={`agent-md-root${report ? " report" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatMarkdown({ content, variant = "auto" }: Props) {
  const blocky = looksBlocky(content);
  const asReport = variant === "report" || (variant === "auto" && isReportLike(content));
  const asBlocks = variant === "blocks"
    || asReport
    || (variant === "auto" && blocky);

  if (!asBlocks) {
    return <MdBody content={content} />;
  }

  const sections = splitIntoSections(content);
  const multi = sections.length > 1;

  return (
    <article className={`agent-report-card agent-md-blocks${asReport ? " is-report" : ""}`}>
      {multi ? (
        sections.map((sec, i) => (
          <section key={i} className={`agent-md-section${i === 0 ? " is-lead" : ""}`}>
            <MdBody content={sec} report={asReport} />
          </section>
        ))
      ) : (
        <section className="agent-md-section is-lead is-single">
          <MdBody content={content} report={asReport} />
        </section>
      )}
    </article>
  );
}

export { isReportLike, looksBlocky };
