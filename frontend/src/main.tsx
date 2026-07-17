import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { brand } from "./theme/brand";
import {
  THEME_STORAGE_KEY,
  ThemeModeContext,
  readStoredThemeMode,
  type ThemeMode,
} from "./theme/mode";
import "antd/dist/reset.css";
import "./index.css";
import "./styles/agentChatApple.css";

const LIGHT_TOKENS = {
  colorPrimary: brand.gold,
  colorInfo: brand.accentBlue,
  colorLink: brand.navyMid,
  colorBgBase: brand.bg,
  colorBgLayout: brand.bgLayout,
  colorBgContainer: brand.bgElevated,
  colorBorder: brand.border,
  colorBorderSecondary: brand.borderLight,
  colorText: brand.text,
  colorTextSecondary: brand.textMuted,
  borderRadius: 10,
  fontSize: 14,
};

const DARK_TOKENS = {
  colorPrimary: brand.goldLight,
  colorInfo: "#6C9BD2",
  colorLink: "#8FB4E0",
  colorBgBase: "#0E1420",
  colorBgLayout: "#0A0F19",
  colorBgContainer: "#151D2C",
  colorBorder: "#2A3650",
  colorBorderSecondary: "#222C42",
  colorText: "#E4E9F2",
  colorTextSecondary: "#93A1B8",
  borderRadius: 10,
  fontSize: 14,
};

function Root() {
  const [mode, setMode] = useState<ThemeMode>(readStoredThemeMode);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const ctx = useMemo(
    () => ({
      mode,
      setMode,
      toggle: () => setMode((m) => (m === "dark" ? "light" : "dark")),
    }),
    [mode]
  );

  const dark = mode === "dark";

  return (
    <ThemeModeContext.Provider value={ctx}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: dark ? DARK_TOKENS : LIGHT_TOKENS,
          components: dark
            ? {
                Layout: {
                  headerBg: "rgba(14, 20, 32, 0.88)",
                  siderBg: "#151D2C",
                  bodyBg: "#0A0F19",
                },
                Menu: {
                  itemBg: "transparent",
                  itemSelectedBg: "rgba(201, 154, 74, 0.18)",
                  itemHoverBg: "rgba(255, 255, 255, 0.06)",
                  itemSelectedColor: brand.goldLight,
                  horizontalItemSelectedColor: brand.goldLight,
                  activeBarHeight: 0,
                },
                Card: {
                  colorBgContainer: "rgba(21, 29, 44, 0.92)",
                },
                Button: {
                  primaryShadow: "0 2px 0 rgba(0, 0, 0, 0.24)",
                },
                Tag: {
                  defaultBg: "rgba(255, 255, 255, 0.08)",
                },
              }
            : {
                Layout: {
                  headerBg: "rgba(255, 255, 255, 0.88)",
                  siderBg: brand.bgElevated,
                  bodyBg: brand.bgLayout,
                },
                Menu: {
                  itemBg: "transparent",
                  itemSelectedBg: "rgba(196, 146, 74, 0.14)",
                  itemHoverBg: "rgba(11, 33, 68, 0.05)",
                  itemSelectedColor: brand.navy,
                  horizontalItemSelectedColor: brand.navy,
                  activeBarHeight: 0,
                },
                Card: {
                  colorBgContainer: brand.bgCard,
                },
                Button: {
                  primaryShadow: "0 2px 0 rgba(196, 146, 74, 0.12)",
                },
                Tag: {
                  defaultBg: "rgba(11, 33, 68, 0.06)",
                },
              },
        }}
      >
        <AntApp>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
