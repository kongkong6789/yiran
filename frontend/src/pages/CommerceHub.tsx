import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Col, Row, Space, Tag, Typography } from "antd";
import {
  ApartmentOutlined, ExperimentOutlined, FundOutlined,
  SafetyCertificateOutlined, ShopOutlined, SyncOutlined,
  TeamOutlined, ThunderboltOutlined,
} from "@ant-design/icons";
import { semanticSoftColor, useVisualizationTheme } from "../theme/visualization";

type Feature = {
  key: string;
  title: string;
  desc: string;
  phase: string;
  path: string;
  icon: ReactNode;
  color: string;
};

const FEATURES: Feature[] = [
  {
    key: "overview",
    title: "融合总览",
    desc: "一期～五期进度、包含链与样例实体",
    phase: "一期",
    path: "/commerce/bench?tab=overview",
    icon: <ShopOutlined />,
    color: "#0B2144",
  },
  {
    key: "loops",
    title: "回路图谱",
    desc: "公司→SKU 知识图谱、镜头巡游、上卷金线",
    phase: "图谱",
    path: "/commerce/loops",
    icon: <SyncOutlined />,
    color: "#C4924A",
  },
  {
    key: "facts",
    title: "事实层健康",
    desc: "DuckDB / PG 表清单、吉客云·金蝶·MCP 对齐",
    phase: "二期",
    path: "/commerce/bench?tab=facts",
    icon: <FundOutlined />,
    color: "#3D6FA8",
  },
  {
    key: "sim",
    title: "回路仿真",
    desc: "公司层 8 Stock What-if 情景实验",
    phase: "三期",
    path: "/commerce/bench?tab=sim",
    icon: <ExperimentOutlined />,
    color: "#0f766e",
  },
  {
    key: "evidence",
    title: "证据图",
    desc: "本体样例与回路参与投影",
    phase: "四期",
    path: "/commerce/bench?tab=evidence",
    icon: <ApartmentOutlined />,
    color: "#6d28d9",
  },
  {
    key: "gov",
    title: "治理与审批",
    desc: "工具闸机、审批单、MCP 策略、默认禁写回",
    phase: "四期",
    path: "/commerce/bench?tab=gov",
    icon: <SafetyCertificateOutlined />,
    color: "#be123c",
  },
  {
    key: "council",
    title: "经营评审",
    desc: "经营委员会只读复核 / Kill Criteria",
    phase: "四期",
    path: "/commerce/bench?tab=council",
    icon: <TeamOutlined />,
    color: "#B8863B",
  },
  {
    key: "agents",
    title: "经营 Agent",
    desc: "19 角色 + 4 主管目录，跳转对话 @AI",
    phase: "五期",
    path: "/commerce/bench?tab=agents",
    icon: <ThunderboltOutlined />,
    color: "#ea580c",
  },
];

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "结构与图谱", keys: ["overview", "loops"] },
  { title: "数据与仿真", keys: ["facts", "sim"] },
  { title: "治理与决策", keys: ["evidence", "gov", "council"] },
  { title: "智能体", keys: ["agents"] },
];

export default function CommerceHub() {
  const nav = useNavigate();
  const visualTheme = useVisualizationTheme();

  return (
    <div className="commerce-hub">
      <header className="commerce-hub-hero">
        <Typography.Title level={3} style={{ margin: 0 }}>经营</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0", maxWidth: 640 }}>
          知行经营中枢迁入良策后的统一分类。下列卡片覆盖全部已融合页面功能，点击进入。
        </Typography.Paragraph>
        <Space wrap style={{ marginTop: 12 }}>
          <Tag color="gold">知行 → 良策</Tag>
          <Tag color="blue">一期～五期</Tag>
          <Tag>8 个功能入口</Tag>
        </Space>
      </header>

      {GROUPS.map((g) => (
        <section key={g.title} className="commerce-hub-group">
          <Typography.Title level={5} style={{ margin: "0 0 12px" }}>{g.title}</Typography.Title>
          <Row gutter={[14, 14]}>
            {g.keys.map((key) => {
              const f = FEATURES.find((x) => x.key === key)!;
              return (
                <Col xs={24} sm={12} lg={8} key={f.key}>
                  <Card
                    hoverable
                    className="commerce-hub-card"
                    onClick={() => nav(f.path)}
                  >
                    <div className="commerce-hub-card-icon" style={{
                      background: semanticSoftColor(f.color, visualTheme.mode, `${f.color}14`),
                      color: f.color,
                    }}>
                      {f.icon}
                    </div>
                    <div className="commerce-hub-card-body">
                      <div className="commerce-hub-card-meta">
                        <Tag>{f.phase}</Tag>
                      </div>
                      <Typography.Title level={5} style={{ margin: "6px 0 4px" }}>
                        {f.title}
                      </Typography.Title>
                      <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
                        {f.desc}
                      </Typography.Paragraph>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </section>
      ))}

      <style>{`
        .commerce-hub { width: 100%; max-width: 1100px; }
        .commerce-hub-hero { margin-bottom: 22px; }
        .commerce-hub-group { margin-bottom: 28px; }
        .commerce-hub-card {
          border-radius: 14px;
          border: 1px solid #e6ecf4;
          height: 100%;
        }
        .commerce-hub-card .ant-card-body {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          padding: 16px;
        }
        .commerce-hub-card-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          flex-shrink: 0;
        }
        .commerce-hub-card-body { min-width: 0; }
        .commerce-hub-card:hover {
          border-color: #C4924A;
          box-shadow: 0 10px 24px rgba(11, 33, 68, 0.08);
        }
      `}</style>
    </div>
  );
}
