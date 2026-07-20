# 团队 API

本文档描述「账号与企业成员 → 团队」页面使用的团队管理接口。团队分为**平台团队（跨企业）**与**企业团队（企业内小组）**，用于知识库等场景界定可见范围，与企业成员角色（所有者/管理员/成员）相互独立。

## 1. 通用约定

- 本地地址：`http://127.0.0.1:8000`
- 局域网地址：`http://192.168.0.204:8000`
- 请求头：`Authorization: Token <登录令牌>`
- JSON 请求需携带：`Content-Type: application/json`
- 所有接口均要求登录。团队列表对普通成员开放；创建、修改和成员管理接口仍要求对应的管理权限，否则返回 `401` / `403`。

### 两类团队

| 类型 | `kind` | 归属 | 谁可管理 | 成员范围 |
| --- | --- | --- | --- | --- |
| 平台团队 | `platform` | 跨企业，无 `organization` | 已加入该团队的平台管理员（`is_staff`）或超级管理员 | 任意启用的平台用户 |
| 企业团队 | `enterprise` | 归属某个企业 | 当前企业的所有者/管理员 | 仅该企业的启用成员 |

### 可见范围

- 企业团队：只返回调用者**当前企业**下的团队。用户即使同时属于多个企业，也必须先切换当前企业，不能在一个企业上下文中看到其他企业团队。
- 平台团队：不受当前企业限制，但只返回调用者已经加入的团队；平台管理员和超级管理员也不会自动看到未加入的平台团队。
- 企业内的普通成员可以查看当前企业团队；是否为团队显式成员只影响团队成员名单，不影响企业团队的基础可见性。

### 团队对象结构

列表与写操作成功后都会返回团队对象：

```json
{
  "id": 12,
  "name": "品牌增长小组",
  "kind": "enterprise",
  "kindLabel": "企业团队",
  "description": "负责品牌增长相关的知识沉淀",
  "organizationId": 1,
  "organizationName": "良策 AI",
  "isActive": true,
  "memberCount": 3,
  "pendingWecomCount": 1,
  "canManage": true,
  "createdAt": "2026-07-20T10:00:00+00:00",
  "members": [
    {
      "id": 25,
      "username": "liangzx",
      "displayName": "梁振星",
      "role": "lead",
      "roleLabel": "团队负责人",
      "isActive": true,
      "wecomBound": true
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | string | `platform` 或 `enterprise` |
| `organizationId` | number / null | 企业团队所属企业；平台团队为 `null` |
| `memberCount` | number | 启用成员数量（不含已停用账号） |
| `pendingWecomCount` | number | 企业团队中尚未绑定企业微信的启用成员数量；平台团队恒为 `0` |
| `canManage` | boolean | 当前调用者是否可管理该团队 |
| `members[].role` | string | 团队角色：`lead`（负责人）或 `member`（成员） |
| `members[].wecomBound` | boolean | 该成员是否已成功绑定企业微信（`UserWeComBinding.status = matched`） |

### 企业微信绑定状态

企业团队成员需绑定企业微信后才算真正可用。成员绑定状态由 `wecomBound` 表示：

- `wecomBound = true`：已绑定（企业微信绑定状态为 `matched`）。
- `wecomBound = false`：尚未绑定，前端标记为「待绑定企微」。绑定成功后该字段自动变为 `true`，无需重新邀请。

添加成员时不会因未绑定企业微信而拒绝（仍可邀请），仅在展示上标记待绑定状态。此约束只作用于企业团队；平台团队跨企业，不做企业微信绑定校验。

## 2. 查询团队列表

```http
GET /api/auth/teams/
GET /api/auth/teams/?kind=platform
GET /api/auth/teams/?kind=enterprise
```

参数：

- `kind`（可选）：按团队类型筛选，取值 `platform` 或 `enterprise`，非法值忽略。

```bash
curl "http://127.0.0.1:8000/api/auth/teams/" \
  -H "Authorization: Token <登录令牌>"
```

响应：

```json
{
  "ok": true,
  "count": 2,
  "results": [ /* 团队对象数组 */ ]
}
```

## 3. 创建团队

```http
POST /api/auth/teams/
```

请求体：

```json
{
  "name": "品牌增长小组",
  "kind": "enterprise",
  "description": "选填，简述团队职责或用途",
  "organizationId": 1,
  "memberIds": [25, 31]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 团队名称，最多 128 字符 |
| `kind` | string | 否 | `platform` 或 `enterprise`，默认 `enterprise` |
| `description` | string | 否 | 团队说明，最多 255 字符 |
| `organizationId` | number | 否 | 仅超级管理员创建企业团队时可指定；其他情况默认使用当前企业 |
| `memberIds` | number[] | 否 | 初始成员的平台用户 ID，自动去重，角色默认为 `member` |

校验与权限：

- `kind=platform`：仅平台管理员或超级管理员可创建；`organization` 强制为空。
- 创建平台团队时，创建人会自动加入团队，确保创建后仍可查看和管理。
- `kind=enterprise`：需为目标企业的管理员；超级管理员可通过 `organizationId` 指定企业，其余人默认落到当前企业。
- `memberIds` 必须落在可选范围内（平台团队为全部启用用户，企业团队为该企业成员），否则返回 `400`。

成功响应（`201`）：

```json
{
  "ok": true,
  "team": { /* 团队对象 */ }
}
```

## 4. 修改团队

```http
PATCH /api/auth/teams/{team_id}/
```

仅可管理该团队者可调用（见第 1 节可见范围）。所有字段均可选，只提交需要变更的字段：

```json
{
  "name": "增长与内容小组",
  "description": "更新后的说明",
  "isActive": true
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 团队名称，不能为空，最多 128 字符 |
| `description` | string | 团队说明，最多 255 字符 |
| `isActive` | boolean | 启用/停用团队 |

> 团队类型（`kind`）与归属企业创建后不可修改。

成功响应：

```json
{
  "ok": true,
  "team": { /* 团队对象 */ }
}
```

## 5. 删除团队

```http
DELETE /api/auth/teams/{team_id}/
```

```bash
curl -X DELETE "http://127.0.0.1:8000/api/auth/teams/12/" \
  -H "Authorization: Token <登录令牌>"
```

仅可管理该团队者可调用。删除会一并移除该团队的成员归属关系；引用该团队的知识库可见范围将失效。此操作不可恢复。

成功响应：

```json
{
  "ok": true,
  "deleted": "品牌增长小组"
}
```

## 6. 添加团队成员

```http
POST /api/auth/teams/{team_id}/members/
```

请求体：

```json
{
  "userIds": [25, 31],
  "role": "member"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `userIds` | number[] | 是 | 平台用户 ID，自动去重 |
| `role` | string | 否 | `lead` 或 `member`，默认 `member` |

校验：

- 成员必须落在团队的可选范围内（平台团队为全部启用用户，企业团队为该企业成员），否则返回 `400`。
- 已在团队内的用户会被跳过，不重复添加。

候选成员通过第 8 节的接口获取。

成功响应：

```json
{
  "ok": true,
  "addedCount": 2,
  "team": { /* 团队对象 */ }
}
```

`addedCount` 为实际新增（去重、去除已存在成员后）的数量。

## 7. 移出团队成员

```http
DELETE /api/auth/teams/{team_id}/members/{user_id}/
```

```bash
curl -X DELETE "http://127.0.0.1:8000/api/auth/teams/12/members/25/" \
  -H "Authorization: Token <登录令牌>"
```

仅可管理该团队者可调用。移出后该成员不再属于此团队，其平台账号与企业成员关系不受影响。

成功响应：

```json
{
  "ok": true,
  "removedUserId": 25,
  "team": { /* 团队对象 */ }
}
```

## 8. 查询团队成员候选人

```http
GET /api/auth/teams/user-options/?kind=platform
GET /api/auth/teams/user-options/?kind=enterprise
GET /api/auth/teams/user-options/?kind=enterprise&organizationId=1
```

用于创建团队或添加成员时的成员选择：

- `kind=platform`：返回全部启用的平台用户，仅平台管理员或超级管理员可访问。
- `kind=enterprise`：返回目标企业的启用成员；超级管理员可用 `organizationId` 指定企业，其余人默认当前企业。

参数：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | string | `platform` 或 `enterprise`，默认 `enterprise` |
| `organizationId` | number | 仅超级管理员查询企业团队候选人时可指定 |

```bash
curl "http://127.0.0.1:8000/api/auth/teams/user-options/?kind=enterprise" \
  -H "Authorization: Token <登录令牌>"
```

响应（最多返回 1000 条）：

```json
{
  "ok": true,
  "count": 2,
  "results": [
    { "id": 25, "username": "liangzx", "displayName": "梁振星", "wecomBound": true },
    { "id": 31, "username": "wangfang", "displayName": "王芳", "wecomBound": false }
  ]
}
```

`wecomBound` 表示候选人是否已绑定企业微信，前端可据此对未绑定用户加「待绑定企微」提示。

## 9. 常见错误

| HTTP | 场景 |
| --- | --- |
| 400 | 参数错误、团队名称为空、`kind` 非法、成员不在可选范围内 |
| 401 | 未登录或 Token 无效 |
| 403 | 无管理权限、跨越权限创建/管理团队、查看无权企业成员 |
| 404 | 团队不存在、企业不存在、成员不在团队内 |
