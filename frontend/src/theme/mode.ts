import { createContext, useContext } from "react";

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "lc-theme-mode";

export function readStoredThemeMode(): ThemeMode {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export const ThemeModeContext = createContext<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}>({
  mode: "light",
  setMode: () => {},
  toggle: () => {},
});

export function useThemeMode() {
  return useContext(ThemeModeContext);
}
