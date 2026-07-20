import { useEffect, useState, type CSSProperties } from "react";

type Props = {
  /** empty = 未选会话；backdrop = 聊天时背景 */
  variant?: "empty" | "backdrop";
  className?: string;
};

const SEATS = [
  { id: 0, label: "成员1", color: "#5B7C99" },
  { id: 1, label: "成员2", color: "#7A8F6B" },
  { id: 2, label: "成员3", color: "#8B6B5C" },
  { id: 3, label: "成员4", color: "#6B7A99" },
  { id: 4, label: "成员5", color: "#9A7B4F" },
  { id: 5, label: "成员6", color: "#5C7A7A" },
  { id: 6, label: "成员7", color: "#8B6B7A" },
  { id: 7, label: "成员8", color: "#6B6B8B" },
];

const BUBBLES = [
  { seat: 0, text: "这条口径对齐了吗？" },
  { seat: 2, text: "数据口径差一天…" },
  { seat: 5, text: "先暂停对外承诺" },
  { seat: 1, text: "我再核一遍证据" },
  { seat: 7, text: "风险偏黄，留意" },
  { seat: 3, text: "方案 B 可行" },
  { seat: 4, text: "@AI 怎么看？" },
  { seat: 6, text: "先对齐目标" },
];

const AI_NOTES = [
  "旁路扫描中…",
  "口径一致性",
  "未发现红旗",
  "关注黄旗信号",
  "证据链核验",
];

export default function CollabRoundTable({ variant = "empty", className = "" }: Props) {
  const [bubbleIdx, setBubbleIdx] = useState(0);
  const [aiIdx, setAiIdx] = useState(0);
  const [bubbleKey, setBubbleKey] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t1 = window.setInterval(() => {
      setBubbleIdx((i) => (i + 1) % BUBBLES.length);
      setBubbleKey((k) => k + 1);
    }, 2800);
    const t2 = window.setInterval(() => {
      setAiIdx((i) => (i + 1) % AI_NOTES.length);
    }, 3600);
    return () => {
      window.clearInterval(t1);
      window.clearInterval(t2);
    };
  }, []);

  const active = BUBBLES[bubbleIdx];
  const isBackdrop = variant === "backdrop";

  return (
    <div
      className={`crt ${isBackdrop ? "crt--backdrop" : "crt--empty"} ${className}`}
      aria-hidden
    >
      <div className="crt-stage">
        <div className="crt-floor" />

        {/* 圆木桌 */}
        <div className="crt-table">
          <div className="crt-table-top" />
          <div className="crt-radar" />
          <div className="crt-ai">
            <div className="crt-ai-orb">AI</div>
            <div className="crt-ai-note" key={aiIdx}>{AI_NOTES[aiIdx]}</div>
          </div>
        </div>

        {/* 8 人围坐：整层旋转轨道，座位落在圆环上 */}
        {SEATS.map((seat, i) => (
          <div
            key={seat.id}
            className={`crt-orbit${active.seat === i ? " is-speaking" : ""}`}
            style={{ "--i": i, "--c": seat.color } as CSSProperties}
          >
            <div className="crt-person">
              <span className="crt-avatar">{i + 1}</span>
              <span className="crt-name">{seat.label}</span>
            </div>
          </div>
        ))}

        <div
          key={bubbleKey}
          className="crt-orbit crt-orbit--bubble"
          style={{ "--i": active.seat } as CSSProperties}
        >
          <div className="crt-bubble">{active.text}</div>
        </div>
      </div>

      {!isBackdrop && (
        <p className="crt-caption">圆桌协作 · 中央 AI 旁路监控</p>
      )}

      <style>{`
        .crt {
          display: block;
          width: 400px;
          max-width: 100%;
          pointer-events: none;
          user-select: none;
          flex-shrink: 0;
        }
        .crt--backdrop { opacity: 0.92; }
        .crt-stage {
          position: relative;
          width: 400px;
          height: 400px;
          margin: 0 auto;
        }
        .crt--backdrop .crt-stage {
          width: 440px;
          height: 440px;
        }
        .crt-floor {
          position: absolute;
          left: 50%;
          top: 52%;
          width: 82%;
          height: 62%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(196,146,74,0.2), rgba(61,111,168,0.08) 48%, transparent 72%);
        }
        .crt-table {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 44%;
          height: 44%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          z-index: 2;
        }
        .crt-table-top {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(circle at 38% 30%, #f8f1e4, #ddc49a 45%, #c39a5c 78%, #9d7440 100%);
          border: 3px solid #7d5c32;
          box-shadow:
            0 16px 30px rgba(11,33,68,0.18),
            inset 0 2px 8px rgba(255,255,255,0.5),
            inset 0 -10px 18px rgba(90,60,20,0.2);
        }
        .crt-table-top::after {
          content: "";
          position: absolute;
          inset: 16%;
          border-radius: 50%;
          border: 1.5px dashed rgba(90,60,20,0.3);
        }
        .crt-radar {
          position: absolute;
          inset: -10%;
          border-radius: 50%;
          background: conic-gradient(from 0deg, transparent 0deg, rgba(61,111,168,0.38) 48deg, transparent 115deg);
          animation: crt-spin 5s linear infinite;
          z-index: 1;
        }
        .crt-ai {
          position: absolute;
          inset: 0;
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }
        .crt-ai-orb {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 15px;
          font-weight: 800;
          color: #fff;
          background: linear-gradient(145deg, #0B2144, #3D6FA8 55%, #C4924A);
          box-shadow: 0 0 0 5px rgba(196,146,74,0.38), 0 0 24px rgba(61,111,168,0.5);
          animation: crt-pulse 2.6s ease-in-out infinite;
        }
        .crt-ai-note {
          font-size: 11px;
          font-weight: 650;
          color: var(--lc-ink);
          background: var(--lc-surface-raised);
          padding: 2px 9px;
          border-radius: 999px;
          border: 1px solid rgba(61,111,168,0.28);
          white-space: nowrap;
          animation: crt-fade 0.45s ease;
        }

        /* 整层等于舞台大小；旋转后把人放到靠上沿，形成圆桌围坐 */
        .crt-orbit {
          position: absolute;
          inset: 0;
          z-index: 4;
          transform: rotate(calc(var(--i) * 45deg));
          pointer-events: none;
        }
        .crt-orbit.is-speaking { z-index: 6; }
        .crt-person {
          position: absolute;
          left: 50%;
          top: 6%;
          transform: translateX(-50%) rotate(calc(var(--i) * -45deg));
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .crt-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 15px;
          font-weight: 700;
          color: var(--lc-ink);
          background: var(--lc-surface-raised);
          border: 2.5px solid var(--c, #5B7C99);
          box-shadow: 0 4px 12px rgba(11,33,68,0.16);
        }
        .crt-orbit.is-speaking .crt-avatar {
          transform: scale(1.1);
          box-shadow: 0 0 0 4px rgba(196,146,74,0.42), 0 4px 14px rgba(11,33,68,0.16);
        }
        .crt-name {
          font-size: 12px;
          font-weight: 650;
          color: var(--lc-ink);
          background: var(--lc-surface-raised);
          padding: 1px 8px;
          border-radius: 999px;
          border: 1px solid #d7e0ec;
          white-space: nowrap;
        }

        .crt-orbit--bubble { z-index: 7; }
        .crt-bubble {
          position: absolute;
          left: 50%;
          top: 1%;
          transform: translateX(-50%) rotate(calc(var(--i) * -45deg));
          width: max-content;
          max-width: 168px;
          padding: 7px 12px;
          border-radius: 12px 12px 12px 4px;
          background: var(--lc-surface-raised);
          border: 1.5px solid rgba(61,111,168,0.4);
          box-shadow: 0 8px 20px rgba(11,33,68,0.16);
          font-size: 12px;
          font-weight: 500;
          line-height: 1.35;
          color: var(--lc-ink);
          white-space: nowrap;
          word-break: keep-all;
          animation: crt-bubble 2.7s ease forwards;
        }

        .crt-caption {
          margin: 12px 0 0;
          text-align: center;
          font-size: 13px;
          font-weight: 500;
          color: var(--lc-text-secondary);
        }

        @keyframes crt-spin { to { transform: rotate(360deg); } }
        @keyframes crt-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes crt-fade {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes crt-bubble {
          0% { opacity: 0; }
          14% { opacity: 1; }
          78% { opacity: 1; }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .crt-radar, .crt-ai-orb, .crt-bubble, .crt-ai-note { animation: none !important; }
          .crt-bubble { opacity: 0.92; }
        }
        @media (max-width: 520px) {
          .crt, .crt-stage, .crt--backdrop .crt-stage {
            width: 300px;
            height: 300px;
          }
          .crt-ai-orb { width: 42px; height: 42px; font-size: 13px; }
          .crt-avatar { width: 34px; height: 34px; font-size: 13px; }
        }
      `}</style>
    </div>
  );
}
