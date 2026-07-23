import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 开发环境把 /api、/ws 代理到 Django 后端,规避跨域
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxyTarget = env.VITE_DEV_API_PROXY_TARGET || "http://127.0.0.1:8000";
  const allowedHostsEnv = (env.VITE_ALLOWED_HOSTS || "true").trim();
  const allowedHosts =
    allowedHostsEnv === "true" || allowedHostsEnv === "*"
      ? true
      : allowedHostsEnv
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean);

  return {
    plugins: [react()],
    server: {
      host: true, // 监听 0.0.0.0,局域网内其他设备可访问
      port: 5173,
      allowedHosts,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          // SSE 长连接：禁止代理超时/缓冲，否则对方消息会憋到连接结束才刷出来
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes, req, res) => {
              const url = req.url || "";
              if (url.includes("/events")) {
                proxyRes.headers["cache-control"] = "no-cache, no-transform";
                proxyRes.headers["x-accel-buffering"] = "no";
                // 立刻把头刷给浏览器，避免整段缓冲
                if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
                  (res as { flushHeaders: () => void }).flushHeaders();
                }
              }
            });
          },
        },
        "/ws": {
          target: proxyTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      allowedHosts,
    },
  };
});
