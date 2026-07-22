import { getAuthToken } from "../api/client";

export const DEFAULT_USER_AVATAR_URL = "/liangce-default-avatar.png";

/**
 * Platform avatars are served by an authenticated backend endpoint. External
 * avatars (for example WeCom CDN images) must never receive our auth token.
 */
export const authenticatedAvatarUrl = (url?: string | null) => {
  const value = String(url || "").trim();
  if (!value) return DEFAULT_USER_AVATAR_URL;
  if (!value.startsWith("/")) return value;
  const token = getAuthToken();
  if (!token) return value;
  return `${value}${value.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
};
