# 良策 · NocoDB 配套服务

本目录把 [NocoDB](https://nocodb.com) 作为本项目的无代码数据表服务，
前端「能力 → 数据表」页会嵌入该服务的 Dashboard。

## 启动

```bash
cd nocodb
npm install
npm start
```

默认地址：http://127.0.0.1:8080/dashboard

数据文件落在 `nocodb/data/`（已 gitignore）。

## 与前端联调

1. 先启动本服务（8080）
2. 再启动前端 `frontend`（5173）与后端（8000）
3. 打开导航 **能力 → 数据表**

页面默认嵌入 `http://<主机>:8080/dashboard`。
NocoDB 的 `/api` 与 Django API 路径冲突，因此不走前端同源路径代理嵌入；
Vite 仍保留 `/nocodb-app` 代理便于调试。

可在 `frontend/.env` 覆盖：

```env
VITE_NOCODB_URL=http://127.0.0.1:8080/dashboard
```

## 可选：使用本机源码联调

若要调试 `D:\test\nocodb-develop\nocodb-develop` 源码，可自行启动那套前后端，
并把 `VITE_NOCODB_URL` 指到对应 dashboard 地址。
