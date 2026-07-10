import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "antd/dist/reset.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#b45cff",
          colorInfo: "#59e5ff",
          colorBgBase: "#0b0d18",
          colorBgLayout: "#080a12",
          colorBorder: "#26293a",
          colorBorderSecondary: "#1c1f2e",
          borderRadius: 10,
          fontSize: 14,
        },
        components: {
          Layout: {
            headerBg: "rgba(10,12,22,0.75)",
            siderBg: "#0a0c16",
            bodyBg: "#080a12",
          },
          Menu: {
            darkItemBg: "transparent",
            darkItemSelectedBg: "rgba(180,92,255,0.22)",
            darkItemHoverBg: "rgba(255,255,255,0.06)",
            darkItemSelectedColor: "#e9dcff",
          },
          Card: {
            colorBgContainer: "rgba(20,23,38,0.6)",
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
  </React.StrictMode>
);
