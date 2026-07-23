import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Dropdown, Empty, Typography } from "antd";
import { BellOutlined, CloseOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import {
  getAuthToken,
  getCollabUnread,
  type CollabUnreadItem,
} from "../api/client";

type Props = {
  enabled?: boolean;
};

export default function CollabUnreadBell({ enabled = true }: Props) {
  const nav = useNavigate();
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<CollabUnreadItem[]>([]);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CollabUnreadItem | null>(null);
  const latestPreviewKeyRef = useRef("");

  const openRoom = useCallback((item: CollabUnreadItem) => {
    setOpen(false);
    setPreview(null);
    nav(`/collab?room=${encodeURIComponent(item.room_id)}`);
  }, [nav]);

  const refresh = useCallback(async () => {
    if (!enabled || !getAuthToken()) {
      setTotal(0);
      setItems([]);
      setPreview(null);
      latestPreviewKeyRef.current = "";
      return;
    }
    try {
      const data = await getCollabUnread();
      const nextItems = data.results || [];
      const latest = nextItems[0];
      const latestKey = latest
        ? `${latest.room_id}:${latest.last_message?.id || latest.updated_at}`
        : "";
      setTotal(data.total_unread || 0);
      setItems(nextItems);
      if (latestKey && latestKey !== latestPreviewKeyRef.current) {
        latestPreviewKeyRef.current = latestKey;
        setPreview(latest);
      } else if (!latestKey) {
        latestPreviewKeyRef.current = "";
        setPreview(null);
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

  useEffect(() => {
    if (!preview) return undefined;
    const timer = window.setTimeout(() => setPreview(null), 30_000);
    return () => window.clearTimeout(timer);
  }, [preview]);

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
      {preview && !open ? (
        <aside
          key={`${preview.room_id}:${preview.last_message?.id || preview.updated_at}`}
          className="collab-unread-toast"
          role="status"
          aria-label={`来自${preview.title}的新消息`}
        >
          <button
            type="button"
            className="collab-unread-toast-main"
            onClick={() => openRoom(preview)}
          >
            <span className="collab-unread-toast-icon" aria-hidden>
              {preview.room_kind === "group" ? <TeamOutlined /> : <UserOutlined />}
            </span>
            <span className="collab-unread-toast-copy">
              <span className="collab-unread-toast-heading">
                <strong>{preview.title}</strong>
                <small>{preview.last_message?.created_at
                  ? new Date(preview.last_message.created_at).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "刚刚"}</small>
              </span>
              <span className="collab-unread-toast-content">
                {preview.last_message
                  ? `${preview.last_message.sender}：${preview.last_message.content || "发来一条新消息"}`
                  : "有新消息，点击查看"}
              </span>
              <small className="collab-unread-toast-hint">点击进入会话</small>
            </span>
          </button>
          <button
            type="button"
            className="collab-unread-toast-close"
            aria-label="关闭消息提醒"
            onClick={() => setPreview(null)}
          >
            <CloseOutlined />
          </button>
        </aside>
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
