import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Empty, Input, Popover, Spin, Tooltip, message } from "antd";
import {
  AppstoreOutlined, SearchOutlined, ToolOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { getSkills, type UserSkillItem } from "../api/client";

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
  const navigateTo = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const personal = await getSkills();
      setSkills(personal.results || []);
    } catch {
      message.error("加载技能失败");
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
    const enabled = skills.filter((skill) => skill.enabled);
    return q ? enabled.filter((skill) => matchesKeyword(skill, q)) : enabled;
  }, [skills, keyword]);

  const panel = (
    <div className="chat-skill-popover">
      <div className="chat-skill-head">
        <strong>选择技能</strong>
        <span>{loading ? "正在同步" : `${filtered.length} 个已启用`}</span>
      </div>
      <Input
        className="chat-skill-search"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索技能"
        prefix={<SearchOutlined />}
        aria-label="搜索已启用技能"
      />
      <div className="chat-skill-list">
        {loading ? (
          <div className="chat-skill-empty"><Spin size="small" /></div>
        ) : filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={keyword ? "没有匹配的已启用技能" : "技能库中暂无已启用技能"}
          />
        ) : (
          <>
            <div className="chat-skill-section-label">我的已启用技能</div>
            {filtered.map((skill) => (
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
          </>
        )}
      </div>
      <div className="chat-skill-footer">
        <Button
          type="text"
          icon={<AppstoreOutlined />}
          block
          onClick={() => {
            setOpen(false);
            navigateTo("/skills");
          }}
        >
          前往技能库管理与导入
        </Button>
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
      <Tooltip title="选择技能">
        <Button
          className={`agent-chat-circle-btn${open ? " active" : ""}`}
          type="text"
          shape="circle"
          icon={<ToolOutlined />}
          aria-label="选择技能"
        />
      </Tooltip>
    </Popover>
  );
}
