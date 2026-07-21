import type { ThemeMode } from "./mode";

export interface ThemePalette {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceInput: string;
  surfaceOverlay: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  border: string;
  borderSubtle: string;
  borderStrong: string;
  hover: string;
  selected: string;
  focus: string;
  ownBubble: string;
  ownBubbleText: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
  info: string;
  infoBg: string;
  graphCanvas: string;
  graphGrid: string;
  graphEdge: string;
  graphTooltipBg: string;
  graphTooltipBorder: string;
  graphTooltipText: string;
}

export const THEME_PALETTES: Record<ThemeMode, ThemePalette> = {
  light: {
    canvas: "#ffffff",
    surface: "#ffffff",
    surfaceRaised: "#f7f7f7",
    surfaceInput: "#ffffff",
    surfaceOverlay: "#ffffff",
    text: "#000000",
    textSecondary: "rgba(0, 0, 0, 0.68)",
    textMuted: "rgba(0, 0, 0, 0.5)",
    textInverse: "#ffffff",
    border: "rgba(0, 0, 0, 0.18)",
    borderSubtle: "rgba(0, 0, 0, 0.1)",
    borderStrong: "rgba(0, 0, 0, 0.3)",
    hover: "rgba(0, 0, 0, 0.06)",
    selected: "rgba(0, 0, 0, 0.1)",
    focus: "#000000",
    ownBubble: "#000000",
    ownBubbleText: "#ffffff",
    success: "#237a45",
    successBg: "#edf8f1",
    warning: "#946618",
    warningBg: "#fff7e7",
    error: "#b53b3b",
    errorBg: "#fff1f0",
    info: "#356f9f",
    infoBg: "#eef6fc",
    graphCanvas: "#f4f7fb",
    graphGrid: "#dfe5ee",
    graphEdge: "#9aa7b8",
    graphTooltipBg: "#ffffff",
    graphTooltipBorder: "#d7e0ec",
    graphTooltipText: "#1a2740",
  },
  dark: {
    canvas: "#000000",
    surface: "#080808",
    surfaceRaised: "#101010",
    surfaceInput: "#121212",
    surfaceOverlay: "#181818",
    text: "#f5f5f5",
    textSecondary: "rgba(255, 255, 255, 0.72)",
    textMuted: "rgba(255, 255, 255, 0.54)",
    textInverse: "#000000",
    border: "rgba(255, 255, 255, 0.2)",
    borderSubtle: "rgba(255, 255, 255, 0.11)",
    borderStrong: "rgba(255, 255, 255, 0.34)",
    hover: "rgba(255, 255, 255, 0.08)",
    selected: "rgba(255, 255, 255, 0.12)",
    focus: "#ffffff",
    ownBubble: "#f2f2f2",
    ownBubbleText: "#080808",
    success: "#73d89b",
    successBg: "rgba(47, 145, 86, 0.18)",
    warning: "#e5bb69",
    warningBg: "rgba(174, 116, 26, 0.2)",
    error: "#ef8585",
    errorBg: "rgba(190, 58, 58, 0.2)",
    info: "#7eb7e8",
    infoBg: "rgba(54, 121, 177, 0.2)",
    graphCanvas: "#050505",
    graphGrid: "#1c1c1c",
    graphEdge: "#555555",
    graphTooltipBg: "#151515",
    graphTooltipBorder: "#383838",
    graphTooltipText: "#f5f5f5",
  },
};

export function getThemePalette(mode: ThemeMode): ThemePalette {
  return THEME_PALETTES[mode];
}

export function getThemeCssVariables(mode: ThemeMode): Record<string, string> {
  const palette = getThemePalette(mode);

  return {
    "--lc-canvas": palette.canvas,
    "--lc-surface": palette.surface,
    "--lc-surface-raised": palette.surfaceRaised,
    "--lc-surface-input": palette.surfaceInput,
    "--lc-surface-overlay": palette.surfaceOverlay,
    "--lc-ink": palette.text,
    "--lc-text-secondary": palette.textSecondary,
    "--lc-muted": palette.textMuted,
    "--lc-line": palette.border,
    "--lc-border-light": palette.borderSubtle,
    "--lc-border-strong": palette.borderStrong,
    "--lc-hover": palette.hover,
    "--lc-selected": palette.selected,
    "--lc-focus": palette.focus,
    "--lc-own-bg": palette.ownBubble,
    "--lc-own-ink": palette.ownBubbleText,
    "--lc-status-success": palette.success,
    "--lc-status-success-bg": palette.successBg,
    "--lc-status-warning": palette.warning,
    "--lc-status-warning-bg": palette.warningBg,
    "--lc-status-error": palette.error,
    "--lc-status-error-bg": palette.errorBg,
    "--lc-status-info": palette.info,
    "--lc-status-info-bg": palette.infoBg,
    "--lc-graph-canvas": palette.graphCanvas,
    "--lc-graph-grid": palette.graphGrid,
    "--lc-graph-edge": palette.graphEdge,
    "--lc-graph-tooltip-bg": palette.graphTooltipBg,
    "--lc-graph-tooltip-border": palette.graphTooltipBorder,
    "--lc-graph-tooltip-text": palette.graphTooltipText,
  };
}

export function getAntThemeTokens(mode: ThemeMode) {
  const palette = getThemePalette(mode);

  return {
    colorPrimary: mode === "dark" ? "#ffffff" : "#000000",
    colorInfo: palette.info,
    colorInfoBg: palette.infoBg,
    colorSuccess: palette.success,
    // Ant Design derives *Bg from the seed color; a dark seed like #237a45
    // collapses to a muddy gray-green (#afbab1) that looks like a black veil on Tags.
    colorSuccessBg: palette.successBg,
    colorWarning: palette.warning,
    colorWarningBg: palette.warningBg,
    colorError: palette.error,
    colorErrorBg: palette.errorBg,
    colorLink: mode === "dark" ? palette.text : "#000000",
    colorBgBase: palette.canvas,
    colorBgLayout: palette.canvas,
    colorBgContainer: palette.surface,
    colorBgElevated: palette.surfaceRaised,
    colorFillAlter: palette.surfaceRaised,
    colorFillSecondary: palette.hover,
    colorFillTertiary: palette.hover,
    colorFillQuaternary: palette.surfaceInput,
    colorBorder: palette.border,
    colorBorderSecondary: palette.borderSubtle,
    colorText: palette.text,
    colorTextSecondary: palette.textSecondary,
    colorTextTertiary: palette.textMuted,
    colorTextQuaternary: palette.textMuted,
    colorTextDisabled: palette.textMuted,
    borderRadius: 10,
    fontSize: 14,
    boxShadowSecondary:
      mode === "dark"
        ? "0 18px 48px rgba(0, 0, 0, 0.52)"
        : "0 12px 32px rgba(0, 0, 0, 0.12)",
  };
}

export function getAntComponentTokens(mode: ThemeMode) {
  const palette = getThemePalette(mode);

  return {
    Layout: {
      headerBg: palette.canvas,
      siderBg: palette.surface,
      bodyBg: palette.canvas,
    },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: palette.selected,
      itemHoverBg: palette.hover,
      itemSelectedColor: palette.text,
      horizontalItemSelectedColor: palette.text,
      activeBarHeight: 0,
    },
    Card: {
      colorBgContainer: palette.surface,
      headerBg: palette.surface,
    },
    Button: {
      primaryShadow: "none",
      primaryColor: palette.textInverse,
      defaultBg: palette.surfaceInput,
      defaultColor: palette.text,
      defaultBorderColor: palette.border,
    },
    Tag: {
      defaultBg: palette.hover,
      defaultColor: palette.textSecondary,
    },
    Select: {
      selectorBg: palette.surfaceInput,
      optionActiveBg: palette.hover,
      optionSelectedBg: palette.selected,
      optionSelectedColor: palette.text,
    },
    Input: {
      activeBg: palette.surfaceInput,
      hoverBg: palette.surfaceInput,
    },
    InputNumber: {
      activeBg: palette.surfaceInput,
      hoverBg: palette.surfaceInput,
    },
    Table: {
      headerBg: palette.surfaceRaised,
      headerColor: palette.textSecondary,
      rowHoverBg: palette.hover,
      borderColor: palette.borderSubtle,
    },
    Tabs: {
      inkBarColor: palette.focus,
      itemColor: palette.textSecondary,
      itemHoverColor: palette.text,
      itemSelectedColor: palette.text,
    },
    Modal: {
      contentBg: palette.surfaceRaised,
      headerBg: palette.surfaceRaised,
      titleColor: palette.text,
    },
    Drawer: {
      colorBgElevated: palette.surfaceOverlay,
    },
    Popover: {
      colorBgElevated: palette.surfaceOverlay,
    },
    Tooltip: {
      colorBgSpotlight: palette.surfaceOverlay,
      colorTextLightSolid: palette.text,
    },
    Dropdown: {
      colorBgElevated: palette.surfaceOverlay,
      controlItemBgHover: palette.hover,
    },
    Segmented: {
      trackBg: palette.surfaceInput,
      itemSelectedBg: palette.surfaceRaised,
      itemSelectedColor: palette.text,
      itemHoverBg: palette.hover,
    },
    Pagination: {
      itemActiveBg: palette.surfaceRaised,
    },
  };
}
