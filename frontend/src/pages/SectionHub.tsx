import { Button, Card, Space, Typography } from "antd";
import { Link } from "react-router-dom";

type HubLink = { label: string; path: string };

type Props = {
  title: string;
  description: string;
  links?: HubLink[];
};

export default function SectionHub({ title, description, links = [] }: Props) {
  return (
    <div className="section-hub">
      <Typography.Title level={3}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
      {links.length > 0 && (
        <Card className="section-hub-card" bordered={false}>
          <Typography.Text strong>相关入口</Typography.Text>
          <Space wrap style={{ marginTop: 12 }}>
            {links.map((item) => (
              <Link key={item.path} to={item.path}>
                <Button type="primary" ghost>{item.label}</Button>
              </Link>
            ))}
          </Space>
        </Card>
      )}
    </div>
  );
}
