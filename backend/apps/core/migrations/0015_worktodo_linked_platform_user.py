from django.db import migrations, models
import django.db.models.deletion


def link_existing_wecom_rows(apps, schema_editor):
    WorkTodo = apps.get_model("core", "WorkTodo")
    UserWeComBinding = apps.get_model("wecom", "UserWeComBinding")

    for row in WorkTodo.objects.filter(recipient_type="wecom", wecom_contact_id__isnull=False).iterator():
        contact = row.wecom_contact
        binding = UserWeComBinding.objects.filter(
            wecom_config_id=contact.config_id,
            wecom_userid=contact.wecom_userid,
            status="matched",
        ).first()
        if not binding:
            continue
        same_group_platform = WorkTodo.objects.filter(
            sync_group_id=row.sync_group_id,
            recipient_type="platform",
            assignee_id=binding.platform_user_id,
        ).first()
        if not same_group_platform:
            continue
        row.linked_platform_user_id = binding.platform_user_id
        if row.status == "completed" or same_group_platform.status == "completed":
            row.status = "completed"
            same_group_platform.status = "completed"
            row.save(update_fields=["linked_platform_user", "status"])
            same_group_platform.save(update_fields=["status"])
        else:
            row.save(update_fields=["linked_platform_user"])

    mixed_group_ids = WorkTodo.objects.filter(recipient_type="wecom").values_list("sync_group_id", flat=True)
    WorkTodo.objects.filter(
        sync_group_id__in=mixed_group_ids,
        recipient_type="platform",
    ).update(
        sync_requested=False,
        sync_status="not_requested",
        sync_error_code="",
        sync_error_reason="",
        sync_next_retry_at=None,
        wecom_todo_id_encrypted="",
        wecom_todo_userid_encrypted="",
    )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0014_worktodo_wecom_todo_userid"),
        ("wecom", "0011_wecomcliconfig_access_scope_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="worktodo",
            name="assignee",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assigned_work_todos",
                to="auth.user",
            ),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="linked_platform_user",
            field=models.ForeignKey(
                blank=True,
                help_text="企业微信负责人通过绑定关系对应的平台用户；不等同于平台负责人字段。",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="linked_wecom_work_todos",
                to="auth.user",
            ),
        ),
        migrations.AddIndex(
            model_name="worktodo",
            index=models.Index(
                fields=["organization", "linked_platform_user", "status"],
                name="todo_org_linked_status",
            ),
        ),
        migrations.RunPython(link_existing_wecom_rows, migrations.RunPython.noop),
    ]
