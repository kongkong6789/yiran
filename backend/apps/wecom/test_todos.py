from unittest.mock import Mock, patch
import uuid
from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.models import Organization, OrganizationMembership, WorkTodo

from .cli_service import WeComCliClient, WeComCliError
from .models import UserWeComBinding, WeComApiConfig, WeComCliConfig, WeComContact
from .todo_sync_service import (
    process_due_work_todo_syncs,
    refresh_assignee_from_wecom,
    refresh_contact_from_wecom,
    sync_work_todo_group,
)


User = get_user_model()


class WeComTodoTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("todo-owner", password="password123")
        self.member = User.objects.create_user("todo-member", password="password123")
        self.outsider = User.objects.create_user("todo-outsider", password="password123")
        self.organization = Organization.objects.create(name="待办测试企业", created_by=self.owner)
        OrganizationMembership.objects.create(
            organization=self.organization, user=self.owner, role=OrganizationMembership.Role.OWNER
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=self.member, role=OrganizationMembership.Role.MEMBER
        )
        self.api_config = WeComApiConfig.objects.create(
            user=self.owner, organization=self.organization, corp_id="ww-test", agent_id="10001"
        )
        self.api_config.secret = "app-secret"
        self.api_config.save()
        UserWeComBinding.objects.create(
            platform_user=self.member, wecom_config=self.api_config, wecom_userid="hidden-member-id",
            status=UserWeComBinding.Status.MATCHED,
        )
        self.bound_contact = WeComContact.objects.create(
            config=self.api_config, wecom_userid="hidden-member-id", name="杨晓东",
            department="运营中心", available=True, synced_at=timezone.now(),
        )
        self.wecom_only_contact = WeComContact.objects.create(
            config=self.api_config, wecom_userid="wecom-only-id", name="企微同事",
            department="市场中心", available=True, synced_at=timezone.now(),
        )
        self.cli_config = WeComCliConfig.objects.create(
            organization=self.organization, user=self.owner, bot_id="bot-test"
        )
        self.cli_config.bot_secret = "bot-secret"
        self.cli_config.save()

    @patch("apps.wecom.cli_service.requests.post")
    def test_mcp_call_sends_required_json_accept_header(self, post):
        response = Mock(status_code=200, headers={"content-type": "application/json"})
        response.json.return_value = {
            "result": {"content": [{"type": "text", "text": '{"errcode": 0}'}]},
        }
        post.return_value = response
        client = WeComCliClient(self.cli_config)
        with patch.object(client, "_todo_url", return_value="https://example.invalid/mcp"):
            client.call("get_todo_list", {"follower_id": "member"})
        self.assertEqual(post.call_args.kwargs["headers"]["Accept"], "application/json")

    def test_member_cannot_modify_organization_cli_config(self):
        self.client.force_authenticate(self.member)
        response = self.client.patch("/api/wecom/cli-config/", {"botId": "other", "secret": "secret"})
        self.assertEqual(response.status_code, 403)

    @patch("apps.wecom.todo_views.WeComCliClient")
    def test_cli_connection_test_does_not_replace_an_unreadable_saved_secret(self, client_class):
        config = WeComCliConfig.objects.get(organization=self.organization)
        config.bot_secret_encrypted = "unreadable-ciphertext"
        config.save(update_fields=["bot_secret_encrypted", "updated_at"])
        self.client.force_authenticate(self.owner)

        response = self.client.post("/api/wecom/cli-config/test/", {
            "secret": "unsaved-secret",
        }, format="json")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "credential_decrypt_failed")
        config.refresh_from_db()
        self.assertEqual(config.bot_secret_encrypted, "unreadable-ciphertext")
        client_class.assert_not_called()

    def test_selected_scope_is_enforced_by_todo_api(self):
        config = WeComCliConfig.objects.get(organization=self.organization)
        config.access_scope = WeComCliConfig.AccessScope.SELECTED
        config.save(update_fields=["access_scope", "updated_at"])
        self.client.force_authenticate(self.member)
        platform_list = self.client.get("/api/wecom/todos/?view=assigned")
        self.assertEqual(platform_list.status_code, 200)
        denied_sync = self.client.post("/api/wecom/todos/", {
            "title": "仅保留平台", "assigneeIds": [self.member.id],
            "wecomContactIds": [self.wecom_only_contact.id], "syncToWeCom": True,
        }, format="json")
        self.assertEqual(denied_sync.status_code, 201)
        self.assertEqual(denied_sync.data["syncStatus"], WorkTodo.SyncStatus.PENDING)
        process_due_work_todo_syncs()
        self.assertEqual(
            WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.WECOM).sync_error_code,
            "not_authorized",
        )
        config.allowed_users.add(self.member)
        with patch("apps.wecom.todo_sync_service.WeComCliClient") as client_class:
            client_class.return_value.list_todos.return_value = []
            allowed = self.client.get("/api/wecom/todos/?view=assigned")
        self.assertEqual(allowed.status_code, 200)

    def test_config_response_hides_member_scope_ids_from_non_admin(self):
        config = WeComCliConfig.objects.get(organization=self.organization)
        config.access_scope = WeComCliConfig.AccessScope.SELECTED
        config.save(update_fields=["access_scope", "updated_at"])
        config.allowed_users.add(self.member)
        self.client.force_authenticate(self.member)
        response = self.client.get("/api/wecom/cli-config/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["canUse"])
        self.assertEqual(response.data["allowedUserIds"], [])

    def test_todo_members_include_bound_and_unbound_organization_members(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/wecom/todos/members/")
        self.assertEqual(response.status_code, 200)
        results = {item["id"]: item for item in response.data["results"]}
        self.assertEqual(set(results), {self.owner.id, self.member.id})
        self.assertFalse(results[self.owner.id]["bound"])
        self.assertTrue(results[self.member.id]["bound"])
        self.assertNotIn(self.outsider.id, results)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_assigned_list_hides_wecom_user_and_todo_ids(self, client_class):
        row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="完成月报", sync_requested=True, sync_status=WorkTodo.SyncStatus.SYNCED,
        )
        row.wecom_todo_id = "sensitive-todo-id"
        row.save()
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-member-id"
        client_class.return_value.list_todos.return_value = [{
            "todo_id": "sensitive-todo-id", "content": "完成月报", "todo_status": 1,
            "creator_id": "sensitive-creator-id", "follower_list": {
                "followers": [{"follower_id": "todo-scoped-member-id", "name": "杨晓东", "follower_status": 2}]
            },
        }]
        refresh_assignee_from_wecom(organization=self.organization, assignee_id=self.member.id)
        self.client.force_authenticate(self.member)
        response = self.client.get("/api/wecom/todos/?view=assigned&status=completed")
        self.assertEqual(response.status_code, 200)
        rendered = str(response.data)
        self.assertNotIn("sensitive-todo-id", rendered)
        self.assertNotIn("hidden-member-id", rendered)
        self.assertEqual(response.data["results"][0]["assigneeNames"], ["todo-member"])
        self.assertEqual(response.data["results"][0]["status"], WorkTodo.Status.COMPLETED)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_create_native_todo_persists_enterprise_isolated_mirror(self, client_class):
        client = Mock()
        client.search_todo_userid.return_value = "todo-scoped-member-id"
        client.create_todo.return_value = "native-todo-id"
        client_class.return_value = client
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "跟进客户", "assigneeIds": [self.member.id], "remindTypes": [0],
            "wecomContactIds": [self.bound_contact.id],
            "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["syncStatus"], WorkTodo.SyncStatus.PENDING)
        process_due_work_todo_syncs()
        platform_row = WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.PLATFORM)
        row = WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.WECOM)
        self.assertEqual(platform_row.assignee, self.member)
        self.assertFalse(platform_row.sync_requested)
        self.assertEqual(row.organization, self.organization)
        self.assertEqual(row.wecom_contact, self.bound_contact)
        self.assertEqual(row.linked_platform_user, self.member)
        self.assertEqual(row.wecom_todo_id, "native-todo-id")
        self.assertEqual(row.sync_status, WorkTodo.SyncStatus.SYNCED)
        self.assertEqual(row.wecom_todo_userid, "todo-scoped-member-id")
        self.assertEqual(client.create_todo.call_args.kwargs["follower_ids"], ["todo-scoped-member-id"])
        client.change_user_status.assert_called_once()

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_mixed_platform_and_wecom_rows_are_not_reported_as_partial(self, client_class):
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-member-id"
        client_class.return_value.create_todo.return_value = "native-todo-id"
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "混合负责人",
            "platformAssigneeIds": [self.member.id],
            "wecomContactIds": [self.bound_contact.id],
            "syncToWeCom": True,
        }, format="json")
        group_id = WorkTodo.objects.first().sync_group_id
        result = sync_work_todo_group(group_id, force=True)
        self.assertTrue(result["ok"])
        self.assertEqual(result["syncStatus"], WorkTodo.SyncStatus.SYNCED)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_platform_completion_updates_linked_wecom_recipient(self, client_class):
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-member-id"
        client_class.return_value.create_todo.return_value = "native-todo-id"
        self.client.force_authenticate(self.owner)
        self.client.post("/api/wecom/todos/", {
            "title": "双向状态",
            "platformAssigneeIds": [self.member.id],
            "wecomContactIds": [self.bound_contact.id],
            "syncToWeCom": True,
        }, format="json")
        process_due_work_todo_syncs()
        platform_row = WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.PLATFORM)
        self.client.force_authenticate(self.member)
        response = self.client.post("/api/wecom/todos/status/", {
            "id": str(platform_row.public_id), "status": "completed",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(WorkTodo.objects.filter(status=WorkTodo.Status.PENDING).exists())
        self.assertEqual(client_class.return_value.change_user_status.call_args.kwargs["user_status"], 2)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_wecom_completion_updates_linked_platform_recipient(self, client_class):
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-member-id"
        client_class.return_value.create_todo.return_value = "native-todo-id"
        self.client.force_authenticate(self.owner)
        self.client.post("/api/wecom/todos/", {
            "title": "企微完成回写",
            "platformAssigneeIds": [self.member.id],
            "wecomContactIds": [self.bound_contact.id],
            "syncToWeCom": True,
        }, format="json")
        process_due_work_todo_syncs()
        client_class.return_value.list_todos.return_value = [{
            "todo_id": "native-todo-id", "todo_status": 1,
            "follower_list": {"followers": [{"follower_id": "todo-scoped-member-id", "follower_status": 2}]},
        }]
        refresh_contact_from_wecom(organization=self.organization, contact_id=self.bound_contact.id)
        self.assertFalse(WorkTodo.objects.filter(status=WorkTodo.Status.PENDING).exists())

    def test_same_name_different_people_are_not_collapsed(self):
        second_contact = WeComContact.objects.create(
            config=self.api_config, wecom_userid="same-name-other-id", name="杨晓东",
            available=True, synced_at=timezone.now(),
        )
        group_id = uuid.uuid4()
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            recipient_type=WorkTodo.RecipientType.PLATFORM, recipient_name="杨晓东",
            title="同名成员", sync_group_id=group_id,
        )
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, wecom_contact=second_contact,
            recipient_type=WorkTodo.RecipientType.WECOM, recipient_name="杨晓东",
            title="同名成员", sync_group_id=group_id, sync_requested=True,
            sync_status=WorkTodo.SyncStatus.SYNCED,
        )
        self.client.force_authenticate(self.owner)
        result = self.client.get("/api/wecom/todos/?view=created").data["results"][0]
        self.assertEqual(len(result["recipients"]), 2)

    def test_assignee_cannot_retry_entire_group(self):
        row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="限制整组重试", sync_requested=True, sync_status=WorkTodo.SyncStatus.FAILED,
        )
        self.client.force_authenticate(self.member)
        response = self.client.post(f"/api/wecom/todos/{row.public_id}/sync/", {}, format="json")
        self.assertEqual(response.status_code, 403)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_expired_platform_deadline_is_not_sent_as_invalid_wecom_end_time(self, client_class):
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-member-id"
        client_class.return_value.create_todo.return_value = "past-deadline-todo"
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "逾期待办",
            "platformAssigneeIds": [self.member.id],
            "wecomContactIds": [self.bound_contact.id],
            "dueAt": (timezone.now() - timedelta(hours=1)).isoformat(),
            "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        process_due_work_todo_syncs()
        self.assertEqual(client_class.return_value.create_todo.call_args.kwargs["end_time"], "")
        self.assertEqual(
            WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.WECOM).sync_status,
            WorkTodo.SyncStatus.SYNCED,
        )

    def test_platform_only_todo_does_not_require_wecom_config_or_binding(self):
        WeComCliConfig.objects.all().delete()
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "平台内部跟进", "assigneeIds": [self.owner.id], "syncToWeCom": False,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        process_due_work_todo_syncs()
        row = WorkTodo.objects.get()
        self.assertFalse(row.sync_requested)
        self.assertEqual(row.sync_status, WorkTodo.SyncStatus.NOT_REQUESTED)
        self.assertEqual(row.wecom_todo_id, "")

    def test_sync_requires_explicit_wecom_contact(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "仅平台接收", "platformAssigneeIds": [self.owner.id], "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("wecomContactIds", response.data)
        self.assertEqual(WorkTodo.objects.count(), 0)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_wecom_contact_without_platform_account_can_receive_todo(self, client_class):
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-wecom-only-id"
        client_class.return_value.create_todo.return_value = "wecom-contact-todo"
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "企微直接负责人", "platformAssigneeIds": [],
            "wecomContactIds": [self.wecom_only_contact.id], "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        process_due_work_todo_syncs()
        row = WorkTodo.objects.get()
        self.assertIsNone(row.assignee)
        self.assertEqual(row.recipient_type, WorkTodo.RecipientType.WECOM)
        self.assertEqual(row.recipient_name, "企微同事")
        self.assertEqual(row.sync_status, WorkTodo.SyncStatus.SYNCED)
        self.assertEqual(client_class.return_value.create_todo.call_args.kwargs["follower_ids"], ["todo-scoped-wecom-only-id"])
        created = self.client.get("/api/wecom/todos/?view=created&status=pending")
        rendered = str(created.data)
        self.assertIn("企微同事", rendered)
        self.assertNotIn("wecom-only-id", rendered)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_bound_platform_assignee_is_not_implicitly_added_to_wecom_todo(self, client_class):
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-wecom-only-id"
        client_class.return_value.create_todo.return_value = "explicit-recipient-todo"
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "企微仅通知明确联系人",
            "platformAssigneeIds": [self.member.id],
            "wecomContactIds": [self.wecom_only_contact.id],
            "syncToWeCom": True,
        }, format="json")

        self.assertEqual(response.status_code, 201)
        process_due_work_todo_syncs()
        platform_row = WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.PLATFORM)
        self.assertFalse(platform_row.sync_requested)
        self.assertEqual(platform_row.sync_status, WorkTodo.SyncStatus.NOT_REQUESTED)
        self.assertEqual(
            client_class.return_value.create_todo.call_args.kwargs["follower_ids"],
            ["todo-scoped-wecom-only-id"],
        )
        created = self.client.get("/api/wecom/todos/?view=created&status=pending")
        self.assertEqual(created.data["results"][0]["syncStatus"], WorkTodo.SyncStatus.SYNCED)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_mixed_recipients_deduplicate_bound_wecom_contact(self, client_class):
        client_class.return_value.search_todo_userid.side_effect = lambda name: {
            "杨晓东": "todo-scoped-member-id",
            "企微同事": "todo-scoped-wecom-only-id",
        }.get(name, "")
        client_class.return_value.create_todo.return_value = "mixed-todo"
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "混合负责人",
            "platformAssigneeIds": [self.member.id, self.owner.id],
            "wecomContactIds": [self.bound_contact.id, self.wecom_only_contact.id],
            "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(WorkTodo.objects.count(), 4)
        process_due_work_todo_syncs()
        follower_ids = client_class.return_value.create_todo.call_args.kwargs["follower_ids"]
        self.assertCountEqual(follower_ids, ["todo-scoped-member-id", "todo-scoped-wecom-only-id"])
        self.assertEqual(len(follower_ids), len(set(follower_ids)))
        created = self.client.get("/api/wecom/todos/?view=created&status=pending")
        self.assertEqual(created.data["results"][0]["syncStatus"], WorkTodo.SyncStatus.SYNCED)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_out_of_bot_scope_recipient_does_not_block_valid_recipient(self, client_class):
        client_class.return_value.search_todo_userid.side_effect = lambda name: (
            "todo-scoped-member-id" if name == "杨晓东" else ""
        )
        client_class.return_value.create_todo.return_value = "partial-native-todo"
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "部分负责人可触达",
            "platformAssigneeIds": [self.member.id],
            "wecomContactIds": [self.bound_contact.id, self.wecom_only_contact.id],
            "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        process_due_work_todo_syncs()
        platform_row = WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.PLATFORM)
        valid_wecom_row = WorkTodo.objects.get(wecom_contact=self.bound_contact)
        invalid_wecom_row = WorkTodo.objects.get(wecom_contact=self.wecom_only_contact)
        self.assertEqual(platform_row.sync_status, WorkTodo.SyncStatus.NOT_REQUESTED)
        self.assertEqual(valid_wecom_row.sync_status, WorkTodo.SyncStatus.SYNCED)
        self.assertEqual(invalid_wecom_row.sync_status, WorkTodo.SyncStatus.FAILED)
        self.assertEqual(invalid_wecom_row.sync_error_code, "todo_user_not_in_scope")
        self.assertEqual(client_class.return_value.create_todo.call_args.kwargs["follower_ids"], ["todo-scoped-member-id"])
        created = self.client.get("/api/wecom/todos/?view=created&status=pending")
        self.assertEqual(created.data["results"][0]["syncStatus"], "partial")

    def test_cross_organization_wecom_contact_is_rejected(self):
        other_org = Organization.objects.create(name="其他企业", created_by=self.outsider)
        other_config = WeComApiConfig.objects.create(
            user=self.outsider, organization=other_org, corp_id="ww-other", agent_id="10002"
        )
        other_config.secret = "other-secret"
        other_config.save()
        other_contact = WeComContact.objects.create(
            config=other_config, wecom_userid="other-id", name="其他企业成员",
            available=True, synced_at=timezone.now(),
        )
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "越权负责人", "wecomContactIds": [other_contact.id], "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(WorkTodo.objects.count(), 0)

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_wecom_failure_keeps_platform_todo_and_retry_succeeds(self, client_class):
        client_class.return_value.search_todo_userid.return_value = "todo-scoped-member-id"
        client_class.return_value.create_todo.side_effect = WeComCliError("network_error", "企业微信暂时不可用。")
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wecom/todos/", {
            "title": "需要重试", "assigneeIds": [self.member.id],
            "wecomContactIds": [self.bound_contact.id], "syncToWeCom": True,
        }, format="json")
        self.assertEqual(response.status_code, 201)
        process_due_work_todo_syncs()
        row = WorkTodo.objects.get(recipient_type=WorkTodo.RecipientType.WECOM)
        self.assertEqual(row.sync_status, WorkTodo.SyncStatus.FAILED)
        self.assertIsNotNone(row.sync_next_retry_at)

        client_class.return_value.create_todo.side_effect = None
        client_class.return_value.create_todo.return_value = "retried-native-id"
        retry = self.client.post(f"/api/wecom/todos/{row.public_id}/sync/", {}, format="json")
        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.data["ok"])
        row.refresh_from_db()
        self.assertEqual(row.sync_status, WorkTodo.SyncStatus.SYNCED)
        self.assertEqual(row.wecom_todo_id, "retried-native-id")
        repeated = self.client.post(f"/api/wecom/todos/{row.public_id}/sync/", {}, format="json")
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(client_class.return_value.create_todo.call_count, 2)

    def test_platform_only_status_update_is_visible_to_assignee(self):
        row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="平台待办", sync_status=WorkTodo.SyncStatus.NOT_REQUESTED,
        )
        self.client.force_authenticate(self.member)
        response = self.client.post("/api/wecom/todos/status/", {
            "id": str(row.public_id), "status": "completed",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["syncStatus"], WorkTodo.SyncStatus.NOT_REQUESTED)
        row.refresh_from_db()
        self.assertEqual(row.status, WorkTodo.Status.COMPLETED)
        history = self.client.get("/api/wecom/todos/?view=assigned&status=completed")
        self.assertEqual(history.status_code, 200)
        self.assertEqual([item["id"] for item in history.data["results"]], [str(row.public_id)])
        pending = self.client.get("/api/wecom/todos/?view=assigned&status=pending")
        self.assertEqual(pending.data["results"], [])

    def test_assigned_list_includes_every_recipient_in_the_same_todo_group(self):
        second_member = User.objects.create_user("todo-group-member", password="password123")
        OrganizationMembership.objects.create(
            organization=self.organization, user=second_member, role=OrganizationMembership.Role.MEMBER
        )
        group_id = uuid.uuid4()
        current_row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            recipient_name="杨晓东", title="多人共同跟进", sync_group_id=group_id,
            status=WorkTodo.Status.PENDING,
        )
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=second_member,
            recipient_name="平台同事", title="多人共同跟进", sync_group_id=group_id,
            status=WorkTodo.Status.COMPLETED, completed_at=timezone.now(),
        )
        self.wecom_only_contact.avatar_url = "https://example.com/wecom-avatar.png"
        self.wecom_only_contact.save(update_fields=["avatar_url"])
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=None,
            recipient_type=WorkTodo.RecipientType.WECOM, recipient_name="企微同事",
            wecom_contact=self.wecom_only_contact, title="多人共同跟进", sync_group_id=group_id,
            status=WorkTodo.Status.PENDING,
        )

        self.client.force_authenticate(self.member)
        response = self.client.get("/api/wecom/todos/?view=assigned&status=pending")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        result = response.data["results"][0]
        self.assertEqual(result["id"], str(current_row.public_id))
        self.assertEqual(result["status"], WorkTodo.Status.PENDING)
        self.assertEqual(result["assigneeNames"], ["todo-member", "todo-group-member", "企微同事"])
        self.assertEqual(result["recipients"][2]["type"], WorkTodo.RecipientType.WECOM)
        self.assertEqual(result["recipients"][2]["avatar"], "https://example.com/wecom-avatar.png")

    def test_same_platform_and_wecom_recipient_is_displayed_once_and_counted_as_synced(self):
        self.member.username = "企微同事"
        self.member.save(update_fields=["username"])
        group_id = uuid.uuid4()
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            recipient_name="企微同事", title="重复选择负责人", sync_group_id=group_id,
            sync_requested=False, sync_status=WorkTodo.SyncStatus.NOT_REQUESTED,
        )
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=None,
            linked_platform_user=self.member,
            recipient_type=WorkTodo.RecipientType.WECOM, recipient_name="企微同事",
            wecom_contact=self.wecom_only_contact, title="重复选择负责人", sync_group_id=group_id,
            sync_requested=True, sync_status=WorkTodo.SyncStatus.SYNCED,
        )

        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/wecom/todos/?view=created&status=pending")

        self.assertEqual(response.status_code, 200)
        result = response.data["results"][0]
        self.assertEqual(result["syncStatus"], WorkTodo.SyncStatus.SYNCED)
        self.assertEqual(result["assigneeNames"], ["企微同事"])
        self.assertEqual(len(result["recipients"]), 1)
        self.assertEqual(result["recipients"][0]["type"], WorkTodo.RecipientType.WECOM)

    def test_created_history_requires_every_assignee_to_be_completed(self):
        second_member = User.objects.create_user("todo-second-member", password="password123")
        OrganizationMembership.objects.create(
            organization=self.organization, user=second_member, role=OrganizationMembership.Role.MEMBER
        )
        group_id = uuid.uuid4()
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="多人待办", sync_group_id=group_id, status=WorkTodo.Status.COMPLETED,
            completed_at=timezone.now(),
        )
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=second_member,
            title="多人待办", sync_group_id=group_id, status=WorkTodo.Status.PENDING,
        )
        self.client.force_authenticate(self.owner)
        history = self.client.get("/api/wecom/todos/?view=created&status=completed")
        self.assertEqual(history.data["results"], [])
        pending = self.client.get("/api/wecom/todos/?view=created&status=pending")
        self.assertEqual(len(pending.data["results"]), 1)

    def test_creator_can_delete_platform_todo_group_but_assignee_cannot(self):
        group_id = uuid.uuid4()
        row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="删除平台待办", sync_group_id=group_id,
        )
        self.client.force_authenticate(self.member)
        forbidden = self.client.delete(f"/api/wecom/todos/{row.public_id}/")
        self.assertEqual(forbidden.status_code, 404)
        self.assertTrue(WorkTodo.objects.filter(sync_group_id=group_id).exists())

        self.client.force_authenticate(self.owner)
        response = self.client.delete(f"/api/wecom/todos/{row.public_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["weComDeleted"])
        self.assertFalse(WorkTodo.objects.filter(sync_group_id=group_id).exists())

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_creator_deletes_native_wecom_todo_before_platform_group(self, client_class):
        group_id = uuid.uuid4()
        row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="删除企微待办", sync_group_id=group_id,
            sync_requested=True, sync_status=WorkTodo.SyncStatus.SYNCED,
        )
        row.wecom_todo_id = "native-delete-id"
        row.save(update_fields=["wecom_todo_id_encrypted", "updated_at"])
        self.client.force_authenticate(self.owner)

        response = self.client.delete(f"/api/wecom/todos/{row.public_id}/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["weComDeleted"])
        client_class.return_value.delete_todo.assert_called_once_with(todo_id="native-delete-id")
        self.assertFalse(WorkTodo.objects.filter(sync_group_id=group_id).exists())

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_wecom_delete_failure_keeps_platform_todo_for_retry(self, client_class):
        row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="删除失败保留", sync_requested=True, sync_status=WorkTodo.SyncStatus.SYNCED,
        )
        row.wecom_todo_id = "native-delete-failure"
        row.save(update_fields=["wecom_todo_id_encrypted", "updated_at"])
        client_class.return_value.delete_todo.side_effect = WeComCliError("network_error", "企业微信暂时不可用")
        self.client.force_authenticate(self.owner)

        response = self.client.delete(f"/api/wecom/todos/{row.public_id}/")

        self.assertEqual(response.status_code, 502)
        self.assertTrue(WorkTodo.objects.filter(pk=row.pk).exists())

    def test_todo_list_supports_search_priority_and_pagination(self):
        for index in range(3):
            WorkTodo.objects.create(
                organization=self.organization,
                creator=self.owner,
                assignee=self.member,
                title=f"运营日报 {index}",
                description="七月复盘",
                priority=WorkTodo.Priority.HIGH,
            )
        WorkTodo.objects.create(
            organization=self.organization,
            creator=self.owner,
            assignee=self.member,
            title="其他事项",
            priority=WorkTodo.Priority.NORMAL,
        )
        self.client.force_authenticate(self.member)
        response = self.client.get(
            "/api/wecom/todos/?view=assigned&q=七月&priority=high&page=2&pageSize=2"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(response.data["page"], 2)
        self.assertEqual(len(response.data["results"]), 1)

    def test_todo_list_filters_due_date_before_fetching_page_groups(self):
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="范围内", due_at=timezone.make_aware(datetime(2026, 7, 20, 9, 0)),
        )
        WorkTodo.objects.create(
            organization=self.organization, creator=self.owner, assignee=self.member,
            title="范围外", due_at=timezone.make_aware(datetime(2026, 8, 1, 9, 0)),
        )
        self.client.force_authenticate(self.member)
        response = self.client.get(
            "/api/wecom/todos/?view=assigned&dateFrom=2026-07-19&dateTo=2026-07-21&page=1&pageSize=10"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["title"], "范围内")

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_fresh_operation_claim_prevents_duplicate_native_create(self, client_class):
        row = WorkTodo.objects.create(
            organization=self.organization, creator=self.owner,
            recipient_type=WorkTodo.RecipientType.WECOM, recipient_name=self.bound_contact.name,
            wecom_contact=self.bound_contact, title="避免重复", sync_requested=True,
            sync_status=WorkTodo.SyncStatus.PENDING, operation_claim_token=uuid.uuid4(),
            operation_claim_kind="sync", operation_claimed_at=timezone.now(),
        )
        result = sync_work_todo_group(row.sync_group_id, force=True)
        self.assertEqual(result["syncStatus"], WorkTodo.SyncStatus.PENDING)
        client_class.return_value.create_todo.assert_not_called()

    @patch("apps.wecom.todo_sync_service.WeComCliClient")
    def test_creator_can_update_group_and_native_todo(self, client_class):
        group_id = uuid.uuid4()
        row = WorkTodo.objects.create(
            organization=self.organization,
            creator=self.owner,
            recipient_type=WorkTodo.RecipientType.WECOM,
            recipient_name="杨晓东",
            wecom_contact=self.bound_contact,
            title="旧标题",
            sync_group_id=group_id,
            sync_requested=True,
            sync_status=WorkTodo.SyncStatus.SYNCED,
        )
        row.wecom_todo_id = "native-update-id"
        row.wecom_todo_userid = "todo-user-id"
        row.save()
        self.client.force_authenticate(self.owner)
        response = self.client.patch(
            f"/api/wecom/todos/{row.public_id}/",
            {"title": "新标题", "priority": "urgent", "remindTypes": [5]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.title, "新标题")
        self.assertEqual(row.priority, WorkTodo.Priority.URGENT)
        client_class.return_value.update_todo.assert_called_once()

    def test_cli_todo_list_reads_cursor_pages_and_detail_batches(self):
        client = WeComCliClient(self.cli_config)
        responses = [
            {"todo_id_list": [{"todo_id": f"todo-{index}"} for index in range(20)], "next_cursor": "page-2"},
            {"todo_id_list": [{"todo_id": "todo-20"}], "next_cursor": ""},
            {"data_list": [{"todo_id": f"todo-{index}"} for index in range(20)]},
            {"data_list": [{"todo_id": "todo-20"}]},
        ]
        with patch.object(client, "call", side_effect=responses) as call:
            rows = client.list_todos(follower_id="member")
        self.assertEqual(len(rows), 21)
        self.assertEqual(call.call_args_list[1].args[1]["cursor"], "page-2")
