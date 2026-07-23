import { getAuthToken } from "../api/client";

/** Force a newly uploaded avatar to bypass the browser's cached image response. */
export const versionedAvatarUrl = (url?: string | null, version = Date.now()) => {
  const value = String(url || "").trim();
  if (!value) return "";
  const hashIndex = value.indexOf("#");
  const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}avatar_v=${encodeURIComponent(String(version))}${hash}`;
};

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
