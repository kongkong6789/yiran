from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0015_worktodo_linked_platform_user")]

    operations = [
        migrations.AlterField(
            model_name="worktodo",
            name="creator",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="created_work_todos",
                to="auth.user",
            ),
        ),
    ]
