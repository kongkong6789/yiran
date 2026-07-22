import { useMemo } from "react";
import { useThemeMode, type ThemeMode } from "./mode.ts";
import { getThemePalette } from "./palette.ts";

export interface VisualizationTheme {
  mode: ThemeMode;
  canvas: string;
  grid: string;
  edge: string;
  edgeActive: string;
  edgeMuted: string;
  nodeDimmed: string;
  nodeHover: string;
  particle: string;
  labelBg: string;
  labelText: string;
  mutedText: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  loadingMask: string;
}

export function getVisualizationTheme(mode: ThemeMode): VisualizationTheme {
  const palette = getThemePalette(mode);
  const dark = mode === "dark";

  return {
    mode,
    canvas: palette.graphCanvas,
    grid: palette.graphGrid,
    edge: palette.graphEdge,
    edgeActive: dark ? "#f5f5f5" : "#3d6fa8",
    edgeMuted: dark ? "rgba(255, 255, 255, 0.16)" : "rgba(61, 111, 168, 0.22)",
    nodeDimmed: dark ? "#555555" : "#8a96c8",
    nodeHover: dark ? "#ffffff" : "#0b2144",
    particle: dark ? "#7eb7e8" : "#3d6fa8",
    labelBg: palette.surfaceRaised,
    labelText: palette.text,
    mutedText: palette.textSecondary,
    tooltipBg: palette.graphTooltipBg,
    tooltipBorder: palette.graphTooltipBorder,
    tooltipText: palette.graphTooltipText,
    loadingMask: dark ? "rgba(0, 0, 0, 0.72)" : "rgba(245, 247, 251, 0.72)",
  };
}

export function useVisualizationTheme(): VisualizationTheme {
  const { mode } = useThemeMode();
  return useMemo(() => getVisualizationTheme(mode), [mode]);
}

export function semanticSoftColor(
  accent: string,
  mode: ThemeMode,
  lightFallback: string,
): string {
  if (mode === "light") return lightFallback;

  const hex = accent.replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((value) => value + value).join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "rgba(255, 255, 255, 0.12)";

  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, 0.22)`;
}

export function graphTooltipStyle(theme: VisualizationTheme): string {
  return [
    "padding:6px 10px",
    `background:${theme.tooltipBg}`,
    `border:1px solid ${theme.tooltipBorder}`,
    "border-radius:8px",
    "font-size:12px",
    `color:${theme.tooltipText}`,
    "max-width:280px",
    "box-shadow:0 12px 32px rgba(0,0,0,0.38)",
  ].join(";");
}
