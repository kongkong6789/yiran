# 业务库只读同步说明（Baserow PostgreSQL Data Sync）

Baserow 系统表在独立数据库 `liangce_baserow`。
若要把现有 `liangce` 业务表拉进智能表格：

1. 在 PostgreSQL 创建只读账号，例如 `liangce_baserow_ro`，仅授予 `liangce` 中需要同步的表 SELECT。
2. 打开 Baserow → Database → 新建表 → 选择 **PostgreSQL data sync**。
3. 填写与平台相同的主机/端口，数据库名 `liangce`，只读账号。
4. 选择 schema/表进行同步；写回业务库请走良策 Django API / 自动化，不要给 Baserow 业务库写权限。

旧自研 SmartTable 导出走：

```powershell
cd backend
python manage.py export_smarttable_for_baserow --out ..\smarttable_export.json
# Baserow 启动并完成首次管理员注册后：
py -3.14 ..\scripts\import-smarttable-to-baserow.py --file ..\smarttable_export.json --email YOU@example.com --password '...'
```
