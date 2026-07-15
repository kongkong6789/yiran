import { useEffect, useState } from "react";
import { Badge, Button, Dropdown, Empty, Typography } from "antd";
import { BellOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
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

  const refresh = async () => {
    if (!enabled || !getAuthToken()) {
      setTotal(0);
      setItems([]);
      return;
    }
    try {
      const data = await getCollabUnread();
      setTotal(data.total_unread || 0);
      setItems(data.results || []);
    } catch {
      /* 未登录或无权限时静默 */
    }
  };

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = window.setInterval(refresh, 15000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled]);

  useEffect(() => {
    if (open) refresh();
  }, [open]);

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
          onClick: () => {
            setOpen(false);
            nav(`/collab?room=${encodeURIComponent(item.room_id)}`);
          },
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
  );
}
