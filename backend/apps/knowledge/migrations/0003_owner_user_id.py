from django.db import migrations, models


def copy_owner_to_owner_user_id(apps, schema_editor):
    table = "knowledge_knowledgebase"
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = %s AND column_name = 'owner_id'
            """,
            [table],
        )
        has_owner_id = cursor.fetchone() is not None
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = %s AND column_name = 'owner_user_id'
            """,
            [table],
        )
        has_owner_user_id = cursor.fetchone() is not None
        if has_owner_id and has_owner_user_id:
            cursor.execute(
                f"""
                UPDATE {table}
                SET owner_user_id = owner_id
                WHERE owner_user_id IS NULL AND owner_id IS NOT NULL
                """
            )


class Migration(migrations.Migration):
    dependencies = [
        ("knowledge", "0002_knowledgeembedding"),
    ]

    operations = [
        migrations.AddField(
            model_name="knowledgebase",
            name="owner_user_id",
            field=models.PositiveIntegerField(blank=True, db_index=True, null=True, verbose_name="负责人用户ID"),
        ),
        migrations.RunPython(copy_owner_to_owner_user_id, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="knowledgebase",
            name="owner",
        ),
    ]
