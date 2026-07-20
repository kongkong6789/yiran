import { getAuthToken } from "../api/client";

/**
 * Platform avatars are served by an authenticated backend endpoint. External
 * avatars (for example WeCom CDN images) must never receive our auth token.
 */
export const authenticatedAvatarUrl = (url?: string | null) => {
  const value = String(url || "").trim();
  if (!value) return undefined;
  if (!value.startsWith("/")) return value;
  const token = getAuthToken();
  if (!token) return value;
  return `${value}${value.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
};
