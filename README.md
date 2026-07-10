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
python manage.py runserver 127.0.0.1:8000
```

### 前端

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

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

- 接入真实 LLM(意图识别/生成),`.env` 配置 `LLM_API_KEY`
- 第 2 层替换为 LightRAG,第 4 层替换为 LangGraph
- 第 7 层各 connector 接真实业务系统 API
- 用户体系与 RBAC 鉴权(当前骨架放开权限)
- 高风险动作审批流与回滚
