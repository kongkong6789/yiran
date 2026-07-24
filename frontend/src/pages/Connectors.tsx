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
              企业连接
            </div>
            <Typography.Title level={3} className="page-hero-title">
              连接中心
            </Typography.Title>
            <Typography.Paragraph type="secondary" className="page-hero-desc">
              统一连接企业微信、共享文件和业务系统。完成配置后，Agent 可在授权范围内读取信息、发送通知或执行任务。
            </Typography.Paragraph>
          </div>

          <div className="connectors-hero-note">
            <span className="connectors-hero-note__icon">
              <SafetyCertificateOutlined />
            </span>
            <div>
              <Typography.Text strong>配置按企业隔离</Typography.Text>
              <Typography.Text type="secondary">
                地址、密钥和连接状态仅对当前企业生效，切换企业后自动加载对应配置
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
              配置通知与组织协作渠道，让 Agent 把任务进展和结果发送给指定成员或群聊。
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
                  连接企业微信自建应用和群机器人，用于任务通知、成员同步与事件回传。
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

        <McpServers variant="page" title="业务连接器" />
      </div>

      <WeComConfigModal open={weComOpen} onClose={closeWeCom} initialTab={initialWeComTab} />
    </div>
  );
}
