import { useEffect, useState } from "react";
import { Button, Card, Space, Tag, Typography } from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  WechatOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import McpServers from "../components/McpServers";
import WeComConfigModal from "../features/task-console/WeComConfigModal";

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
      <div className="connectors-page-shell">
        <header className="connectors-page-head page-hero-head connectors-hero">
          <div className="connectors-hero-copy">
            <div className="page-hero-kicker">
              <ApiOutlined />
              Capability Connect
            </div>
            <Typography.Title level={3} className="page-hero-title">
              连接中心
            </Typography.Title>
            <Typography.Paragraph type="secondary" className="page-hero-desc">
              把企业协作、业务系统与 Agent 能力接入同一个工作台。集中查看连接状态，按需配置，并在使用前完成连通性验证。
            </Typography.Paragraph>
          </div>

          <div className="connectors-hero-note">
            <span className="connectors-hero-note__icon">
              <SafetyCertificateOutlined />
            </span>
            <div>
              <Typography.Text strong>配置按账号隔离</Typography.Text>
              <Typography.Text type="secondary">
                密钥、地址与连接参数仅对当前登录账号生效
              </Typography.Text>
            </div>
          </div>
        </header>

        <section className="connectors-featured-section" aria-labelledby="collaboration-connectors-title">
          <div className="connectors-section-heading">
            <div>
              <Typography.Text className="connectors-section-eyebrow">消息与协作</Typography.Text>
              <Typography.Title level={4} id="collaboration-connectors-title">
                企业协作入口
              </Typography.Title>
            </div>
            <Typography.Text type="secondary">
              先完成通知渠道配置，Agent 才能把任务结果送到正确的人和群聊。
            </Typography.Text>
          </div>

          <Card className="wecom-connector-card" variant="borderless">
            <div className="wecom-connector-card__main">
              <span className="wecom-connector-card__icon"><WechatOutlined /></span>
              <div className="wecom-connector-card__copy">
                <Space size={8} wrap>
                  <Typography.Title level={5}>企业微信</Typography.Title>
                  <Tag color="green" bordered={false}>推荐接入</Tag>
                </Space>
                <Typography.Text type="secondary">
                  连接自建应用、回调服务与群聊机器人，承接任务通知、成员同步和事件回传。
                </Typography.Text>
                <div className="wecom-connector-card__features" aria-label="企业微信连接能力">
                  <span><CheckCircleOutlined /> 任务通知</span>
                  <span><CheckCircleOutlined /> 通讯录同步</span>
                  <span><CheckCircleOutlined /> 事件回调</span>
                </div>
              </div>
            </div>
            <Button type="primary" icon={<SettingOutlined />} onClick={() => setWeComOpen(true)}>
              配置企业微信
            </Button>
          </Card>
        </section>

        <McpServers variant="page" title="平台连接器" />
      </div>

      <WeComConfigModal open={weComOpen} onClose={closeWeCom} initialTab={initialWeComTab} />
    </div>
  );
}
