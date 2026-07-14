import { Avatar } from "antd";
import type { Agent } from "../api/client";
import { brand } from "../theme/brand";

interface Props {
  question: string;
  agents: Agent[];
  activeAgentId: number | null;
  size?: number;
}

/** 圆桌可视化:中心大圆为核心问题,四周小圆为参会 Agent,当前发言者高亮。 */
export default function RoundTable({ question, agents, activeAgentId, size = 360 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 46;
  const bigR = 62;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        margin: "0 auto",
      }}
    >
      {/* 连线 */}
      <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
        {agents.map((a, i) => {
          const ang = (2 * Math.PI * i) / Math.max(agents.length, 1) - Math.PI / 2;
          const x = cx + radius * Math.cos(ang);
          const y = cy + radius * Math.sin(ang);
          const active = a.id === activeAgentId;
          return (
            <line
              key={a.id}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={active ? brand.gold : brand.borderLight}
              strokeWidth={active ? 2.5 : 1}
              strokeDasharray={active ? "0" : "4 4"}
            />
          );
        })}
      </svg>

      {/* 中心大圆:核心问题 */}
      <div
        style={{
          position: "absolute",
          left: cx - bigR,
          top: cy - bigR,
          width: bigR * 2,
          height: bigR * 2,
          borderRadius: "50%",
          background: brand.gradientGold,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 12,
          fontSize: 12,
          fontWeight: 600,
          boxShadow: "0 6px 24px rgba(196, 146, 74, 0.35)",
        }}
      >
        {question.length > 28 ? question.slice(0, 28) + "…" : question}
      </div>

      {/* 四周 Agent 小圆 */}
      {agents.map((a, i) => {
        const ang = (2 * Math.PI * i) / Math.max(agents.length, 1) - Math.PI / 2;
        const x = cx + radius * Math.cos(ang);
        const y = cy + radius * Math.sin(ang);
        const active = a.id === activeAgentId;
        return (
          <div
            key={a.id}
            style={{
              position: "absolute",
              left: x - 30,
              top: y - 30,
              width: 60,
              textAlign: "center",
              transition: "transform .2s",
              transform: active ? "scale(1.15)" : "scale(1)",
            }}
          >
            <Avatar
              size={48}
              style={{
                background: active ? brand.gold : brand.bgElevated,
                border: active ? `2px solid ${brand.gold}` : `1px solid ${brand.borderLight}`,
                fontSize: 22,
                boxShadow: active ? "0 0 0 6px rgba(196, 146, 74, 0.2)" : "none",
              }}
            >
              {a.emoji}
            </Avatar>
            <div style={{ fontSize: 11, marginTop: 2, color: active ? brand.goldPale : brand.textMuted }}>
              {a.name}
              {active && " 💬"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
