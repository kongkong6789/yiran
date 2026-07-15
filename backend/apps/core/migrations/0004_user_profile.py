from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_user_auth"),
    ]

    operations = [
        migrations.AddField(
            model_name="usersettings",
            name="display_name",
            field=models.CharField(blank=True, default="", max_length=64, verbose_name="显示名称"),
        ),
        migrations.AddField(
            model_name="usersettings",
            name="bio",
            field=models.CharField(blank=True, default="", max_length=200, verbose_name="个性签名"),
        ),
        migrations.AddField(
            model_name="usersettings",
            name="methodology",
            field=models.TextField(blank=True, default="", verbose_name="方法论"),
        ),
        migrations.AddField(
            model_name="usersettings",
            name="avatar",
            field=models.CharField(blank=True, default="", max_length=255, verbose_name="头像文件"),
        ),
    ]
