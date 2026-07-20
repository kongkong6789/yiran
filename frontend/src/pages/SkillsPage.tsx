import { Typography } from "antd";
import { BookOutlined, ThunderboltOutlined } from "@ant-design/icons";
import UserSkills from "../components/UserSkills";

export default function SkillsPage() {
  return (
    <div className="skills-page">
      <header className="skills-page-head page-hero-head">
        <div className="page-hero-kicker">
          <BookOutlined />
          知识 · 技能库
        </div>
        <Typography.Title level={2} className="page-hero-title">
          团队技能中心
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="page-hero-desc">
          分类沉淀团队能力，统一管理共享技能与个人启用状态。启用后可在对话 Agent 中通过 <code>@skill-id</code> 直接调用。
        </Typography.Paragraph>
        <div className="skills-page-head-mark" aria-hidden="true">
          <ThunderboltOutlined />
        </div>
      </header>
      <div className="skills-page-body">
        <UserSkills variant="page" />
      </div>
    </div>
  );
}
