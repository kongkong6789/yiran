import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Empty, Input, Popover, Spin, Tooltip, Upload, message } from "antd";
import {
  CloudUploadOutlined, SearchOutlined, ToolOutlined,
} from "@ant-design/icons";
import type { UploadProps } from "antd";
import {
  getSkills,
  uploadSkillAsset,
  type UserSkillItem,
} from "../api/client";

type Props = {
  onSelect: (skill: UserSkillItem) => void;
};

function skillInitial(skill: UserSkillItem) {
  const raw = (skill.name || skill.skill_id || "?").trim();
  return raw.slice(0, 1).toUpperCase();
}

export default function ChatSkillPicker({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSkills();
      setSkills(data.results || []);
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
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const list = skills.filter((s) => s.enabled);
    if (!q) return list;
    return list.filter((s) => (
      s.name.toLowerCase().includes(q)
      || s.skill_id.toLowerCase().includes(q)
      || (s.description || "").toLowerCase().includes(q)
    ));
  }, [skills, keyword]);

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
        ) : filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword ? "无匹配技能" : "暂无已启用 Skill"}
          />
        ) : filtered.map((skill) => (
          <button
            key={skill.skill_id}
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
