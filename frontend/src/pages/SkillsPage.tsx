import { Typography } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import UserSkills from "../components/UserSkills";

export default function SkillsPage() {
  return (
    <div className="skills-page">
      <header className="skills-page-head page-hero-head">
        <div className="page-hero-kicker">
          <SafetyCertificateOutlined />
          Skills
        </div>
        <Typography.Title level={2} className="page-hero-title">
          技能库
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="page-hero-desc">
          统一管理个人、团队与企业技能；在数据看板中查看调用趋势、使用排行与治理成效。
        </Typography.Paragraph>
      </header>
      <div className="skills-page-body">
        <UserSkills variant="page" />
      </div>
    </div>
  );
}
