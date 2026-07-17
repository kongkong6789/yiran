import { useEffect, useState } from "react";
import { Button, Card, Space, Tag, Typography } from "antd";
import { ApiOutlined, SettingOutlined, WechatOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import McpServers from "../components/McpServers";
import WeComConfigModal from "../features/task-console/WeComConfigModal";
import { brand } from "../theme/brand";

export default function Connectors() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [weComOpen, setWeComOpen] = useState(false);
  const requestedWeComTab = searchParams.get("tab");
  const initialWeComTab = requestedWeComTab === "cli" || requestedWeComTab === "webhooks" ? requestedWeComTab : "api";

  useEffect(() => {
    if (searchParams.get("section") === "wecom") setWeComOpen(true);
  }, [searchParams]);

  const closeWeCom = () => {
    setWeComOpen(false);
    if (searchParams.get("section") === "wecom") {
      const next = new URLSearchParams(searchParams);
      next.delete("section");
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <div className="connectors-page">
      <header className="connectors-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <ApiOutlined style={{ color: brand.gold, marginRight: 8 }} />
            连接
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
            统一管理企业微信、腾讯文档、金蝶、吉客云等外部系统连接。配置按当前登录用户隔离保存。
          </Typography.Paragraph>
        </div>
      </header>

      <Card className="wecom-connector-card">
        <div className="wecom-connector-card__main">
          <span className="wecom-connector-card__icon"><WechatOutlined /></span>
          <div>
            <Space size={8} wrap>
              <Typography.Title level={5}>企业微信连接</Typography.Title>
              <Tag color="gold">任务通知</Tag>
              <Tag>通讯录同步</Tag>
              <Tag>事件回调</Tag>
            </Space>
            <Typography.Text type="secondary">
              管理企业微信自建应用 API、系统生成的回调配置，以及多个群聊通知渠道。
            </Typography.Text>
          </div>
        </div>
        <Button type="primary" icon={<SettingOutlined />} onClick={() => setWeComOpen(true)}>
          配置企业微信
        </Button>
      </Card>

      <McpServers variant="page" title="平台连接器" />

      <WeComConfigModal open={weComOpen} onClose={closeWeCom} initialTab={initialWeComTab} />
    </div>
  );
}
