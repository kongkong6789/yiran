import type { Agent } from "../api/client";
import avatarAdministrative from "../assets/staffdeck/staffdeck-avatar-after-sales.png";
import avatarFinance from "../assets/staffdeck/staffdeck-avatar-commerce.png";
import avatarIt from "../assets/staffdeck/staffdeck-avatar-service.png";
import avatarHr from "../assets/staffdeck/staffdeck-avatar-ops.png";
import avatarLegal from "../assets/staffdeck/staffdeck-avatar-quality.png";

export const AGENT_AVATAR_OPTIONS = [
  { token: "staffdeck:administrative", label: "行政助理", src: avatarAdministrative },
  { token: "staffdeck:finance", label: "财务顾问", src: avatarFinance },
  { token: "staffdeck:legal", label: "法务顾问", src: avatarLegal },
  { token: "staffdeck:it", label: "技术支持", src: avatarIt },
  { token: "staffdeck:hr", label: "人事伙伴", src: avatarHr },
] as const;

const CUSTOM_AVATAR_PREFIX = "yiran-agent-custom-avatar:";

export function getStoredAgentAvatar(agentId: number) {
  if (typeof window === "undefined" || agentId < 0) return "";
  try {
    return window.localStorage.getItem(`${CUSTOM_AVATAR_PREFIX}${agentId}`) || "";
  } catch {
    return "";
  }
}

export function persistAgentAvatar(agentId: number, dataUrl?: string) {
  if (typeof window === "undefined" || agentId < 0) return;
  try {
    const key = `${CUSTOM_AVATAR_PREFIX}${agentId}`;
    if (dataUrl) window.localStorage.setItem(key, dataUrl);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing; the uploaded preview still works.
  }
}

export function resolveAgentAvatar(agent: Pick<Agent, "id" | "emoji">, offset = 0) {
  const customAvatar = getStoredAgentAvatar(agent.id);
  if (customAvatar) return customAvatar;

  const selectedPreset = AGENT_AVATAR_OPTIONS.find((item) => item.token === agent.emoji);
  if (selectedPreset) return selectedPreset.src;

  const index = Math.abs(agent.id + offset) % AGENT_AVATAR_OPTIONS.length;
  return AGENT_AVATAR_OPTIONS[index].src;
}
