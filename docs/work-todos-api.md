# 工作待办 API

本文档描述“工作 → 待办”页面使用的平台待办与企业微信待办接口。

## 1. 通用约定

- 本地地址：`http://127.0.0.1:8000`
- 局域网地址：`http://192.168.0.204:8000`
- 请求头：`Authorization: Token <登录令牌>`
- JSON 请求需携带：`Content-Type: application/json`
- 所有数据按当前登录用户所属企业隔离。

### 三类 ID 不可混用

| 字段 | 含义 | 获取接口 |
| --- | --- | --- |
| `platformAssigneeIds` | 平台用户 ID，只创建平台待办 | `GET /api/wecom/todos/members/` 返回的 `id` |
| `wecomContactIds` | 企业微信通讯录缓存记录 ID，只决定企微待办参与人 | `GET /api/wecom/contacts/` 返回的 `id` / `contactId` |
| 企业微信 UserID | 企业微信原始成员标识，由服务端内部使用 | 前端创建待办时不直接提交 |

`assigneeIds` 是旧版兼容字段，语义等同于 `platformAssigneeIds`。新代码应使用 `platformAssigneeIds`。

> 重要：平台负责人不会因为已绑定企业微信而被自动加入企微待办。企微参与人严格以 `wecomContactIds` 为准。

## 2. 查询可选平台负责人

```http
GET /api/wecom/todos/members/
```

示例：

```bash
curl "http://127.0.0.1:8000/api/wecom/todos/members/" \
  -H "Authorization: Token <登录令牌>"
```

响应示例：

```json
{
  "ok": true,
  "results": [
    {
      "id": 25,
      "name": "梁振星",
      "department": "运营中心",
      "avatar": "/api/auth/avatars/example/",
      "bound": true
    }
  ]
}
```

## 3. 查询可选企业微信负责人

```http
GET /api/wecom/contacts/
```

该接口优先读取本企业已同步到数据库的通讯录缓存，不要求每次打开下拉框都实时请求企业微信。

```bash
curl "http://127.0.0.1:8000/api/wecom/contacts/" \
  -H "Authorization: Token <登录令牌>"
```

创建待办时使用响应中的内部通讯录记录 `id`（部分响应同时提供 `contactId`），不要提交平台用户 ID。

## 4. 创建待办

```http
POST /api/wecom/todos/
```

请求体：

```json
{
  "title": "完成本周运营报告",
  "description": "整理销售和投放数据",
  "platformAssigneeIds": [1, 25],
  "wecomContactIds": [7],
  "dueAt": "2026-07-18T18:00:00+08:00",
  "priority": "high",
  "remindTypes": [0],
  "syncToWeCom": true
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 标题，最多 200 字符 |
| `description` | string | 否 | 描述，最多 1000 字符 |
| `platformAssigneeIds` | number[] | 条件必填 | 平台负责人；只创建平台待办 |
| `wecomContactIds` | number[] | 条件必填 | 企微负责人；只创建企微参与人 |
| `dueAt` | ISO 8601 string / null | 否 | 截止时间 |
| `priority` | string | 否 | `normal`、`high`、`urgent` |
| `remindTypes` | number[] | 否 | 企业微信待办提醒类型，默认 `[0]` |
| `syncToWeCom` | boolean | 否 | 是否同步到企业微信，默认 `false` |

校验规则：

- `platformAssigneeIds` 与 `wecomContactIds` 至少提供一种。
- `syncToWeCom=true` 时必须提供至少一个 `wecomContactIds`。
- 提供 `wecomContactIds` 时必须设置 `syncToWeCom=true`。
- 平台负责人必须是当前企业的启用成员。
- 企微负责人必须属于当前企业可用的通讯录缓存。
- 同一 ID 数组内会自动去重。

上面的示例会创建两个平台负责人记录，并只向 `wecomContactIds=[7]` 对应的一名企微成员创建企微待办。不会把平台负责人自动并入企微参与人。

服务端传给 `create_todo` 的 `follower_list` 也只包含这名成员。如果企业微信客户端仍显示两个人，另一位通常是企业微信自动展示的待办创建者或机器人授权账号，并不是平台负责人被接口重复加入；是否展示创建者由企业微信客户端决定。

成功响应：

```json
{
  "ok": true,
  "ids": ["d789a6dd-...", "58310d6c-...", "810e4688-..."],
  "syncStatus": "pending",
  "syncDetail": "已进入企业微信待办同步队列。",
  "skippedPlatformAssigneeNames": [],
  "detail": "平台待办已创建，企业微信同步状态已记录。"
}
```

`syncStatus`：

- `not_requested`：仅平台待办。
- `pending`：等待企微同步。
- `synced`：企微同步成功。
- `failed`：企微同步失败。
- `partial`：多个企微参与人中仅部分同步成功。

## 5. 查询待办

```http
GET /api/wecom/todos/?view=assigned&status=pending
GET /api/wecom/todos/?view=created&status=completed
GET /api/wecom/todos/?view=created&q=运营&priority=high&page=1&pageSize=20
GET /api/wecom/todos/?view=created&dateFrom=2026-07-01&dateTo=2026-07-31&page=1&pageSize=20
```

参数：

- `view=assigned`：我负责的平台待办。
- `view=created`：我创建的待办。
- `status=pending`：进行中。
- `status=completed`：历史已完成。
- 不传 `status`：全部。
- `q`：按标题或说明搜索。
- `priority`：`normal`、`high` 或 `urgent`。
- `dateFrom` / `dateTo`：按截止日期筛选，格式为 `YYYY-MM-DD`。
- `page`：页码，默认 `1`。
- `pageSize`：每页数量，范围 `1~100`，默认 `20`。

```bash
curl "http://127.0.0.1:8000/api/wecom/todos/?view=created&status=pending" \
  -H "Authorization: Token <登录令牌>"
```

响应包含 `count`、`page`、`pageSize` 和当前页 `results`。`recipients` 会区分 `platform` 与 `wecom`，用于展示所有负责人；`syncStatus` 只统计实际要求同步企业微信的记录，平台负责人不会导致“部分同步”。

分页在数据库中先按 `sync_group_id` 聚合、计数并截取当前页，再读取该页负责人明细，不会随历史数据增长而把全部待办加载到应用进程。

## 联系人隐私与通知发送

- `GET /api/wecom/contacts/` 仅返回平台内部 `contactId`、姓名、部门、职位、头像和可用状态，不返回企业微信 UserID。
- 个人任务通知使用 `recipientContactIds`，服务端在当前企业及当前可用配置范围内解析企业微信 UserID。
- `GET /api/wecom/contacts/manage/` 仅企业管理员可访问，用于账号绑定管理；普通成员访问返回 `403`。
- 旧版 `recipientUserIds` 暂时保留兼容，但服务端会校验这些 UserID 必须存在于当前企业的可用通讯录缓存中。

个人通知请求示例：

```json
{
  "mode": "person",
  "recipientContactIds": [7, 9],
  "task": "完成本周运营复盘",
  "priority": "high"
}
```

同步与删除采用短事务领取操作令牌，企业微信网络请求在数据库事务之外执行。两分钟内重复触发同一组同步不会重复创建企业微信原生待办；超时领取可由后台补偿任务恢复。

## 6. 更新待办状态

```http
POST /api/wecom/todos/status/
```

```json
{
  "id": "d789a6dd-0000-0000-0000-000000000000",
  "status": "completed"
}
```

`status` 可为 `pending` 或 `completed`。当前用户只能修改分配给自己或与自己平台账号绑定的企微待办；从 `completed` 改为 `pending` 即重新打开。平台与对应企微负责人状态会一起更新。

## 7. 修改待办内容

```http
PATCH /api/wecom/todos/{todo_id}/
```

仅创建人可修改。所有字段均可选，但至少提交一个：

```json
{
  "title": "更新后的标题",
  "description": "补充交付说明",
  "dueAt": "2026-07-19T18:00:00+08:00",
  "priority": "urgent",
  "remindTypes": [5]
}
```

提醒类型：`0` 不提醒、`1` 截止时、`3` 提前 15 分钟、`5` 提前 1 小时、`6` 提前 2 小时、`7` 提前 1 天、`8` 提前 2 天、`9` 提前 1 周。已同步的企微原生待办会同时更新；失败会记录并可重试。

## 8. 重新同步企业微信

```http
POST /api/wecom/todos/{todo_id}/sync/
```

```bash
curl -X POST "http://127.0.0.1:8000/api/wecom/todos/d789a6dd-0000-0000-0000-000000000000/sync/" \
  -H "Authorization: Token <登录令牌>"
```

仅创建人或企业管理员可触发整组重试，避免普通负责人重复发送或修改其他参与人。仅平台待办会返回未启用企微同步。

## 9. 删除待办

```http
DELETE /api/wecom/todos/{todo_id}/
```

仅创建人可删除。存在企微原生待办时，系统先删除企微待办，再删除本地整组记录；企微删除失败时保留平台记录，避免数据失联。

## 10. 企业微信待办机器人配置

```http
GET /api/wecom/cli-config/
PATCH /api/wecom/cli-config/
POST /api/wecom/cli-config/test/
```

该配置属于企业并受可用成员范围控制。密钥只在服务端加密保存，接口不会返回完整敏感明文。

## 11. 常见错误

| HTTP | 场景 |
| --- | --- |
| 400 | 参数错误、负责人不属于当前企业、企微联系人不可用 |
| 401 | 未登录或 Token 无效 |
| 403 | 无权限操作或不在配置可用范围 |
| 404 | 待办不存在 |
| 409 | 当前账号尚未加入企业或企业未配置待办机器人 |
