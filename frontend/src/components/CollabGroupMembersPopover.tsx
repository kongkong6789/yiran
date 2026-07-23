import { RobotOutlined, TeamOutlined } from "@ant-design/icons";
import { Avatar, Tag } from "antd";
import type { AuthUser, CollabRoom, CollabUserBrief } from "../api/client";
import { authenticatedAvatarUrl } from "../utils/avatar";
import "./CollabGroupMembersPopover.css";

type CollabGroupMembersPopoverProps = {
  room: CollabRoom;
  me: AuthUser | null;
};

function memberLabel(member: CollabUserBrief) {
  return (member.display_name || member.nickname || member.username || "成员").trim();
}

function memberInitial(member: CollabUserBrief) {
  return Array.from(memberLabel(member))[0]?.toUpperCase() || "成";
}

function isAutomatedMember(member: CollabUserBrief) {
  return member.kind === "bot"
    || Boolean(member.bot_id)
    || member.username === "小策bot"
    || member.username === "良策AI";
}

function avatarColor(name: string) {
  const colors = ["#315efb", "#6f55e8", "#0f8f7d", "#c77421", "#c33d5c", "#41768f"];
  const score = Array.from(name).reduce((sum, char) => sum + (char.codePointAt(0) || 0), 0);
  return colors[score % colors.length];
}

export function CollabGroupMembersPopover({
  room,
  me,
}: CollabGroupMembersPopoverProps) {
  const members = [...room.participants].sort((left, right) => {
    const automatedDelta = Number(isAutomatedMember(left)) - Number(isAutomatedMember(right));
    if (automatedDelta) return automatedDelta;
    if (left.id === room.created_by?.id) return -1;
    if (right.id === room.created_by?.id) return 1;
    return memberLabel(left).localeCompare(memberLabel(right), "zh-CN");
  });
  const humanCount = members.filter((member) => !isAutomatedMember(member)).length;
  const agentCount = members.length - humanCount;

  return (
    <section className="collab-group-members" aria-label={`${room.title || "群聊"}成员列表`}>
      <header>
        <span className="collab-group-members__glyph"><TeamOutlined /></span>
        <span>
          <strong>群成员</strong>
          <small>
            {humanCount} 位成员
            {agentCount ? ` · ${agentCount} 个智能体` : ""}
          </small>
        </span>
      </header>
      <div className="collab-group-members__list" role="list">
        {members.map((member) => {
          const automated = isAutomatedMember(member);
          const label = memberLabel(member);
          const avatar = authenticatedAvatarUrl(member.avatar_url);
          return (
            <div className="collab-group-members__row" role="listitem" key={member.id}>
              <span className={`collab-group-members__avatar${automated ? " is-agent" : ""}`}>
                <Avatar
                  size={38}
                  src={avatar || undefined}
                  icon={automated && !avatar ? <RobotOutlined /> : undefined}
                  style={!avatar && !automated ? { backgroundColor: avatarColor(label) } : undefined}
                >
                  {!avatar && !automated ? memberInitial(member) : null}
                </Avatar>
                {!automated ? <i className={member.online ? "is-online" : ""} aria-hidden /> : null}
              </span>
              <span className="collab-group-members__identity">
                <strong>{label}</strong>
                <small>{automated ? "智能体" : `@${member.username}`}</small>
              </span>
              <span className="collab-group-members__tags">
                {member.id === room.created_by?.id ? <Tag color="gold">群主</Tag> : null}
                {member.id === me?.id ? <Tag>我</Tag> : null}
                {automated ? <Tag color="blue">AI</Tag> : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
