import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Empty, Input, Popover, Spin, Tag, Tooltip, message } from "antd";
import {
  AccountBookOutlined,
  ApiOutlined,
  HddOutlined,
  SearchOutlined,
  SettingOutlined,
  ShoppingOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getMcpServers, type McpServer } from "../api/client";
import WecomIcon from "./WecomIcon";

type Props = {
  onSelect: (server: McpServer) => void;
};

const ICONS: Record<string, ReactNode> = {
  wecom: <WecomIcon size={18} />,
  kingdee: <AccountBookOutlined />,
  jackyun: <ShoppingOutlined />,
  nas: <HddOutlined />,
};

const STATUS_LABEL: Record<string, { color: string; text: string }> = {
  unconfigured: { color: "default", text: "未配置" },
  configured: { color: "processing", text: "已配置" },
  reachable: { color: "success", text: "可连通" },
  unreachable: { color: "error", text: "不可达" },
  error: { color: "error", text: "异常" },
  disabled: { color: "default", text: "已禁用" },
};

function statusOf(item: McpServer) {
  if (item.status && item.status !== "unconfigured") return item.status;
  if (item.enabled === false) return "disabled";
  return item.configured ? "configured" : "unconfigured";
}

export default function ChatConnectorPicker({ onSelect }: Props) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMcpServers();
      setServers(data.results || []);
    } catch {
      message.error("加载连接器失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setKeyword("");
    }
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) => (
      s.name.toLowerCase().includes(q)
      || s.id.toLowerCase().includes(q)
      || (s.desc || "").toLowerCase().includes(q)
    ));
  }, [servers, keyword]);

  const panel = (
    <div className="chat-skill-popover">
      <Input
        className="chat-skill-search"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索连接器"
        suffix={<SearchOutlined />}
      />
      <div className="chat-skill-list">
        {loading ? (
          <div className="chat-skill-empty"><Spin size="small" /></div>
        ) : filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword ? "无匹配连接器" : "暂无连接器"}
          />
        ) : filtered.map((server) => {
          const st = statusOf(server);
          const meta = STATUS_LABEL[st] || STATUS_LABEL.unconfigured;
          return (
            <button
              key={server.id}
              type="button"
              className="chat-skill-item"
              onClick={() => {
                onSelect(server);
                setOpen(false);
              }}
            >
              <Avatar size={36} className="chat-skill-avatar" icon={ICONS[server.id] || <ApiOutlined />} />
              <span className="chat-skill-meta">
                <strong>
                  {server.name}
                  <Tag color={meta.color} style={{ marginLeft: 6, fontSize: 10, lineHeight: "16px" }}>
                    {meta.text}
                  </Tag>
                </strong>
                <em>{server.desc || server.id}</em>
              </span>
            </button>
          );
        })}
      </div>
      <div className="chat-skill-footer">
        <Button
          type="text"
          icon={<SettingOutlined />}
          block
          onClick={() => {
            setOpen(false);
            nav("/connectors");
          }}
        >
          管理连接器
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topLeft"
      arrow={false}
      overlayClassName="chat-skill-popover-wrap"
      content={panel}
    >
      <Tooltip title="选择连接器">
        <Button
          className={`agent-chat-circle-btn${open ? " active" : ""}`}
          type="text"
          shape="circle"
          icon={<ApiOutlined />}
          aria-label="选择连接器"
        />
      </Tooltip>
    </Popover>
  );
}

/** 写入输入框的快捷提示文案 */
export function connectorPrompt(server: McpServer): string {
  if (server.id === "wecom") {
    return "请用企业微信连接器读取这篇文档：https://doc.weixin.qq.com/";
  }
  if (server.id === "jackyun") {
    return "请通过吉客云连接器查询：";
  }
  if (server.id === "kingdee") {
    return "请通过金蝶连接器帮我查询：";
  }
  if (server.id === "nas") {
    return "请从 NAS 读取这个路径并分析：`/共享目录/文件名`";
  }
  return `请通过「${server.name}」连接器帮我：`;
}
