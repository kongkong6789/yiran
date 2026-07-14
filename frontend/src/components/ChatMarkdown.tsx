import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAuthToken } from "../api/client";

function isReportLike(content: string): boolean {
  return /分析报告|品牌分析|##\s*结论|###\s*结论|可落地建议|数据附录/.test(content);
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
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="agent-md-pre">
          <code className={className}>{children}</code>
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
  variant?: "default" | "auto" | "report";
};

export default function ChatMarkdown({ content, variant = "auto" }: Props) {
  const asReport = variant === "report" || (variant === "auto" && isReportLike(content));

  const body = (
    <div className={`agent-md-root${asReport ? " report" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );

  if (asReport) {
    return <article className="agent-report-card">{body}</article>;
  }
  return body;
}

export { isReportLike };
