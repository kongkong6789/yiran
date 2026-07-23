import { useEffect, useMemo, useRef, useState } from "react";
import {
  HistoryOutlined,
  MessageOutlined,
  RobotOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Drawer, Empty, Input, Spin, Tag } from "antd";

import {
  listCollabMessages,
  type CollabMessage,
} from "../api/client";
import { authenticatedAvatarUrl } from "../utils/avatar";
import "../styles/xiaoceHistoryDrawer.css";

type Props = {
  open: boolean;
  roomId: string | null;
  roomTitle: string;
  onClose: () => void;
  onSelect: (messageId: number) => void;
  loadMessages?: typeof listCollabMessages;
};

function senderLabel(message: CollabMessage) {
  if (message.msg_type === "system") return "系统";
  if (
    message.msg_type === "ai"
    || message.ai_kind === "xiaoce"
    || message.sender?.bot_id === "xiaoce"
  ) return "小策bot";
  return message.sender?.display_name
    || message.sender?.nickname
    || message.sender?.username
    || "成员";
}

function messageTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function XiaoceHistoryDrawer({
  open,
  roomId,
  roomTitle,
  onClose,
  onSelect,
  loadMessages = listCollabMessages,
}: Props) {
  const requestSeq = useRef(0);
  const [messages, setMessages] = useState<CollabMessage[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !roomId) return;
    const seq = ++requestSeq.current;
    setMessages([]);
    setKeyword("");
    setLoading(true);
    setFailed(false);
    void (async () => {
      const byId = new Map<number, CollabMessage>();
      let beforeId: number | undefined;
      while (true) {
        const page = await loadMessages(roomId, {
          beforeId,
          limit: 100,
          lite: true,
          includeParticipants: false,
        });
        if (seq !== requestSeq.current) return;
        const pageMessages = page.results || [];
        for (const message of pageMessages) {
          if (message.status !== "deleted") byId.set(message.id, message);
        }
        const earliestId = pageMessages.reduce(
          (min, message) => (message.id > 0 ? Math.min(min, message.id) : min),
          Number.POSITIVE_INFINITY,
        );
        if (
          !page.has_more_before
          || !Number.isFinite(earliestId)
          || earliestId === beforeId
        ) break;
        beforeId = earliestId;
      }
      if (seq !== requestSeq.current) return;
      setMessages([...byId.values()].sort((left, right) => left.id - right.id));
    })()
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setFailed(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
    return () => {
      requestSeq.current += 1;
    };
  }, [loadMessages, open, reloadKey, roomId]);

  const visibleMessages = useMemo(() => {
    const needle = keyword.trim().toLocaleLowerCase();
    if (!needle) return messages;
    return messages.filter((message) => (
      senderLabel(message).toLocaleLowerCase().includes(needle)
      || String(message.content || "").toLocaleLowerCase().includes(needle)
      || (message.attachments || []).some((item) => (
        String(item.name || "").toLocaleLowerCase().includes(needle)
      ))
    ));
  }, [keyword, messages]);

  return (
    <Drawer
      className="xiaoce-history-drawer"
      open={open}
      onClose={onClose}
      placement="right"
      width="min(620px, calc(100vw - 16px))"
      title={(
        <span className="xiaoce-history-title">
          <HistoryOutlined />
          <span>
            <strong>历史发言</strong>
            <small>{roomTitle || "小策bot 任务"}</small>
          </span>
        </span>
      )}
      extra={<Tag>{messages.length} 条</Tag>}
    >
      <div className="xiaoce-history-toolbar">
        <Input
          allowClear
          value={keyword}
          prefix={<SearchOutlined />}
          placeholder="搜索全部历史发言"
          onChange={(event) => setKeyword(event.target.value)}
          aria-label="搜索全部历史发言"
        />
        <span>
          {keyword.trim()
            ? `找到 ${visibleMessages.length} 条`
            : "按时间顺序展示，点击可回到原消息"}
        </span>
      </div>

      <div
        className="xiaoce-history-list"
        aria-live="polite"
        aria-busy={loading}
      >
        {loading ? (
          <div className="xiaoce-history-state">
            <Spin size="small" />
            <span>正在载入全部发言…</span>
          </div>
        ) : failed ? (
          <div className="xiaoce-history-state">
            <span>历史发言加载失败</span>
            <Button size="small" onClick={() => setReloadKey((value) => value + 1)}>
              重试
            </Button>
          </div>
        ) : visibleMessages.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword.trim() ? "没有匹配的发言" : "暂无历史发言"}
          />
        ) : (
          visibleMessages.map((message) => {
            const ai = message.msg_type === "ai";
            const system = message.msg_type === "system" || message.status === "recalled";
            const label = senderLabel(message);
            const copy = message.status === "recalled"
              ? "该消息已撤回"
              : (message.content || "").trim()
                || ((message.attachments || []).length
                  ? `[${(message.attachments || []).length} 个附件]`
                  : "空消息");
            return (
              <button
                key={message.id}
                type="button"
                className={`xiaoce-history-item${ai ? " is-ai" : ""}${system ? " is-system" : ""}`}
                onClick={() => onSelect(message.id)}
              >
                <Avatar
                  size={36}
                  src={!ai && !system
                    ? authenticatedAvatarUrl(message.sender?.avatar_url)
                    : undefined}
                  icon={ai ? <RobotOutlined /> : system ? <MessageOutlined /> : undefined}
                  className="xiaoce-history-avatar"
                >
                  {!ai && !system ? label.slice(0, 1).toUpperCase() : null}
                </Avatar>
                <span className="xiaoce-history-item-body">
                  <span className="xiaoce-history-item-head">
                    <strong>{label}</strong>
                    <time>{messageTime(message.created_at)}</time>
                  </span>
                  <span className="xiaoce-history-copy">{copy}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </Drawer>
  );
}
