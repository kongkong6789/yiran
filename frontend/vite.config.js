import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// 开发环境把 /api 代理到 Django 后端,规避跨域
export default defineConfig({
    plugins: [react()],
    server: {
        host: true, // 监听 0.0.0.0,局域网内其他设备可访问
        port: 5173,
        proxy: {
            "/api": {
                target: "http://127.0.0.1:8000",
                changeOrigin: true,
            },
        },
    },
});
