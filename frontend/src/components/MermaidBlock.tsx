import { useEffect, useId, useRef, useState } from "react";

type Props = {
  code: string;
};

/** Normalize LLM-ish Mermaid so pie/flowchart labels with curly quotes still render. */
export function sanitizeMermaidSource(code: string): string | null {
  let text = (code || "").trim();
  if (!text) return null;
  const head = (text.split(/\r?\n/, 1)[0] || "").trim().toLowerCase();
  if (head.startsWith("xychart") || head.startsWith("quadrant")) return null;
  text = text
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'")
    .replace(/\uff02/g, '"')
    .replace(/\uff07/g, "'");
  // "标签"：40 -> "标签" : 40
  text = text.replace(/("([^"\\]|\\.)*")\s*[：:]\s*/g, "$1 : ");
  return text;
}

/** 懒加载渲染 mermaid 代码块（流程图等） */
export default function MermaidBlock({ code }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId().replace(/:/g, "");
  const [err, setErr] = useState("");
  const [fallbackCode, setFallbackCode] = useState(code);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const cleaned = sanitizeMermaidSource(code);
      if (!cleaned) {
        if (!cancelled) {
          setFallbackCode(code);
          setErr("该图表语法暂不稳定，已跳过自动渲染，请以下方文字/表格为准。");
        }
        return;
      }
      if (!hostRef.current) return;
      setErr("");
      setFallbackCode(cleaned);
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
        });
        const id = `mmd-${reactId}-${Date.now().toString(36)}`;
        const { svg } = await mermaid.render(id, cleaned);
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "流程图渲染失败";
          // Avoid dumping long lexer stacks into chat.
          const short =
            message.includes("Lexer error") || message.includes("Parse error")
              ? "图表语法有误（常见于中文引号），已显示源码供核对。"
              : message;
          setErr(short);
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (err) {
    return (
      <div className="agent-md-mermaid-fallback">
        <div className="agent-md-mermaid-err">{err.startsWith("流程图") ? err : `流程图未能渲染：${err}`}</div>
        <pre className="agent-md-pre"><code className="language-mermaid">{fallbackCode}</code></pre>
      </div>
    );
  }

  return <div className="agent-md-mermaid" ref={hostRef} />;
}
