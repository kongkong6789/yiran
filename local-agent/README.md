# 良策本地 Agent（Flask 可分发版）

独立 Flask 应用，适合打包发给他人使用：

- **微信扫码登录**（微信开放平台网站应用）
- **MCP / 对话历史保存在本机用户目录**（不上传服务器）
- 内置 Web UI：对话 + 企业微信 MCP 配置

## 本机数据目录

| 系统 | 路径 |
|------|------|
| Windows | `%LOCALAPPDATA%\liangce-agent\` |
| Linux/macOS | `~/.local/share/liangce-agent/` |

每个微信用户一份目录：

```
liangce-agent/
  config.env                 # 全局配置（微信 AppID、LLM 等）
  users/
    {openid}/
      profile.json           # 用户资料
      llm.json               # 个人 LLM 配置（可选）
      mcp/
        wecom.json           # 企业微信 MCP（本地文件）
      chats/
        {uuid}.json          # 对话历史
```

## 快速启动

```bash
cd local-agent
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example %LOCALAPPDATA%\liangce-agent\config.env
python run.py
```

浏览器打开：**http://127.0.0.1:5050**

## 微信扫码登录配置

1. 登录 [微信开放平台](https://open.weixin.qq.com/) 创建「网站应用」
2. 配置授权回调域：`127.0.0.1:5050`（生产环境换成你的域名）
3. 在 `config.env` 填写：

```env
WECHAT_APP_ID=wx...
WECHAT_APP_SECRET=...
WECHAT_REDIRECT_URI=http://127.0.0.1:5050/auth/wechat/callback
```

未配置微信时，可使用「本地开发登录」（`ALLOW_DEV_LOGIN=true`）。

## 打包给别人

### 方式一：源码 + Python（推荐）

把整个 `local-agent/` 文件夹压缩发给对方，附带 README，对方安装 Python 3.10+ 后执行 `python run.py`。

### 方式二：PyInstaller 单文件

```bash
pip install pyinstaller
pyinstaller build.spec
```

产物在 `dist/liangce-agent/`，双击 `liangce-agent.exe`（Windows）即可。

打包后数据仍写在用户本机 `%LOCALAPPDATA%\liangce-agent\`，不会随 exe 带走。

## 与主项目 Django 版的关系

| 能力 | Django 主项目 | local-agent |
|------|---------------|-------------|
| MCP 存储 | SQLite 数据库 | **本机 JSON 文件** |
| 对话历史 | SQLite | **本机 JSON 文件** |
| 登录 | 无 | **微信扫码** |
| 分发 | 需部署服务器 | **可打包单机运行** |

主项目 `frontend/` 仍可对接 Django API；`local-agent` 是面向个人/离线分发的轻量版。
