import uuid

import django.db.models.deletion
from django.db import migrations, models


def populate_callback_keys(apps, schema_editor):
    WeComApiConfig = apps.get_model("wecom", "WeComApiConfig")
    for config in WeComApiConfig.objects.filter(callback_key__isnull=True).iterator(chunk_size=100):
        config.callback_key = uuid.uuid4()
        config.save(update_fields=["callback_key"])


class Migration(migrations.Migration):
    dependencies = [("wecom", "0002_userwecombinding_wecombindingauditlog_and_more")]

    operations = [
        migrations.AddField(
            model_name="wecomapiconfig",
            name="callback_key",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="wecomapiconfig",
            name="callback_verified_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="回调验证时间"),
        ),
        migrations.AddField(
            model_name="wecomapiconfig",
            name="last_event_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="最后事件时间"),
        ),
        migrations.RunPython(populate_callback_keys, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="wecomapiconfig",
            name="callback_key",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True, verbose_name="回调标识"),
        ),
        migrations.CreateModel(
            name="WeComCallbackEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("dedup_key", models.CharField(max_length=64, unique=True, verbose_name="幂等键")),
                ("msg_type", models.CharField(blank=True, default="", max_length=32, verbose_name="消息类型")),
                ("event_type", models.CharField(blank=True, db_index=True, default="", max_length=64, verbose_name="事件类型")),
                ("change_type", models.CharField(blank=True, default="", max_length=64, verbose_name="变更类型")),
                ("from_user_id", models.CharField(blank=True, default="", max_length=128, verbose_name="发送成员 UserID")),
                ("to_user_name", models.CharField(blank=True, default="", max_length=128, verbose_name="接收企业")),
                ("event_key", models.CharField(blank=True, default="", max_length=255, verbose_name="事件 Key")),
                ("payload", models.JSONField(default=dict, verbose_name="解密后的事件数据")),
                ("received_at", models.DateTimeField(auto_now_add=True, verbose_name="接收时间")),
                ("config", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="callback_events", to="wecom.wecomapiconfig")),
            ],
            options={
                "verbose_name": "企业微信回调事件",
                "verbose_name_plural": "企业微信回调事件",
                "ordering": ["-received_at", "id"],
            },
        ),
    ]
