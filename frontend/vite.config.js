import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// 开发环境把 /api、/ws 代理到 Django 后端,规避跨域
export default defineConfig({
    plugins: [react()],
    server: {
        host: true, // 监听 0.0.0.0,局域网内其他设备可访问
        port: 5173,
        proxy: {
            "/api": {
                target: "http://127.0.0.1:8000",
                changeOrigin: true,
                // SSE 长连接：禁止代理超时/缓冲，否则对方消息会憋到连接结束才刷出来
                timeout: 0,
                proxyTimeout: 0,
                configure: function (proxy) {
                    proxy.on("proxyRes", function (proxyRes, req, res) {
                        var url = req.url || "";
                        if (url.includes("/events")) {
                            proxyRes.headers["cache-control"] = "no-cache, no-transform";
                            proxyRes.headers["x-accel-buffering"] = "no";
                            // 立刻把头刷给浏览器，避免整段缓冲
                            if (typeof res.flushHeaders === "function") {
                                res.flushHeaders();
                            }
                        }
                    });
                },
            },
            "/ws": {
                target: "http://127.0.0.1:8000",
                ws: true,
                changeOrigin: true,
            },
        },
    },
});
