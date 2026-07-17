import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
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
  colorPrimary: "#000000",
  colorInfo: "#000000",
  colorLink: "#000000",
  colorBgBase: "#ffffff",
  colorBgLayout: "#ffffff",
  colorBgContainer: "#ffffff",
  colorBorder: "rgba(0, 0, 0, 0.18)",
  colorBorderSecondary: "rgba(0, 0, 0, 0.1)",
  colorText: "#000000",
  colorTextSecondary: "rgba(0, 0, 0, 0.62)",
  colorTextTertiary: "rgba(0, 0, 0, 0.46)",
  borderRadius: 10,
  fontSize: 14,
};

const DARK_TOKENS = {
  colorPrimary: "#ffffff",
  colorInfo: "#ffffff",
  colorLink: "#ffffff",
  colorBgBase: "#000000",
  colorBgLayout: "#000000",
  colorBgContainer: "#000000",
  colorBorder: "rgba(255, 255, 255, 0.22)",
  colorBorderSecondary: "rgba(255, 255, 255, 0.12)",
  colorText: "#ffffff",
  colorTextSecondary: "rgba(255, 255, 255, 0.68)",
  colorTextTertiary: "rgba(255, 255, 255, 0.5)",
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
                  headerBg: "#000000",
                  siderBg: "#000000",
                  bodyBg: "#000000",
                },
                Menu: {
                  itemBg: "transparent",
                  itemSelectedBg: "rgba(255, 255, 255, 0.12)",
                  itemHoverBg: "rgba(255, 255, 255, 0.08)",
                  itemSelectedColor: "#ffffff",
                  horizontalItemSelectedColor: "#ffffff",
                  activeBarHeight: 0,
                },
                Card: {
                  colorBgContainer: "#000000",
                },
                Button: {
                  primaryShadow: "none",
                },
                Tag: {
                  defaultBg: "rgba(255, 255, 255, 0.08)",
                },
              }
            : {
                Layout: {
                  headerBg: "#ffffff",
                  siderBg: "#ffffff",
                  bodyBg: "#ffffff",
                },
                Menu: {
                  itemBg: "transparent",
                  itemSelectedBg: "rgba(0, 0, 0, 0.08)",
                  itemHoverBg: "rgba(0, 0, 0, 0.05)",
                  itemSelectedColor: "#000000",
                  horizontalItemSelectedColor: "#000000",
                  activeBarHeight: 0,
                },
                Card: {
                  colorBgContainer: "#ffffff",
                },
                Button: {
                  primaryShadow: "none",
                },
                Tag: {
                  defaultBg: "rgba(0, 0, 0, 0.06)",
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
