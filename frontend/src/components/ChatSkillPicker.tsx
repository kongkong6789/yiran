import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Empty, Input, Popover, Spin, Tooltip, Upload, message } from "antd";
import {
  CloudUploadOutlined, SearchOutlined, TeamOutlined, ToolOutlined,
} from "@ant-design/icons";
import type { UploadProps } from "antd";
import {
  adoptSkillAsset,
  getSkillAssets,
  getSkills,
  uploadSkillAsset,
  type SkillAssetItem,
  type UserSkillItem,
} from "../api/client";

type Props = {
  onSelect: (skill: UserSkillItem) => void;
  refreshKey?: number;
};

function skillInitial(skill: Pick<UserSkillItem, "name" | "skill_id">) {
  const raw = (skill.name || skill.skill_id || "?").trim();
  return raw.slice(0, 1).toUpperCase();
}

function matchesKeyword(skill: Pick<UserSkillItem, "name" | "skill_id" | "description">, keyword: string) {
  return skill.name.toLowerCase().includes(keyword)
    || skill.skill_id.toLowerCase().includes(keyword)
    || (skill.description || "").toLowerCase().includes(keyword);
}

export default function ChatSkillPicker({ onSelect, refreshKey = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [sharedSkills, setSharedSkills] = useState<SkillAssetItem[]>([]);
  const [adoptingSkillId, setAdoptingSkillId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [personal, repository] = await Promise.all([getSkills(), getSkillAssets()]);
      setSkills(personal.results || []);
      setSharedSkills((repository.results || []).filter((skill) => skill.visibility === "shared"));
    } catch {
      message.error("加载 Skill 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setKeyword("");
    }
  }, [open, load, refreshKey]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const personalSkillIds = new Set(skills.map((skill) => skill.skill_id));
    const personal = skills.filter((skill) => skill.enabled);
    const shared = sharedSkills.filter((skill) => !personalSkillIds.has(skill.skill_id));
    if (!q) return { personal, shared };
    return {
      personal: personal.filter((skill) => matchesKeyword(skill, q)),
      shared: shared.filter((skill) => matchesKeyword(skill, q)),
    };
  }, [skills, sharedSkills, keyword]);

  const adoptSharedSkill = useCallback(async (skill: SkillAssetItem) => {
    setAdoptingSkillId(skill.skill_id);
    try {
      const result = await adoptSkillAsset(skill.skill_id);
      setSkills((current) => [
        result.personal,
        ...current.filter((item) => item.skill_id !== result.personal.skill_id),
      ]);
      setSharedSkills((current) => current.filter((item) => item.skill_id !== skill.skill_id));
      message.success(`已采用并启用：${result.personal.name}`);
      onSelect(result.personal);
      setOpen(false);
    } catch (error: unknown) {
      const response = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { error?: string } } }).response
        : undefined;
      message.error(response?.data?.error || "采用共享 Skill 失败");
    } finally {
      setAdoptingSkillId(null);
    }
  }, [onSelect]);

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: ".md,.markdown,.zip",
    beforeUpload: async (file) => {
      try {
        const res = await uploadSkillAsset(file, true);
        message.success(
          res.personal
            ? `已导入并启用: ${res.personal.name}`
            : res.asset
              ? `已导入: ${res.asset.name}`
              : "导入成功",
        );
        await load();
      } catch (e: any) {
        message.error(e?.response?.data?.error || "导入失败");
      }
      return false;
    },
  };

  const panel = (
    <div className="chat-skill-popover">
      <Input
        className="chat-skill-search"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索技能"
        suffix={<SearchOutlined />}
      />
      <div className="chat-skill-list">
        {loading ? (
          <div className="chat-skill-empty"><Spin size="small" /></div>
        ) : filtered.personal.length === 0 && filtered.shared.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword ? "无匹配技能" : "暂无可用 Skill"}
          />
        ) : (
          <>
            {filtered.personal.length > 0 && <div className="chat-skill-section-label">我的技能</div>}
            {filtered.personal.map((skill) => (
              <button
                key={`personal-${skill.skill_id}`}
                type="button"
                className="chat-skill-item"
                onClick={() => {
                  onSelect(skill);
                  setOpen(false);
                }}
              >
                <Avatar size={36} className="chat-skill-avatar">{skillInitial(skill)}</Avatar>
                <span className="chat-skill-meta">
                  <strong>{skill.name}</strong>
                  <em>{skill.description || `@${skill.skill_id}`}</em>
                </span>
              </button>
            ))}
            {filtered.shared.length > 0 && <div className="chat-skill-section-label"><TeamOutlined /> 团队共享</div>}
            {filtered.shared.map((skill) => {
              const adopting = adoptingSkillId === skill.skill_id;
              return (
                <button
                  key={`shared-${skill.skill_id}`}
                  type="button"
                  className="chat-skill-item chat-skill-item--shared"
                  disabled={Boolean(adoptingSkillId)}
                  onClick={() => void adoptSharedSkill(skill)}
                >
                  <Avatar size={36} className="chat-skill-avatar chat-skill-avatar--shared">{skillInitial(skill)}</Avatar>
                  <span className="chat-skill-meta">
                    <strong>{skill.name}</strong>
                    <em>{skill.owner ? `${skill.owner} 负责 · 点击采用` : "团队共享 · 点击采用"}</em>
                  </span>
                  <span className="chat-skill-adopt-action">{adopting ? <Spin size="small" /> : "采用"}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
      <div className="chat-skill-footer">
        <Upload {...uploadProps}>
          <Button type="text" icon={<CloudUploadOutlined />} block>
            导入技能
          </Button>
        </Upload>
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topLeft"
      arrow={false}
      overlayClassName="chat-skill-popover-wrap"
      content={panel}
    >
      <Tooltip title="选择 Skill">
        <Button
          className={`agent-chat-circle-btn${open ? " active" : ""}`}
          type="text"
          shape="circle"
          icon={<ToolOutlined />}
          aria-label="选择 Skill"
        />
      </Tooltip>
    </Popover>
  );
}
