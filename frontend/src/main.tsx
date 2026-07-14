import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { brand } from "./theme/brand";
import "antd/dist/reset.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
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
        },
        components: {
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
  </React.StrictMode>
);
