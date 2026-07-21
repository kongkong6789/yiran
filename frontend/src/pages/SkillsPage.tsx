import { Typography } from "antd";
import { DeploymentUnitOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import UserSkills from "../components/UserSkills";

export default function SkillsPage() {
  return (
    <div className="skills-page">
      <header className="skills-page-head page-hero-head">
        <div className="page-hero-kicker">
          <SafetyCertificateOutlined />
          Skill governance
        </div>
        <Typography.Title level={2} className="page-hero-title">
          技能治理中心
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="page-hero-desc">
          用责任人、共用范围与真实调用证据管理每一项团队能力，让管理者看清技能是否被采用、由谁维护，以及最近由谁在何时使用。
        </Typography.Paragraph>
        <div className="skills-page-head-mark" aria-hidden="true">
          <DeploymentUnitOutlined />
        </div>
      </header>
      <div className="skills-page-body">
        <UserSkills variant="page" />
      </div>
    </div>
  );
}
