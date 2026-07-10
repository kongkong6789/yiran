from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ontology", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="ontrelation",
            name="polarity",
            field=models.CharField(
                blank=True,
                choices=[("+", "正(+)"), ("-", "负(-)")],
                default="",
                max_length=1,
                verbose_name="因果极性",
            ),
        ),
        migrations.AddField(
            model_name="ontrelation",
            name="delay_days",
            field=models.FloatField(blank=True, null=True, verbose_name="延迟(天)"),
        ),
        migrations.AddField(
            model_name="ontrelation",
            name="evidence_score",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="证据分"),
        ),
        migrations.AddField(
            model_name="ontrelation",
            name="is_causal_candidate",
            field=models.BooleanField(default=False, verbose_name="CausalLink候选"),
        ),
    ]
