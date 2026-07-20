# 用户头像 API

## 上传头像

`POST /api/auth/avatar/`

- 认证：`Authorization: Token <token>`
- 请求：`multipart/form-data`
- 文件字段：`file`（兼容 `avatar`）
- 格式：PNG、JPG/JPEG、GIF、WebP、BMP
- 大小：不超过 5 MB
- 存储：腾讯云 COS，默认对象前缀 `media/avatars`，ACL 为 `private`
- 失败策略：COS 未配置或上传失败时返回 `503`，不会回退写入本地磁盘

成功响应：

```json
{
  "ok": true,
  "avatar": "cos:u1_example.png",
  "avatar_url": "/api/auth/avatars/cos:u1_example.png/",
  "user": {}
}
```

## 读取头像

`GET|HEAD /api/auth/avatars/{stored_id}/`

- 认证：`Authorization: Token <token>`，兼容 `?token=<token>`
- COS 头像由后端鉴权后读取，不返回 COS 密钥或直链
- 暂时兼容迁移前的本地头像标识；所有新上传只写入 COS

## 配置

```dotenv
USE_TENCENT_COS=true
TENCENT_COS_SECRET_ID=
TENCENT_COS_SECRET_KEY=
TENCENT_COS_BUCKET=
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_AVATAR_LOCATION=media/avatars
TENCENT_COS_AVATAR_ACL=private
```

## 历史迁移

```powershell
python manage.py migrate_avatars_to_cos
python manage.py migrate_avatars_to_cos --clear-missing
```
