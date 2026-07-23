import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Badge, Button, Dropdown, Empty, Typography } from "antd";
import { BellOutlined, CloseOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import {
  getAuthToken,
  getCollabUnread,
  type CollabUnreadItem,
} from "../api/client";
import { authenticatedAvatarUrl } from "../utils/avatar";

type Props = {
  enabled?: boolean;
};

type UnreadPreview = {
  key: string;
  item: CollabUnreadItem;
};

const PREVIEW_LIFETIME_MS = 30_000;
const MAX_VISIBLE_PREVIEWS = 5;

function previewKey(item: CollabUnreadItem) {
  return `${item.room_id}:${item.last_message?.id || item.updated_at}`;
}

function UnreadPreviewToast({
  preview,
  onOpen,
  onDismiss,
}: {
  preview: UnreadPreview;
  onOpen: (item: CollabUnreadItem) => void;
  onDismiss: (key: string) => void;
}) {
  const { item } = preview;
  const senderName = item.last_message?.sender || item.title || "成员";
  const avatarSrc = authenticatedAvatarUrl(item.last_message?.sender_avatar_url);

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(preview.key), PREVIEW_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, preview.key]);

  return (
    <aside
      className="collab-unread-toast"
      role="status"
      aria-label={`来自${item.title}的新消息`}
    >
      <button
        type="button"
        className="collab-unread-toast-main"
        onClick={() => onOpen(item)}
      >
        <Avatar
          size={42}
          src={avatarSrc || undefined}
          className="collab-unread-toast-avatar"
        >
          {senderName.trim().slice(0, 1).toUpperCase()
            || (item.room_kind === "group" ? <TeamOutlined /> : <UserOutlined />)}
        </Avatar>
        <span className="collab-unread-toast-copy">
          <span className="collab-unread-toast-heading">
            <strong>{item.title}</strong>
            <small>{item.last_message?.created_at
              ? new Date(item.last_message.created_at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "刚刚"}</small>
          </span>
          <span className="collab-unread-toast-sender">{senderName}</span>
          <span className="collab-unread-toast-content">
            {item.last_message?.content || "发来一条新消息"}
          </span>
          <small className="collab-unread-toast-hint">点击进入会话</small>
        </span>
      </button>
      <button
        type="button"
        className="collab-unread-toast-close"
        aria-label={`关闭来自${item.title}的消息提醒`}
        onClick={() => onDismiss(preview.key)}
      >
        <CloseOutlined />
      </button>
    </aside>
  );
}

export default function CollabUnreadBell({ enabled = true }: Props) {
  const nav = useNavigate();
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<CollabUnreadItem[]>([]);
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<UnreadPreview[]>([]);
  const latestPreviewKeyByRoomRef = useRef(new Map<string, string>());

  const openRoom = useCallback((item: CollabUnreadItem) => {
    setOpen(false);
    setPreviews((current) => current.filter((entry) => entry.item.room_id !== item.room_id));
    nav(`/collab?room=${encodeURIComponent(item.room_id)}`);
  }, [nav]);

  const dismissPreview = useCallback((key: string) => {
    setPreviews((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !getAuthToken()) {
      setTotal(0);
      setItems([]);
      setPreviews([]);
      latestPreviewKeyByRoomRef.current.clear();
      return;
    }
    try {
      const data = await getCollabUnread();
      const nextItems = data.results || [];
      setTotal(data.total_unread || 0);
      setItems(nextItems);
      const unreadRoomIds = new Set(nextItems.map((item) => item.room_id));
      for (const roomId of latestPreviewKeyByRoomRef.current.keys()) {
        if (!unreadRoomIds.has(roomId)) latestPreviewKeyByRoomRef.current.delete(roomId);
      }
      const incoming = nextItems
        .map((item) => ({ key: previewKey(item), item }))
        .filter((entry) => (
          latestPreviewKeyByRoomRef.current.get(entry.item.room_id) !== entry.key
        ));
      nextItems.forEach((item) => (
        latestPreviewKeyByRoomRef.current.set(item.room_id, previewKey(item))
      ));
      if (incoming.length) {
        setPreviews((current) => {
          const merged = [...current];
          for (const entry of incoming) {
            if (!merged.some((existing) => existing.key === entry.key)) merged.push(entry);
          }
          return merged.slice(-MAX_VISIBLE_PREVIEWS);
        });
      } else if (!nextItems.length) {
        latestPreviewKeyByRoomRef.current.clear();
        setPreviews([]);
      }
    } catch {
      /* 未登录或无权限时静默 */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const menu = {
    items: items.length
      ? items.map((item) => ({
          key: item.room_id,
          label: (
            <div className="collab-bell-item">
              <div className="collab-bell-item-top">
                <span className="collab-bell-title">
                  {item.room_kind === "group" ? <TeamOutlined /> : <UserOutlined />}
                  {" "}
                  {item.title}
                </span>
                <Badge count={item.unread_count} size="small" />
              </div>
              <Typography.Text type="secondary" ellipsis className="collab-bell-preview">
                {item.last_message
                  ? `${item.last_message.sender}: ${item.last_message.content}`
                  : "有新消息"}
              </Typography.Text>
            </div>
          ),
          onClick: () => openRoom(item),
        }))
      : [
          {
            key: "empty",
            disabled: true,
            label: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无未读消息" />,
          },
        ],
  };

  return (
    <>
      {previews.length ? (
        <div
          className={`collab-unread-toast-stack${open ? " is-hidden" : ""}`}
          aria-hidden={open}
        >
          {previews.map((preview) => (
            <UnreadPreviewToast
              key={preview.key}
              preview={preview}
              onOpen={openRoom}
              onDismiss={dismissPreview}
            />
          ))}
        </div>
      ) : null}

      <Dropdown
        menu={menu}
        trigger={["click"]}
        placement="bottomRight"
        open={open}
        onOpenChange={setOpen}
        overlayClassName="collab-bell-dropdown"
      >
        <Button
          type="text"
          className="app-topnav-bell"
          aria-label="未读消息"
          icon={(
            <Badge count={total > 99 ? "99+" : total} size="small" overflowCount={99}>
              <BellOutlined style={{ fontSize: 18 }} />
            </Badge>
          )}
        />
      </Dropdown>
    </>
  );
}
