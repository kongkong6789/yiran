import { Avatar } from "antd";
import type { Agent, CouncilHuman } from "../api/client";
import { authenticatedAvatarUrl } from "../utils/avatar";

export type RoundSeat =
  | { key: string; kind: "agent"; id: number; name: string; emoji: string; role?: string }
  | { key: string; kind: "human"; id: number; name: string; avatarUrl?: string | null; role?: string };

interface Props {
  question: string;
  agents: Agent[];
  humans?: CouncilHuman[];
  activeAgentId: number | null;
  hostName?: string;
  size?: number;
}

function buildSeats(agents: Agent[], humans: CouncilHuman[]): RoundSeat[] {
  return [
    ...humans.map((h) => ({
      key: `h-${h.id}`,
      kind: "human" as const,
      id: h.id,
      name: h.display_name || h.username,
      avatarUrl: h.avatar_url,
      role: "同事",
    })),
    ...agents.map((a) => ({
      key: `a-${a.id}`,
      kind: "agent" as const,
      id: a.id,
      name: a.name,
      emoji: a.emoji,
      role: a.role || "AI",
    })),
  ];
}

/** 木纹圆台 + 环形座位（对齐开会中舞台稿） */
export default function RoundTable({
  question,
  agents,
  humans = [],
  activeAgentId,
  hostName,
  size = 440,
}: Props) {
  const seats = buildSeats(agents, humans);
  const cx = size / 2;
  const cy = size / 2;
  const tableR = size * 0.28;
  const seatR = size * 0.38;

  return (
    <div className="rt-stage" style={{ width: size, height: size }}>
      <div
        className="rt-table"
        style={{
          width: tableR * 2,
          height: tableR * 2,
          left: cx - tableR,
          top: cy - tableR,
        }}
      >
        <div className="rt-table-inner">
          <div className="rt-table-label">
            {question.length > 36 ? `${question.slice(0, 36)}…` : question || "圆桌议题"}
          </div>
        </div>
      </div>

      {seats.map((s, i) => {
        const ang = (2 * Math.PI * i) / Math.max(seats.length, 1) - Math.PI / 2;
        const x = cx + seatR * Math.cos(ang);
        const y = cy + seatR * Math.sin(ang);
        const active = s.kind === "agent" && s.id === activeAgentId;
        const isHost = hostName && s.name === hostName;
        return (
          <div
            key={s.key}
            className={`rt-seat${active ? " is-active" : ""}${isHost ? " is-host" : ""}`}
            style={{ left: x - 36, top: y - 42 }}
          >
            <Avatar
              size={52}
              src={s.kind === "human" ? authenticatedAvatarUrl(s.avatarUrl) : undefined}
              className="rt-seat-avatar"
            >
              {s.kind === "agent" ? s.emoji : (s.name[0] || "?").toUpperCase()}
            </Avatar>
            <div className="rt-seat-name">{s.name.length > 6 ? `${s.name.slice(0, 6)}…` : s.name}</div>
            <div className="rt-seat-role">
              {isHost ? "主持人" : s.role || (s.kind === "agent" ? "AI" : "同事")}
              {active ? " · 发言中" : ""}
            </div>
          </div>
        );
      })}

      <style>{`
        .rt-stage {
          position: relative;
          margin: 0 auto;
        }
        .rt-table {
          position: absolute;
          border-radius: 50%;
          background:
            radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), transparent 45%),
            radial-gradient(circle at 50% 50%, #c4a06a 0%, #8b5a2b 55%, #5c3a1a 100%);
          box-shadow:
            0 18px 40px rgba(60, 35, 15, 0.28),
            inset 0 0 0 10px rgba(90, 50, 20, 0.35),
            inset 0 0 0 18px rgba(196, 160, 106, 0.25);
        }
        .rt-table-inner {
          position: absolute;
          inset: 18%;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 35%, #e8d2a8, #b8894f 70%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          text-align: center;
          box-shadow: inset 0 2px 8px rgba(255,255,255,0.25);
        }
        .rt-table-label {
          color: #3b2410;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.4;
        }
        .rt-seat {
          position: absolute;
          width: 72px;
          text-align: center;
          transition: transform .2s;
        }
        .rt-seat.is-active { transform: scale(1.08); }
        .rt-seat-avatar {
          border: 2px solid #fff !important;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
          background: #e8eef6 !important;
          font-size: 22px;
        }
        .rt-seat.is-active .rt-seat-avatar {
          border-color: #C4924A !important;
          box-shadow: 0 0 0 4px rgba(196, 146, 74, 0.28);
        }
        .rt-seat.is-host .rt-seat-avatar {
          border-color: #3D6FA8 !important;
        }
        .rt-seat-name {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 600;
          color: #172033;
        }
        .rt-seat-role {
          font-size: 10px;
          color: #7b879c;
        }
      `}</style>
    </div>
  );
}
