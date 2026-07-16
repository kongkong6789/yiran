# Agent SaaS —— Daily LLM Wiki + Agent 执行平台

面向电商/零售运营的 Agent SaaS。核心理念:**让 Agent 按 SOP 编排,经过安全闸机校验后,再去真实业务系统执行操作**。前后端分离。

## 七层架构

| 层 | 模块 | 职责 |
|----|------|------|
| 1 | `apps.datalake` | DuckDB 数据底座:每日业务数据、指标快照、异常结果、Error Book |
| 2 | `apps.rag` | LightRAG 图谱检索(骨架):SOP / 制度 / 方案 / 业务规则 |
| 3 | `apps.wiki` | LLM Wiki 知识组织:品牌/店铺/SKU/流程/系统/指标页 |
| 4 | `apps.orchestration` | SOP 编排层:意图识别 → 信息收集 → 路由 → 闸机 → 执行 → 状态流转 |
| 5 | `apps.ontology` | 业务对象层:对象定义、状态机、权限、约束、**可执行动作契约** |
| 6 | `apps.harness` | 闸机层:Schema/权限/预算/状态/一致性校验 + Dry-run + 高风险审批 + 审计 |
| 7 | `apps.connectors` | 业务系统执行层:金蝶 / 吉客云 / 企微智能表格 / 飞瓜蝉妈妈 / 店铺后台 / 审批 |

> 说明:第 2 层 LightRAG、第 4 层 LangGraph 目前用轻量自研接口占位(接口已对齐,
> 便于后续替换为真实库);DuckDB 数据底座为真实接入。

## 技术栈

- 后端:Django 5 + Django REST Framework + DuckDB + SQLite
- 前端:React 18 + Vite + TypeScript + Ant Design
- 前后端分离,dev 环境 Vite 代理 `/api` 到 Django

## 目录结构

```
标品/
├── backend/            # Django 后端
│   ├── config/         # 项目配置(settings/urls)
│   ├── apps/           # 七层业务模块 + core
│   └── requirements.txt
└── frontend/           # React 前端
    └── src/
        ├── api/        # API 客户端与类型
        ├── components/ # 布局
        └── pages/      # 架构总览 / Agent 控制台 / 数据底座 / 闸机审计
```

## 启动

### 后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate           # Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### 前端

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

前端默认通过同域 `/api` 调用后端；跨域部署时设置
`VITE_API_BASE_URL=https://api.example.com/api`。Vite 开发代理目标可通过
`VITE_DEV_API_PROXY_TARGET` 修改。`runserver` 只提供 HTTP，公网 HTTPS 必须由
Nginx、Caddy 或云负载均衡终止 TLS，再反向代理到 `http://127.0.0.1:8000`。

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health/` | 健康检查 |
| GET | `/api/architecture/` | 七层架构定义(前端可视化) |
| POST | `/api/orchestration/run/` | 运行一次 Agent SOP 编排 |
| GET | `/api/orchestration/catalog/` | 可执行动作目录 |
| POST | `/api/harness/check/` | 单动作闸机校验 |
| GET | `/api/datalake/{tables,metrics,anomalies}/` | 数据底座 |
| GET | `/api/wiki/pages/` | Wiki 页面 |
| GET | `/api/audit-logs/` | 闸机审计日志 |
| GET/PUT/PATCH | `/api/wecom/config/` | 读取或保存当前登录用户的企业微信自建应用配置 |
| GET | `/api/wecom/contacts/` | 使用当前用户的企业微信配置同步应用可见通讯录成员 |
| POST | `/api/wecom/config/test/` | 使用当前表单配置真实测试自建应用和通讯录权限 |
| GET/POST | `/api/wecom/group-webhooks/` | 查询或新增当前用户的企业微信群机器人 Webhook |
| PATCH/DELETE | `/api/wecom/group-webhooks/{id}/` | 修改、停用或删除群机器人配置 |
| GET/POST | `/api/wecom/notifications/` | 查询通知记录或发送真实任务通知 |
| GET/POST | `/api/wecom/callback/{callback_key}/` | 企业微信 URL 验证与加密事件回调（签名认证） |
| GET | `/api/wecom/callback-events/` | 当前用户查询最近接收的企业微信事件 |
| GET | `/api/wecom/bindings/` | 管理员查询平台用户与企业微信 UserID 绑定 |
| POST | `/api/wecom/bindings/sync/` | 管理员异步启动批量同步 |
| POST | `/api/wecom/bindings/{user_id}/match/` | 管理员立即匹配单个平台用户 |
| POST | `/api/wecom/bindings/manual/` | 管理员人工确认绑定 |
| DELETE | `/api/wecom/bindings/{binding_id}/` | 管理员解除绑定 |
| GET | `/api/wecom/bindings/{binding_id}/logs/` | 管理员查看脱敏审计日志 |
| GET | `/api/wecom/bindings/{sync-jobs,conflicts}/` | 查询同步任务或冲突列表 |

### 企业微信通讯录

任务页“通知个人”会调用 `GET /api/wecom/contacts/`。接口要求 `Authorization: Token <登录令牌>`，只读取当前登录用户独立保存的 CorpID 和 Secret，不会复用其他用户的配置。后端依次获取企业微信 `access_token`、部门列表和应用可见范围内的成员，响应中不会返回 Secret、手机号或邮箱。

未配置时返回 `409`：

```json
{
  "ok": false,
  "configured": false,
  "code": "wecom_not_configured",
  "detail": "请先配置企业微信 API，再同步通讯录。"
}
```

成功响应：

```json
{
  "ok": true,
  "configured": true,
  "count": 1,
  "results": [
    {
      "key": "wecom:xieyiping",
      "name": "谢依萍",
      "department": "运营中心",
      "departmentIds": [8],
      "weComUserId": "xieyiping",
      "position": "运营经理",
      "avatar": "",
      "available": true,
      "source": "wecom"
    }
  ]
}
```

### 平台用户自动绑定企业微信

平台用户创建、首次填写手机号或修改手机号后，会在数据库事务提交后触发异步匹配；管理员也可在“账号管理 → 企业微信账号绑定”中立即匹配、批量同步、人工绑定、解除绑定和查看日志。手机号先统一为 `+86` 格式，再以 HMAC 哈希参与比较，绑定表不重复保存明文手机号，页面和审计日志只显示脱敏号码。

每天凌晨兜底同步可由 Linux cron、容器 CronJob 或 Windows 任务计划执行：

```bash
python manage.py sync_user_wecom_bindings --batch-size 100
```

存在多份企业微信配置时，在 `.env` 中设置 `WECOM_BINDING_CONFIG_USER_ID=<配置所属平台用户ID>`。企业微信自建应用至少需要“读取成员”及手机号查找成员所需的通讯录权限，并把需要匹配的成员纳入应用可见范围；生产环境还应按企业微信要求配置可信 IP。通讯录权限不足、重复手机号、绑定冲突、手机号无效和成员不存在不会反复自动重试，需要管理员处理；网络超时、限流、token 失效或临时服务异常按 5 分钟、30 分钟、2 小时、次日退避重试。

### 企业微信回调

配置弹窗只要求填写 CorpID、AgentID 和 Secret。系统会为当前用户生成独立的回调 URL、Token 和 43 位 EncodingAESKey，用户将三项复制到企业微信自建应用的“接收消息”配置即可。回调接口支持：

- GET 验证请求：校验 `msg_signature` 后解密 `echostr` 并原样返回。
- POST 消息与事件：校验签名、AES-CBC 解密、PKCS#7 校验、CorpID 校验后入库。
- 重复推送：使用签名、时间戳、nonce 和密文生成幂等键，不重复创建事件。
- 用户隔离：每份配置使用独立随机回调标识、Token 和 EncodingAESKey；事件查询只返回当前登录用户的数据。

部署环境必须配置企业微信能够访问的 HTTPS 地址：

```env
WECOM_CALLBACK_BASE_URL=https://xx.stillgroup.net:8000
```

### 真实任务通知

任务页面不再使用前端延时模拟发送：

- “通知个人”调用企业微信自建应用 `message/send`，使用当前登录用户隔离保存的 CorpID、AgentID 和 Secret，接收人必须是真实企业微信 UserID。
- “通知群聊”使用企业微信群机器人 Webhook。普通自建应用不能按群名称向任意现有群聊发送消息，因此每个目标群需要在企业微信客户端中添加群机器人，再把该群生成的完整 Webhook 地址保存到配置弹窗。
- Webhook Key 只加密保存在服务端，前端只返回末尾六位的脱敏地址。
- 企业微信返回成功时页面显示“企业微信已受理”，不再错误显示“用户已送达”；返回 `invaliduser` 时显示部分失败，接口异常时记录错误代码和中文原因。
- 发送记录按登录用户隔离保存在 `WeComNotificationRecord`，不会返回 access_token、Secret 或完整 Webhook。

通知发送、群机器人和回调业务处理现已使用数据库持久队列：相同幂等键不会重复发送；网络超时、限流和企业微信临时错误按 5 分钟、30 分钟、2 小时、次日自动重试。生产环境应由 systemd、Supervisor 或容器常驻运行：

```bash
python manage.py process_wecom_queue --watch --interval 30
```

也可以由 Cron/Windows 任务计划每分钟单次执行 `python manage.py process_wecom_queue`。队列同时处理通知补偿、成员变更回调、菜单/应用消息以及待执行的账号绑定同步任务；进程重启不会丢失任务。

企业微信成员选择默认读取 PostgreSQL 通讯录缓存；首次访问、用户手动同步或成员变更回调时才请求企业微信。建议每天执行一次兜底同步：

```powershell
python manage.py sync_wecom_contacts --max-age-hours 24
```

新增接口：

- `POST /api/wecom/notifications/{id}/retry/`：通知所有者或管理员重新发送。
- `POST /api/wecom/group-webhooks/{id}/test/`：真实发送群机器人测试消息。
- 群机器人任务通知使用企业微信 Markdown 消息；个人应用通知继续使用普通文本消息。
- `PATCH /api/wecom/group-webhooks/{id}/`：修改名称、Webhook 或启停。
- `POST /api/task-results/`：按当前用户和 Trace ID 保存任务结果。
- `GET /api/task-results/{trace_id}/` 与 `/export/`：查看或导出完整结果。
- `POST /api/task-results/{trace_id}/follow-ups/`：创建跟进任务。
- `POST /api/task-results/{trace_id}/attention/{item_id}/resolve/`：处理未完成事项。
- `GET /api/tasks/?view=sent|received`：按当前登录用户查询真实的发出任务或收到任务。
- `POST /api/tasks/`：保存任务负责人、截止时间、优先级、通知对象和执行轨迹，并将 Markdown 报告、JSON 原始数据和 Excel 数据表作为任务产物写入 PostgreSQL。
- `PATCH /api/tasks/{trace_id}/`：更新真实任务进度、执行状态与通知结果。
- 任务会在 SOP 开始前创建，执行节点完成后持续通过 PATCH 写回进度和时间线；“我发出的 / 我收到的”页面每 2 秒静默刷新一次。
- `GET /api/tasks/{trace_id}/artifacts/{artifact_id}/preview/`：在线预览 Markdown 或 JSON 任务产物。
- `GET /api/tasks/{trace_id}/artifacts/{artifact_id}/download/`：下载任务产物；仅任务发起人和已绑定的平台负责人可访问。
- `GET /api/council/agents/`：返回“管理 → 对象”中真实保存的智能体，任务页直接使用该列表，不再维护前端假数据。
- `POST /api/orchestration/run/`：任务页通过 `agent_id` 指定真实智能体；后端校验智能体是否存在、是否启用、额度是否可用，并使用其执行权限运行 SOP。

### 示例:运行 SOP

```json
POST /api/orchestration/run/
{
  "text": "帮我采购补货",
  "role": "manager",
  "payload": { "sku": "SKU-1001", "qty": 100, "amount": 50000, "supplier": "供应商A" }
}
```

返回逐节点执行轨迹与闸机结论(`allow` / `block` / `need_approval` / `need_input`)。

## 后续可扩展

- 接入真实 LLM(意图识别/生成),`.env` 配置 `LLM_API_KEY` ✅ 已支持(含 SOP 意图)
- 吉客云只读同步 → DataLake(`.env` 配 `JACKYUN_*`,不配则用 fixture) ✅
- 高风险动作审批流续跑 ✅(`/api/harness/approvals/`, `/api/orchestration/resume/`)
- RAG 混合检索(AGE 实体 + Wiki + SOP 语料) ✅
- Ontology「从数仓导入」UI ✅
- 第 2 层替换为完整 LightRAG SDK,第 4 层替换为 LangGraph
- 第 7 层其余 connector 接真实业务系统写 API
- 用户体系与 RBAC 鉴权(当前骨架放开权限)
- Loops 自动因果发现 / 模拟 / PDC
