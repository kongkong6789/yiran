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
import {
  getAntComponentTokens,
  getAntThemeTokens,
  getThemeCssVariables,
} from "./theme/palette";
import "antd/dist/reset.css";
import "./index.css";
import "./styles/agentChatApple.css";

function Root() {
  const [mode, setMode] = useState<ThemeMode>(readStoredThemeMode);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    Object.entries(getThemeCssVariables(mode)).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* preference persistence is best-effort */
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
          token: getAntThemeTokens(mode),
          components: getAntComponentTokens(mode),
        }}
      >
        <AntApp>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
