import { useRef, type PointerEvent } from "react";
import {
  CheckCircleOutlined,
  CommentOutlined,
  FileTextOutlined,
  MessageOutlined,
  RobotOutlined,
  TeamOutlined,
} from "@ant-design/icons";

type CollabWelcomeProps = {
  onOpenContacts: () => void;
  onCreateGroup: () => void;
};

const FEATURES = [
  {
    icon: <MessageOutlined />,
    title: "引用回复",
    description: "像微信、QQ 一样保留原消息上下文",
  },
  {
    icon: <CheckCircleOutlined />,
    title: "已读状态",
    description: "群聊成员阅读进度清晰可追踪",
  },
  {
    icon: <FileTextOutlined />,
    title: "AI 智能纪要",
    description: "按最近话题与时间段自动判断总结范围",
  },
] as const;

export function CollabWelcome({
  onOpenContacts,
  onCreateGroup,
}: CollabWelcomeProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);

  const updateSpotlight = (event: PointerEvent<HTMLElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    surface.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
    surface.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
  };

  const resetSpotlight = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.style.removeProperty("--spotlight-x");
    surface.style.removeProperty("--spotlight-y");
  };

  return (
    <section
      ref={surfaceRef}
      className="collab-welcome"
      aria-labelledby="collab-welcome-title"
      onPointerMove={updateSpotlight}
      onPointerLeave={resetSpotlight}
    >
      <div className="collab-welcome-heading">
        <span className="collab-welcome-icon" aria-hidden="true">
          <CommentOutlined />
        </span>
        <span className="collab-welcome-kicker">MESSAGE HUB</span>
        <h2 id="collab-welcome-title">选择一个会话，继续协作</h2>
        <p>
          单聊和群聊共享引用、已读与 AI 纪要；圆桌保持独立会议上下文，
          切换时不会混入消息主场。
        </p>
      </div>

      <div className="collab-welcome-features" aria-label="消息协作能力">
        {FEATURES.map((feature) => (
          <article key={feature.title}>
            <span aria-hidden="true">{feature.icon}</span>
            <div>
              <strong>{feature.title}</strong>
              <p>{feature.description}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="collab-welcome-actions">
        <button
          type="button"
          className="collab-welcome-action is-primary"
          onClick={onCreateGroup}
        >
          <TeamOutlined aria-hidden="true" />
          <span>发起群聊</span>
        </button>
        <button
          type="button"
          className="collab-welcome-action is-secondary"
          onClick={onOpenContacts}
        >
          <span>打开通讯录</span>
          <span className="collab-welcome-action-arrow" aria-hidden="true">→</span>
        </button>
      </div>

      <p className="collab-welcome-ai-note">
        <RobotOutlined aria-hidden="true" />
        进入会话后，右侧会智能提醒是否需要总结
      </p>
    </section>
  );
}
