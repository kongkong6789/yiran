# Baserow 良策集成说明

本目录存放**不修改上游源码**的良策专属插件与补丁说明。

## 目录

- `liangce_sso/` — 一次性票据 SSO 插件（后端 Django app + 前端 Nuxt 模块骨架）
- `patches/` — 可选最小补丁（仅在上游无法通过插件扩展时使用）
- `VERSION` — 锁定的上游版本

## 上游边界

- 官方源码固定在 `services/baserow`（标签 `2.3.2`）
- 社区版 MIT 功能可完整使用
- Premium / Enterprise 授权功能**不**通过改源码绕过

## 安装插件到上游

Windows 启动脚本会把 `integrations/baserow/liangce_sso` 软链/复制到
`services/baserow/plugins/liangce_sso`，并由 Baserow 的插件机制加载。
