import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";

import Council, { type CouncilDraftSeed } from "./Council";
import CollabRisk, { type CollabRoundtableSeed } from "./CollabRisk";
import "../styles/teamCollaboration.css";

type CollaborationView = "chat" | "roundtable";
type CollaborationPanel = "chats" | "contacts";

const VIEW_META: Record<CollaborationView, {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
}> = {
  chat: {
    eyebrow: "TEAM SPACE",
    title: "团队消息",
    description: "讨论、文件与 AI 旁路监控都在同一条上下文里。",
    status: "AI 纪要已就绪",
  },
  roundtable: {
    eyebrow: "FOCUS SESSION",
    title: "圆桌协作",
    description: "把需要收敛的讨论升级为有议程、有成员、有产物的会议。",
    status: "成员上下文可带入",
  },
};

export function TeamCollaboration() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [roundtableSeed, setRoundtableSeed] = useState<CouncilDraftSeed | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const paneAnimationRef = useRef<Animation | null>(null);

  const view: CollaborationView = (
    searchParams.get("view") === "roundtable" || searchParams.has("meeting")
  ) ? "roundtable" : "chat";
  const panel: CollaborationPanel = searchParams.get("panel") === "contacts" ? "contacts" : "chats";
  const meta = view === "chat" && panel === "contacts"
    ? {
        eyebrow: "TEAM DIRECTORY",
        title: "团队通讯录",
        description: "快速找到成员、发起单聊或组织新的群聊。",
        status: "成员状态已同步",
      }
    : VIEW_META[view];

  const updateView = useCallback((next: CollaborationView) => {
    const params = new URLSearchParams(searchParams);
    if (next === "roundtable") {
      params.set("view", "roundtable");
    } else {
      params.delete("view");
      params.delete("meeting");
      params.delete("panel");
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectView = useCallback((next: CollaborationView) => {
    if (next === view) return;
    if (next === "roundtable") setRoundtableSeed(null);
    updateView(next);
  }, [updateView, view]);

  const startRoundtable = useCallback((seed?: CollabRoundtableSeed) => {
    const nextSeed = seed
      ? {
          title: seed.title,
          intro: seed.intro,
          userIds: seed.userIds,
          sourceRoomId: seed.sourceRoomId,
        }
      : null;
    setRoundtableSeed(nextSeed);
    const params = new URLSearchParams(searchParams);
    params.set("view", "roundtable");
    params.delete("meeting");
    if (seed?.sourceRoomId) params.set("room", seed.sourceRoomId);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const updatePanel = useCallback((next: CollaborationPanel) => {
    const params = new URLSearchParams(searchParams);
    params.delete("view");
    params.delete("meeting");
    if (next === "contacts") params.set("panel", "contacts");
    else params.delete("panel");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    paneAnimationRef.current?.cancel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = pane.animate(
      [
        {
          opacity: 0.64,
          filter: "blur(7px)",
          transform: `translate3d(${view === "chat" ? "-10px" : "10px"}, 0, 0) scale(0.994)`,
        },
        {
          opacity: 1,
          filter: "blur(0)",
          transform: "translate3d(0, 0, 0) scale(1)",
        },
      ],
      {
        duration: 300,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "none",
      },
    );
    paneAnimationRef.current = animation;
    return () => animation.cancel();
  }, [view]);

  return (
    <div className={`team-workspace team-workspace--${view}`}>
      <header className="team-workspace-bar">
        <div className="team-workspace-heading" aria-live="polite">
          <span className="team-workspace-eyebrow">{meta.eyebrow}</span>
          <span className="team-workspace-title">{meta.title}</span>
          <span className="team-workspace-description">{meta.description}</span>
        </div>

        <div className="team-workspace-actions">
          <span className="team-workspace-status">
            <i aria-hidden="true" />
            {meta.status}
          </span>
          {view === "chat" ? (
            <button
              type="button"
              className="team-workspace-action"
              onClick={() => startRoundtable()}
            >
              <PlusOutlined />
              新建圆桌
            </button>
          ) : (
            <button
              type="button"
              className="team-workspace-action is-secondary"
              onClick={() => selectView("chat")}
            >
              <ArrowLeftOutlined />
              回到消息
            </button>
          )}
        </div>
      </header>

      <main
        id="team-workspace-panel"
        ref={paneRef}
        className={`team-workspace-content team-workspace-content--${view}`}
        role="tabpanel"
        aria-label={meta.title}
      >
        {view === "chat" ? (
          <CollabRisk
            key="team-chat"
            embedded
            panel={panel}
            onPanelChange={updatePanel}
            onStartRoundtable={startRoundtable}
          />
        ) : (
          <Council key="team-roundtable" embedded initialDraft={roundtableSeed} />
        )}
      </main>
    </div>
  );
}
