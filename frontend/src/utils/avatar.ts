import { getAuthToken } from "../api/client";

/**
 * Platform avatars are served by an authenticated backend endpoint. External
 * avatars (for example WeCom CDN images) must never receive our auth token.
 */
export const authenticatedAvatarUrl = (url?: string | null) => {
  const value = String(url || "").trim();
  // Let Ant Avatar render the user's initial/icon when no custom image exists.
  if (!value) return "";
  if (!value.startsWith("/")) return value;
  const token = getAuthToken();
  if (!token) return value;
  return `${value}${value.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
};
