import { Typography } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import UserSkills from "../components/UserSkills";

export default function SkillsPage() {
  return (
    <div className="skills-page">
      <header className="skills-page-head page-hero-head">
        <div className="page-hero-kicker">
          <ThunderboltOutlined />
          Skills
        </div>
        <Typography.Title level={3} className="page-hero-title">
          技能库
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="page-hero-desc">
          技能仓库全员共享。上传并启用后，任意账号打开对话 Agent 都能直接选 Skill，用 <code>@skill-id</code> 调用。
        </Typography.Paragraph>
      </header>
      <div className="skills-page-body">
        <UserSkills variant="page" />
      </div>
    </div>
  );
}
