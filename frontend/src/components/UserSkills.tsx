import { useCallback, useEffect, useState } from "react";
import {
  Button, Card, Collapse, List, Popconfirm, Space, Switch, Tooltip, Typography, Upload, message,
} from "antd";
import {
  CloudUploadOutlined, DeleteOutlined, ImportOutlined, PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { UploadProps } from "antd";
import {
  adoptSkillAsset,
  deleteSkill,
  deleteSkillAsset,
  getSkillAssets,
  getSkills,
  toggleSkill,
  uploadSkillAsset,
  type SkillAssetItem,
  type UserSkillItem,
} from "../api/client";
import { brand } from "../theme/brand";

type Props = {
  onInvoke?: (skill: UserSkillItem) => void;
  variant?: "sidebar" | "page";
};

export default function UserSkills({ onInvoke, variant = "sidebar" }: Props) {
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [assets, setAssets] = useState<SkillAssetItem[]>([]);
  const [cosEnabled, setCosEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [personal, repo] = await Promise.all([getSkills(), getSkillAssets()]);
      setSkills(personal.results || []);
      setAssets(repo.results || []);
      setCosEnabled(!!repo.cos_enabled);
    } catch {
      message.error("加载 Skill 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: ".md,.markdown,.zip",
    beforeUpload: async (file) => {
      try {
        const res = await uploadSkillAsset(file);
        if (res.asset) {
          message.success(`已上传到 COS 仓库: ${res.asset.name}`);
        } else if (res.personal) {
          message.success(`已保存到个人 Skill: ${res.personal.name}`);
        } else {
          message.success("上传成功");
        }
        await load();
      } catch (e: any) {
        message.error(e?.response?.data?.error || "上传失败");
      }
      return false;
    },
  };

  const handleAdopt = async (skillId: string) => {
    try {
      await adoptSkillAsset(skillId);
      message.success("已启用到我的 Skill");
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "启用失败");
    }
  };

  const handleDeletePersonal = async (skillId: string) => {
    try {
      await deleteSkill(skillId);
      message.success("已从个人列表移除");
      await load();
    } catch {
      message.error("删除失败");
    }
  };

  const handleDeleteAsset = async (skillId: string) => {
    try {
      await deleteSkillAsset(skillId);
      message.success("已从 COS 仓库删除");
      await load();
    } catch {
      message.error("删除失败");
    }
  };

  const handleToggle = async (skill: UserSkillItem, enabled: boolean) => {
    try {
      await toggleSkill(skill.skill_id, enabled);
      setSkills((prev) => prev.map((s) => (
        s.skill_id === skill.skill_id ? { ...s, enabled } : s
      )));
    } catch {
      message.error("更新失败");
    }
  };

  const panelClass = variant === "page" ? "user-skills-panel user-skills-page" : "user-skills-panel";

  const collapseItems = [
    {
      key: "repo",
      label: (
        <Space>
          <CloudUploadOutlined />
          <span>Skill 仓库 {cosEnabled ? "(COS)" : "(未启用)"}</span>
        </Space>
      ),
      children: (
        <>
          <div className="user-skills-head">
            <Typography.Paragraph type="secondary" className="user-skills-hint">
              技能仓库全员共享：上传后其他人登录也会自动出现在「我的 Skill」。
              请上传 <strong>.zip 完整包</strong>（含 SKILL.md + scripts/）。对话里用 @skill-id 调用。
            </Typography.Paragraph>
            <Upload {...uploadProps} disabled={!cosEnabled}>
              <Button type="primary" size="small" icon={<CloudUploadOutlined />} disabled={!cosEnabled}>
                上传
              </Button>
            </Upload>
          </div>
          <List
            size="small"
            loading={loading}
            locale={{ emptyText: cosEnabled ? "暂无仓库 Skill" : "请配置 COS" }}
            dataSource={assets}
            renderItem={(item) => (
              <List.Item
                className="user-skill-item"
                actions={[
                  <Tooltip key="adopt" title="启用到我的 Skill">
                    <Button
                      type="text"
                      size="small"
                      icon={<ImportOutlined />}
                      onClick={() => handleAdopt(item.skill_id)}
                    />
                  </Tooltip>,
                  <Popconfirm
                    key="del"
                    title="从 COS 删除此 Skill？"
                    onConfirm={() => handleDeleteAsset(item.skill_id)}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={item.name}
                  description={(
                    <>
                      <Typography.Text code style={{ fontSize: 11 }}>{item.skill_id}</Typography.Text>
                      {item.package_kind === "package" ? (
                        <TagMini>{item.has_scripts ? `完整包 · ${item.package_file_count || 0} 文件 · 含脚本` : `完整包 · ${item.package_file_count || 0} 文件`}</TagMini>
                      ) : (
                        <TagMini style={{ color: brand.textMuted }}>仅 SKILL.md（无脚本）</TagMini>
                      )}
                      {item.cos_url && (
                        <div className="user-skill-desc">
                          <a href={item.cos_url} target="_blank" rel="noreferrer">COS 链接</a>
                        </div>
                      )}
                    </>
                  )}
                />
              </List.Item>
            )}
          />
        </>
      ),
    },
    {
      key: "personal",
      label: "我的 Skill (可 @ 调用)",
      extra: (
        <Button type="text" size="small" icon={<ReloadOutlined />} loading={loading} onClick={(e) => { e.stopPropagation(); load(); }} />
      ),
      children: (
        <List
          size="small"
          loading={loading}
          locale={{ emptyText: "请从仓库启用 Skill" }}
          dataSource={skills}
          renderItem={(item) => (
            <List.Item
              className="user-skill-item"
              actions={[
                <Tooltip key="invoke" title={`插入 @${item.skill_id}`}>
                  <Button
                    type="text"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    disabled={!item.enabled}
                    onClick={() => onInvoke?.(item)}
                  />
                </Tooltip>,
                <Popconfirm
                  key="del"
                  title="从个人列表移除？"
                  onConfirm={() => handleDeletePersonal(item.skill_id)}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={(
                  <Space size={6}>
                    <span>{item.name}</span>
                    <Switch
                      size="small"
                      checked={item.enabled}
                      onChange={(checked) => handleToggle(item, checked)}
                    />
                  </Space>
                )}
                description={(
                  <>
                    <Typography.Text code style={{ fontSize: 11 }}>@{item.skill_id}</Typography.Text>
                    {item.storage === "cos" && <TagMini>来自 COS</TagMini>}
                  </>
                )}
              />
            </List.Item>
          )}
        />
      ),
    },
  ];

  if (variant === "page") {
    return (
      <div className={panelClass}>
        <div className="user-skills-page-grid">
          <Card title="Skill 仓库" className="user-skills-card" bordered={false}>
            {collapseItems[0].children}
          </Card>
          <Card title="我的 Skill" className="user-skills-card" bordered={false} extra={collapseItems[1].extra}>
            {collapseItems[1].children}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={panelClass}>
      <Collapse
        ghost
        size="small"
        defaultActiveKey={["repo", "personal"]}
        items={collapseItems}
      />
    </div>
  );
}

function TagMini({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{ marginLeft: 6, fontSize: 10, color: brand.gold, ...style }}>{children}</span>
  );
}
