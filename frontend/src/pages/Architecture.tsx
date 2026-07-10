import { useEffect, useState } from "react";
import { Card, Tag, Spin, Typography, Space } from "antd";
import { getArchitecture, type Architecture as Arch } from "../api/client";

const COLORS = [
  "#1677ff", "#13c2c2", "#52c41a", "#faad14",
  "#722ed1", "#eb2f96", "#f5222d",
];

export default function Architecture() {
  const [arch, setArch] = useState<Arch | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArchitecture().then(setArch).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ margin: 40 }} />;
  if (!arch) return <div>加载失败</div>;

  return (
    <div>
      <Typography.Title level={4}>{arch.title}</Typography.Title>
      <Typography.Paragraph type="secondary">
        自底向上 7 层:数据底座 → 图谱检索 → 知识组织 → SOP 编排 → 业务对象 → 安全闸机 → 业务系统执行。
      </Typography.Paragraph>
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        {[...arch.layers].reverse().map((layer) => {
          const color = COLORS[(layer.index - 1) % COLORS.length];
          return (
            <Card
              key={layer.id}
              size="small"
              style={{ borderLeft: `6px solid ${color}` }}
              title={
                <Space>
                  <Tag color={color}>第 {layer.index} 层</Tag>
                  <strong>{layer.name}</strong>
                  <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
                    {layer.desc}
                  </Typography.Text>
                </Space>
              }
            >
              <Space wrap>
                {layer.children.map((c) => (
                  <Tag key={c} style={{ padding: "2px 10px" }}>
                    {c}
                  </Tag>
                ))}
              </Space>
            </Card>
          );
        })}
      </Space>
    </div>
  );
}
