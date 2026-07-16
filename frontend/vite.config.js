import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// 开发环境把 /api 代理到 Django 后端,规避跨域
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, ".", "");
    var proxyTarget = env.VITE_DEV_API_PROXY_TARGET || "http://127.0.0.1:8000";
    var allowedHosts = (env.VITE_ALLOWED_HOSTS || ".stillgroup.net")
        .split(",")
        .map(function (host) { return host.trim(); })
        .filter(Boolean);
    return {
        plugins: [react()],
        server: {
            host: true,
            port: 5173,
            allowedHosts: allowedHosts,
            proxy: {
                "/api": {
                    target: proxyTarget,
                    changeOrigin: true,
                },
            },
        },
        preview: {
            host: true,
            allowedHosts: allowedHosts,
        },
    };
});
