export type ChatTheme = "light" | "dark";

export const DEFAULT_CHAT_THEME: ChatTheme = "light";
export const CHAT_THEME_STORAGE_KEY = "liangce_chat_theme";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function getChatThemeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChatTheme(storage: ReadableStorage | null): ChatTheme {
  try {
    const value = storage?.getItem(CHAT_THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : DEFAULT_CHAT_THEME;
  } catch {
    return DEFAULT_CHAT_THEME;
  }
}

export function persistChatTheme(storage: WritableStorage | null, theme: ChatTheme): void {
  try {
    storage?.setItem(CHAT_THEME_STORAGE_KEY, theme);
  } catch {
    // Preference persistence is best-effort and must never block chat.
  }
}
