from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0008_skillasset_source_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillasset",
            name="sop_callable",
            field=models.BooleanField(db_index=True, default=False, verbose_name="可用于 SOP"),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="action_key",
            field=models.CharField(
                blank=True,
                default="",
                help_text="为空时自动使用 skill:<asset_id>",
                max_length=96,
                verbose_name="SOP 动作键",
            ),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="sop_high_risk",
            field=models.BooleanField(default=False, verbose_name="SOP 高风险（需确认）"),
        ),
    ]
