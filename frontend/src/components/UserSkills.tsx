import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Button,
  Collapse,
  List,
  Popconfirm,
  Space,
  Switch,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import {
  CloudUploadOutlined,
  DeleteOutlined,
  ImportOutlined,
  PlayCircleOutlined,
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
import SkillGovernanceDashboard from "./SkillGovernanceDashboard";

type Props = {
  onInvoke?: (skill: UserSkillItem) => void;
  variant?: "sidebar" | "page";
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("response" in error)) return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === "string" ? response.data.error : fallback;
}

export default function UserSkills({ onInvoke, variant = "sidebar" }: Props) {
  if (variant === "page") return <SkillGovernanceDashboard onInvoke={onInvoke} />;
  return <UserSkillsSidebar onInvoke={onInvoke} />;
}

function UserSkillsSidebar({ onInvoke }: Pick<Props, "onInvoke">) {
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [assets, setAssets] = useState<SkillAssetItem[]>([]);
  const [cosEnabled, setCosEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [personal, repository] = await Promise.all([getSkills(), getSkillAssets()]);
      setSkills(personal.results || []);
      setAssets(repository.results || []);
      setCosEnabled(Boolean(repository.cos_enabled));
    } catch {
      message.error("加载 Skill 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: ".md,.markdown,.zip",
    beforeUpload: async (file) => {
      try {
        await uploadSkillAsset(file);
        message.success("上传成功");
        await load();
      } catch (error: unknown) {
        message.error(getErrorMessage(error, "上传失败"));
      }
      return false;
    },
  };

  const collapseItems = [
    {
      key: "repo",
      label: <Space><CloudUploadOutlined /><span>Skill 仓库 {cosEnabled ? "(COS)" : "(未启用)"}</span></Space>,
      children: (
        <>
          <div className="user-skills-head">
            <Typography.Paragraph type="secondary" className="user-skills-hint">
              上传默认仅自己可用；请到技能治理中心发布后，再由团队成员主动采用。
            </Typography.Paragraph>
            <Upload {...uploadProps} disabled={!cosEnabled}><Button type="primary" size="small" icon={<CloudUploadOutlined />} disabled={!cosEnabled}>上传</Button></Upload>
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
                  !skills.some((skill) => skill.skill_id === item.skill_id) ? <Tooltip key="adopt" title="添加到我的技能"><Button type="text" size="small" icon={<ImportOutlined />} onClick={() => void adoptSkillAsset(item.skill_id).then(load)} /></Tooltip> : null,
                  item.is_uploader ? <Popconfirm key="delete" title="删除技能资产及所有采用入口？" onConfirm={() => void deleteSkillAsset(item.skill_id).then(load)}><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Popconfirm> : null,
                ].filter(Boolean) as ReactNode[]}
              >
                <List.Item.Meta
                  title={item.name}
                  description={<><Typography.Text code style={{ fontSize: 11 }}>{item.skill_id}</Typography.Text>{item.package_kind === "package" ? <TagMini>{item.has_scripts ? `完整包 · ${item.package_file_count || 0} 文件 · 含脚本` : `完整包 · ${item.package_file_count || 0} 文件`}</TagMini> : <TagMini style={{ color: brand.textMuted }}>仅 SKILL.md（无脚本）</TagMini>}</>}
                />
              </List.Item>
            )}
          />
        </>
      ),
    },
    {
      key: "personal",
      label: "我的 Skill（可 @ 调用）",
      extra: <Button type="text" size="small" icon={<ReloadOutlined />} loading={loading} onClick={(event) => { event.stopPropagation(); void load(); }} />,
      children: (
        <List
          size="small"
          loading={loading}
          locale={{ emptyText: "请从仓库添加 Skill" }}
          dataSource={skills}
          renderItem={(item) => (
            <List.Item
              className="user-skill-item"
              actions={[
                <Tooltip key="invoke" title={`插入 @${item.skill_id}`}><Button type="text" size="small" icon={<PlayCircleOutlined />} disabled={!item.enabled} onClick={() => onInvoke?.(item)} /></Tooltip>,
                <Popconfirm key="delete" title="从个人列表移除？" onConfirm={() => void deleteSkill(item.skill_id).then(load)}><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<Space size={6}><span>{item.name}</span><Switch size="small" checked={item.enabled} onChange={(checked) => void toggleSkill(item.skill_id, checked).then(load)} /></Space>}
                description={<><Typography.Text code style={{ fontSize: 11 }}>@{item.skill_id}</Typography.Text>{item.storage === "cos" && <TagMini>来自 COS</TagMini>}</>}
              />
            </List.Item>
          )}
        />
      ),
    },
  ];

  return <div className="user-skills-panel"><Collapse ghost size="small" defaultActiveKey={["repo", "personal"]} items={collapseItems} /></div>;
}

function TagMini({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ marginLeft: 6, fontSize: 10, color: brand.gold, ...style }}>{children}</span>;
}
