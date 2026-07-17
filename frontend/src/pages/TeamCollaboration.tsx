import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeftOutlined,
  CommentOutlined,
  PlusOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";

import Council, { type CouncilDraftSeed } from "./Council";
import CollabRisk, { type CollabRoundtableSeed } from "./CollabRisk";
import "../styles/teamCollaboration.css";

type CollaborationView = "chat" | "roundtable";

const VIEW_META: Record<CollaborationView, {
  eyebrow: string;
  title: string;
  description: string;
}> = {
  chat: {
    eyebrow: "TEAM SPACE",
    title: "团队消息",
    description: "讨论、文件与 AI 旁路监控都在同一条上下文里。",
  },
  roundtable: {
    eyebrow: "FOCUS SESSION",
    title: "圆桌协作",
    description: "把需要收敛的讨论升级为有议程、有成员、有产物的会议。",
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
  const meta = VIEW_META[view];

  const updateView = useCallback((next: CollaborationView) => {
    const params = new URLSearchParams(searchParams);
    if (next === "roundtable") {
      params.set("view", "roundtable");
    } else {
      params.delete("view");
      params.delete("meeting");
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

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    paneAnimationRef.current?.cancel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = pane.animate(
      [
        { opacity: 0.72, transform: `translate3d(${view === "chat" ? "-8px" : "8px"}, 0, 0) scale(0.996)` },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
      ],
      {
        duration: 260,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );
    paneAnimationRef.current = animation;
    return () => animation.cancel();
  }, [view]);

  const handleTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowLeft" || event.key === "Home" ? "chat" : "roundtable";
    selectView(next);
    requestAnimationFrame(() => {
      document.getElementById(`team-workspace-tab-${next}`)?.focus();
    });
  };

  return (
    <div className={`team-workspace team-workspace--${view}`}>
      <header className="team-workspace-bar">
        <div className="team-workspace-heading" aria-live="polite">
          <span className="team-workspace-eyebrow">{meta.eyebrow}</span>
          <span className="team-workspace-title">{meta.title}</span>
          <span className="team-workspace-description">{meta.description}</span>
        </div>

        <div
          className="team-workspace-tabs"
          role="tablist"
          aria-label="团队协作模式"
          onKeyDown={handleTabsKeyDown}
        >
          <span
            className={`team-workspace-tab-indicator is-${view}`}
            aria-hidden="true"
          />
          <button
            id="team-workspace-tab-chat"
            type="button"
            role="tab"
            aria-selected={view === "chat"}
            aria-controls="team-workspace-panel"
            tabIndex={view === "chat" ? 0 : -1}
            className={view === "chat" ? "is-active" : ""}
            onClick={() => selectView("chat")}
          >
            <CommentOutlined />
            消息
          </button>
          <button
            id="team-workspace-tab-roundtable"
            type="button"
            role="tab"
            aria-selected={view === "roundtable"}
            aria-controls="team-workspace-panel"
            tabIndex={view === "roundtable" ? 0 : -1}
            className={view === "roundtable" ? "is-active" : ""}
            onClick={() => selectView("roundtable")}
          >
            <TeamOutlined />
            圆桌
          </button>
        </div>

        <div className="team-workspace-actions">
          <span className="team-workspace-status">
            <i aria-hidden="true" />
            成员上下文可带入
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
        aria-labelledby={`team-workspace-tab-${view}`}
      >
        {view === "chat" ? (
          <CollabRisk embedded onStartRoundtable={startRoundtable} />
        ) : (
          <Council embedded initialDraft={roundtableSeed} />
        )}
      </main>
    </div>
  );
}
