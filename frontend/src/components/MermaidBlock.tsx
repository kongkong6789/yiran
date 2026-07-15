import { useEffect, useId, useRef, useState } from "react";

type Props = {
  code: string;
};

/** 懒加载渲染 mermaid 代码块（流程图等） */
export default function MermaidBlock({ code }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId().replace(/:/g, "");
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const raw = (code || "").trim();
      if (!raw || !hostRef.current) return;
      setErr("");
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
        });
        const id = `mmd-${reactId}-${Date.now().toString(36)}`;
        const { svg } = await mermaid.render(id, raw);
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "流程图渲染失败");
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
        <div className="agent-md-mermaid-err">流程图未能渲染：{err}</div>
        <pre className="agent-md-pre"><code className="language-mermaid">{code}</code></pre>
      </div>
    );
  }

  return <div className="agent-md-mermaid" ref={hostRef} />;
}
