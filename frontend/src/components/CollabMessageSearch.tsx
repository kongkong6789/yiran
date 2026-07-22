import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloseOutlined, MessageOutlined, RobotOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
import { Empty, Input, Spin, Tag } from "antd";
import type { InputRef } from "antd";

import {
  searchCollabMessages,
  type CollabSearchResult,
} from "../api/client";
import "../styles/collabMessageSearch.css";

type CollabMessageSearchProps = {
  onClose: () => void;
  onSelect: (result: CollabSearchResult) => void;
  search?: typeof searchCollabMessages;
};

function resultTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function highlightMatches(value: string, query: string): ReactNode {
  const text = String(value || "");
  const needle = query.trim();
  if (!needle) return text;
  const foldedText = text.toLocaleLowerCase();
  const foldedNeedle = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let hit = foldedText.indexOf(foldedNeedle);
  let key = 0;
  while (hit >= 0 && key < 20) {
    if (hit > cursor) parts.push(text.slice(cursor, hit));
    parts.push(<mark key={`${hit}-${key}`}>{text.slice(hit, hit + needle.length)}</mark>);
    cursor = hit + needle.length;
    hit = foldedText.indexOf(foldedNeedle, cursor);
    key += 1;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : text;
}

export default function CollabMessageSearch({
  onClose,
  onSelect,
  search = searchCollabMessages,
}: CollabMessageSearchProps) {
  const inputRef = useRef<InputRef | null>(null);
  const requestSeq = useRef(0);
  const [keyword, setKeyword] = useState("");
  const [settledKeyword, setSettledKeyword] = useState("");
  const [results, setResults] = useState<CollabSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledKeyword(keyword.trim()), 260);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, []);

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (!settledKeyword) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    void search(settledKeyword)
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setResults(data.results || []);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setResults([]);
        setFailed(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [search, settledKeyword]);

  const resultLabel = useMemo(() => {
    if (!settledKeyword || loading || failed || !results.length) return "";
    return `找到 ${results.length} 条结果`;
  }, [failed, loading, results.length, settledKeyword]);

  return (
    <section
      className="collab-search-panel"
      role="dialog"
      aria-label="搜索聊天记录"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <header className="collab-search-head">
        <div>
          <strong>搜索聊天记录</strong>
          <span>普通对话与小策 Bot 任务</span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭搜索">
          <CloseOutlined />
        </button>
      </header>

      <div className="collab-search-input-wrap">
        <Input
          ref={inputRef}
          allowClear
          value={keyword}
          prefix={<SearchOutlined />}
          placeholder="搜索对话、成员或消息内容"
          onChange={(event) => setKeyword(event.target.value)}
          aria-label="搜索对话与消息内容"
        />
      </div>

      <div className="collab-search-results" aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="collab-search-status"><Spin size="small" /> 正在搜索…</div>
        ) : failed ? (
          <div className="collab-search-status is-error">搜索失败，请稍后重试</div>
        ) : !settledKeyword ? (
          <div className="collab-search-guide">
            <SearchOutlined />
            <strong>查找历史聊天</strong>
            <span>可搜索会话名、成员、聊天内容和小策任务记录</span>
          </div>
        ) : results.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`未找到“${settledKeyword}”`} />
        ) : (
          <>
            <div className="collab-search-result-count">{resultLabel}</div>
            <div className="collab-search-result-list">
              {results.map((result, index) => {
                const message = result.message;
                const roomTitle = result.room.display_title || result.room.title;
                const sender = message?.sender.display_name
                  || message?.sender.nickname
                  || message?.sender.username
                  || "";
                const key = message
                  ? `message-${message.id}`
                  : `room-${result.room.id}-${index}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className="collab-search-result"
                    onClick={() => onSelect(result)}
                  >
                    <span className={`collab-search-result-icon${result.room.is_xiaoce ? " is-xiaoce" : ""}`}>
                      {result.room.is_xiaoce
                        ? <RobotOutlined />
                        : result.room.room_kind === "group" ? <TeamOutlined /> : <MessageOutlined />}
                    </span>
                    <span className="collab-search-result-body">
                      <span className="collab-search-result-top">
                        <strong>{highlightMatches(roomTitle, settledKeyword)}</strong>
                        {result.room.is_xiaoce ? <Tag color="gold">小策任务</Tag> : null}
                        {result.kind === "room" ? <Tag>对话</Tag> : null}
                        <time>{resultTime(result.created_at)}</time>
                      </span>
                      {message ? (
                        <span className="collab-search-result-copy">
                          {sender ? <em>{sender}：</em> : null}
                          {highlightMatches(message.snippet || result.snippet, settledKeyword)}
                        </span>
                      ) : (
                        <span className="collab-search-result-copy">
                          {highlightMatches(result.snippet || "打开对话", settledKeyword)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
