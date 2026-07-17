from django.db import migrations


def reset_legacy_callback_credentials(apps, schema_editor):
    """旧版本由用户填写；清空后由新代码首次读取时生成合规凭据。"""
    WeComApiConfig = apps.get_model("wecom", "WeComApiConfig")
    WeComApiConfig.objects.update(
        callback_url="",
        token_encrypted="",
        encoding_aes_key_encrypted="",
        callback_verified_at=None,
    )


class Migration(migrations.Migration):
    dependencies = [("wecom", "0003_callback_events")]
    operations = [migrations.RunPython(reset_legacy_callback_credentials, migrations.RunPython.noop)]
