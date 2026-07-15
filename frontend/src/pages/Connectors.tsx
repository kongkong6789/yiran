import { Typography } from "antd";
import { ApiOutlined } from "@ant-design/icons";
import McpServers from "../components/McpServers";
import { brand } from "../theme/brand";

export default function Connectors() {
  return (
    <div className="connectors-page">
      <header className="connectors-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <ApiOutlined style={{ color: brand.gold, marginRight: 8 }} />
            连接器
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
            统一管理企业微信、腾讯文档、金蝶、吉客云等平台 MCP 接入。配置为个人私有,登录后保存。
          </Typography.Paragraph>
        </div>
      </header>
      <McpServers variant="page" title="平台连接器" />
    </div>
  );
}
