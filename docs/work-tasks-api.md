# 工作任务 API

本文档描述“工作 → 任务”页面的任务记录、执行进度、通知状态、任务产物和执行回执接口。

## 1. 通用约定

- 本地地址：`http://127.0.0.1:8000`
- 局域网地址：`http://192.168.0.204:8000`
- 请求头：`Authorization: Token <登录令牌>`
- JSON 请求需携带：`Content-Type: application/json`
- 查询和产物访问按当前登录用户隔离。

> 待办接口的 `wecomContactIds` 是平台通讯录缓存 ID；任务接口当前的 `assigneeWeComUserIds` 是企业微信 UserID。两者不是同一种 ID。

## 2. 创建或幂等更新任务

```http
POST /api/tasks/
```

同一发起人重复提交相同 `traceId` 时更新原任务，不创建重复任务。

请求示例：

```json
{
  "traceId": "e85c9ef3c98c",
  "title": "生成昨日运营日报",
  "sopId": "report.generate",
  "agentName": "运营智能体",
  "priority": "high",
  "deadline": "2026-07-18T18:00:00+08:00",
  "assigneeWeComUserIds": ["zhangsan", "lisi"],
  "assigneeNames": ["张三", "李四"],
  "notificationMode": "person",
  "notificationTarget": "张三、李四",
  "progress": 75,
  "timeline": [],
  "parameters": {
    "dt": "2026-07-17",
    "scope": "all"
  },
  "resultData": {
    "ok": true,
    "status": "accepted"
  },
  "generateArtifacts": true
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `traceId` | string | 是 | 任务链路 ID，最长 64 字符；作为幂等键 |
| `title` | string | 是 | 任务标题 |
| `sopId` | string | 否 | SOP ID，例如 `report.generate` |
| `agentName` | string | 否 | 执行智能体名称 |
| `priority` | string | 否 | `normal`、`high`、`urgent` |
| `deadline` | ISO 8601 string | 否 | 截止时间 |
| `assigneeWeComUserIds` | string[] | 否 | 企业微信 UserID；服务端通过已匹配绑定关系找到平台负责人 |
| `recipientUserIds` | string[] | 否 | 旧版兼容字段；未传 `assigneeWeComUserIds` 时使用 |
| `assigneeNames` | string[] | 否 | 负责人展示名称 |
| `notificationMode` | string | 否 | `person`、`group` 或空值 |
| `notificationTarget` | string | 否 | 通知对象展示文案 |
| `progress` | number | 否 | 0–100，默认 75 |
| `timeline` | array | 否 | 执行轨迹 |
| `parameters` | object | 否 | SOP 参数，后端字段名保持不变 |
| `resultData` | object | 否 | 实际执行结果 |
| `generateArtifacts` | boolean | 否 | 是否生成 Markdown、JSON、Excel 产物，默认 `true` |

负责人关联规则：

- 服务端只在当前企业内查询 `UserWeComBinding`。
- 只有状态为 `matched` 的绑定才会加入任务的平台负责人。
- 未绑定的平台账号不会出现在“我收到的任务”中。
- 同一个企业微信 UserID 不能绑定多个平台用户。

成功响应：

```json
{
  "ok": true,
  "task": {
    "id": 12,
    "traceId": "e85c9ef3c98c",
    "title": "生成昨日运营日报",
    "status": "running",
    "statusLabel": "执行中",
    "progress": 75,
    "artifacts": []
  }
}
```

## 3. 查询我发出的任务 / 我收到的任务

```http
GET /api/tasks/?view=sent
GET /api/tasks/?view=received
```

```bash
curl "http://127.0.0.1:8000/api/tasks/?view=received" \
  -H "Authorization: Token <登录令牌>"
```

接口最多返回最近 100 条任务，每条记录包含：

- 发起人、负责人、截止时间和优先级。
- `status`、`statusLabel` 与 `progress`。
- 企业微信通知状态。
- 完整执行时间线 `timeline`。
- 可访问的任务产物 `artifacts`。

任务状态：`pending`、`running`、`completed`、`partial`、`failed`。

## 4. 更新任务执行状态

```http
PATCH /api/tasks/{trace_id}/
```

只有任务发起人可以更新。

```json
{
  "status": "completed",
  "progress": 100,
  "sopId": "report.generate",
  "notificationStatus": "accepted",
  "notificationRecordId": 36,
  "timeline": [
    {
      "name": "任务执行完成",
      "status": "completed",
      "time": "17:41:24",
      "description": "SOP、任务分配与通知状态均已记录。"
    }
  ],
  "parameters": {
    "dt": "2026-07-17"
  },
  "resultData": {
    "ok": true
  }
}
```

传入 `parameters` 或 `resultData` 时会重新生成任务产物。

## 5. 任务产物

创建任务且 `generateArtifacts=true` 后，默认生成：

- Markdown 任务执行报告。
- JSON 原始数据。
- Excel 工作簿。

产物结构示例：

```json
{
  "id": 13,
  "name": "任务执行报告",
  "filename": "生成昨日运营日报.md",
  "type": "document",
  "format": "Markdown 文档",
  "size": "1 KB",
  "created_at": "2026-07-17T09:41:25+00:00",
  "preview_url": "/tasks/e85c9ef3c98c/artifacts/13/preview/",
  "download_url": "/tasks/e85c9ef3c98c/artifacts/13/download/"
}
```

### 在线预览

```http
GET /api/tasks/{trace_id}/artifacts/{artifact_id}/preview/
```

Markdown 和 JSON 支持在线预览；Excel 返回 400，需下载查看。

### 下载

```http
GET /api/tasks/{trace_id}/artifacts/{artifact_id}/download/
```

只有任务发起人或该任务已关联的平台负责人可以预览和下载。

## 6. 保存执行回执

```http
POST /api/task-results/
```

```json
{
  "traceId": "e85c9ef3c98c",
  "sopId": "report.generate",
  "status": "success",
  "title": "运营日报执行结果",
  "snapshot": {
    "summary": ["日报已生成"],
    "notificationStatus": "accepted"
  }
}
```

`traceId` 与 `snapshot` 必填；同一用户、同一 `traceId` 会更新原回执。

## 7. 查询与导出执行回执

```http
GET /api/task-results/{trace_id}/
GET /api/task-results/{trace_id}/export/
```

回执属于创建它的当前用户。导出接口返回 JSON 附件。

## 8. 创建跟进任务

```http
POST /api/task-results/{trace_id}/follow-ups/
```

```json
{
  "title": "复核异常订单",
  "description": "检查日报中的三条异常订单"
}
```

## 9. 标记关注事项已处理

```http
POST /api/task-results/{trace_id}/attention/{item_id}/resolve/
```

重复调用是幂等的，不会重复写入同一关注事项 ID。

## 10. 完整 cURL 示例

```bash
curl -X POST "http://127.0.0.1:8000/api/tasks/" \
  -H "Authorization: Token <登录令牌>" \
  -H "Content-Type: application/json" \
  -d '{
    "traceId": "demo-20260717-001",
    "title": "生成昨日运营日报",
    "sopId": "report.generate",
    "agentName": "运营智能体",
    "priority": "normal",
    "progress": 10,
    "parameters": {"dt": "2026-07-17", "scope": "all"},
    "resultData": {},
    "generateArtifacts": true
  }'
```

## 11. 常见错误

| HTTP | 场景 |
| --- | --- |
| 400 | `traceId`/`title` 缺失、状态或优先级无效、Excel 请求在线预览 |
| 401 | 未登录或 Token 无效 |
| 404 | 任务、回执或产物不存在，或当前用户无权访问 |

