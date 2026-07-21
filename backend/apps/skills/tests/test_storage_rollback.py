import io
import tempfile
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom, XiaoceRun
from apps.collab.xiaoce_runs import complete_xiaoce_run_with_skill
from apps.core.conversation_skill import PreparedConversationSkill
from apps.skills.cos_storage import delete_skill_package, upload_skill_package
from apps.skills.models import SkillAsset, UserSkill
from apps.skills.repository import _write_local_package


class FakeCosClient:
    def __init__(self, *, fail_put_number=None, fail_delete_key=None):
        self.objects = {}
        self.put_count = 0
        self.delete_attempts = []
        self.fail_put_number = fail_put_number
        self.fail_delete_key = fail_delete_key

    def put_object(self, *, Bucket, Key, Body, **_kwargs):
        self.put_count += 1
        if self.put_count == self.fail_put_number:
            raise RuntimeError("injected COS put failure")
        self.objects[(Bucket, Key)] = Body

    def delete_object(self, *, Bucket, Key):
        self.delete_attempts.append((Bucket, Key))
        if Key == self.fail_delete_key:
            raise RuntimeError("injected COS delete failure")
        self.objects.pop((Bucket, Key), None)


@override_settings(
    USE_TENCENT_COS=True,
    TENCENT_COS_SECRET_ID="test-id",
    TENCENT_COS_SECRET_KEY="test-key",
    TENCENT_COS_SKILLS_BUCKET="skills-test",
    TENCENT_COS_REGION="ap-test",
)
class SkillStorageRollbackTests(TestCase):
    def test_second_cos_put_failure_removes_every_successful_key(self):
        client = FakeCosClient(fail_put_number=2)

        with (
            patch("apps.skills.cos_storage._client", return_value=client),
            patch("apps.skills.cos_storage.ensure_bucket"),
        ):
            with self.assertRaisesRegex(RuntimeError, "injected COS put failure"):
                upload_skill_package(
                    7,
                    "stage-run",
                    [("SKILL.md", b"one"), ("references/a.md", b"two")],
                )

        self.assertEqual(client.objects, {})
        self.assertEqual(
            client.delete_attempts,
            [("skills-test", "skills/7/stage-run/SKILL.md")],
        )

    def test_package_cleanup_attempts_every_key_when_one_delete_fails(self):
        client = FakeCosClient(fail_delete_key="skills/7/stage-run/a.md")
        keys = [
            "skills/7/stage-run/a.md",
            "skills/7/stage-run/b.md",
            "skills/7/stage-run/c.md",
        ]
        client.objects = {("skills-test", key): b"value" for key in keys}

        with patch("apps.skills.cos_storage._client", return_value=client):
            with self.assertRaisesRegex(RuntimeError, "injected COS delete failure"):
                delete_skill_package(
                    "skills-test",
                    [{"cos_key": key} for key in keys],
                )

        self.assertEqual(client.delete_attempts, [("skills-test", key) for key in keys])
        self.assertEqual(
            client.objects,
            {("skills-test", "skills/7/stage-run/a.md"): b"value"},
        )

    def test_mid_local_write_failure_removes_staging_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            real_write_bytes = Path.write_bytes
            writes = 0

            def fail_second_write(path, payload):
                nonlocal writes
                writes += 1
                if writes == 2:
                    raise OSError("injected local write failure")
                return real_write_bytes(path, payload)

            with (
                override_settings(SKILLS_WORKSPACE_ROOT=root),
                patch.object(Path, "write_bytes", fail_second_write),
            ):
                with self.assertRaisesRegex(OSError, "injected local write failure"):
                    _write_local_package(
                        7,
                        "stage-run",
                        [("SKILL.md", b"one"), ("references/a.md", b"two")],
                    )

            self.assertFalse((root / "7" / "stage-run").exists())

    def test_mid_local_replacement_failure_preserves_existing_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with override_settings(SKILLS_WORKSPACE_ROOT=root):
                _write_local_package(
                    7,
                    "stable-skill",
                    [("SKILL.md", b"stable"), ("references/a.md", b"stable-ref")],
                )
                real_write_bytes = Path.write_bytes
                writes = 0

                def fail_second_write(path, payload):
                    nonlocal writes
                    writes += 1
                    if writes == 2:
                        raise OSError("injected replacement write failure")
                    return real_write_bytes(path, payload)

                with patch.object(Path, "write_bytes", fail_second_write):
                    with self.assertRaisesRegex(OSError, "injected replacement write failure"):
                        _write_local_package(
                            7,
                            "stable-skill",
                            [("SKILL.md", b"new"), ("references/a.md", b"new-ref")],
                        )

            stable_root = root / "7" / "stable-skill"
            self.assertEqual((stable_root / "SKILL.md").read_bytes(), b"stable")
            self.assertEqual((stable_root / "references" / "a.md").read_bytes(), b"stable-ref")
            self.assertEqual([path.name for path in (root / "7").iterdir()], ["stable-skill"])

    def test_conversation_db_failure_after_upload_removes_storage_without_staging_row(self):
        user = User.objects.create_user("rollback-owner", password="pw")
        bot = get_xiaoce_bot_user()
        room = CollabRoom.objects.create(created_by=user, room_kind="dm")
        CollabParticipant.objects.create(room=room, user=user)
        CollabParticipant.objects.create(room=room, user=bot)
        trigger = CollabMessage.objects.create(
            room=room,
            sender=user,
            content="create a skill",
            msg_type="user",
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=room,
            user=user,
            trigger_message=trigger,
        )
        package_data = io.BytesIO()
        with zipfile.ZipFile(package_data, "w") as archive:
            archive.writestr(
                "SKILL.md",
                "---\nname: Rollback\ndescription: rollback test\n---\n\n"
                "## Goal\nTest\n## Steps\n1. Test\n",
            )
            archive.writestr("references/a.md", "reference")
        prepared = PreparedConversationSkill(
            skill_id="rollback-workflow",
            filename="rollback-workflow.zip",
            package_data=package_data.getvalue(),
            name="Rollback",
            description="rollback test",
        )
        client = FakeCosClient()

        with (
            patch("apps.skills.cos_storage._client", return_value=client),
            patch("apps.skills.cos_storage.ensure_bucket"),
            patch(
                "apps.skills.repository.SkillAsset.objects.update_or_create",
                side_effect=RuntimeError("injected DB failure"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "injected DB failure"):
                complete_xiaoce_run_with_skill(run.id, prepared)

        self.assertEqual(client.objects, {})
        self.assertGreaterEqual(len(client.delete_attempts), 2)
        self.assertFalse(SkillAsset.objects.exists())
        self.assertFalse(UserSkill.objects.exists())

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    def test_conversation_db_failure_after_local_write_removes_staging_tree(self, _cos_enabled):
        user = User.objects.create_user("local-rollback-owner", password="pw")
        bot = get_xiaoce_bot_user()
        room = CollabRoom.objects.create(created_by=user, room_kind="dm")
        CollabParticipant.objects.create(room=room, user=user)
        CollabParticipant.objects.create(room=room, user=bot)
        trigger = CollabMessage.objects.create(
            room=room,
            sender=user,
            content="create a local skill",
            msg_type="user",
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=room,
            user=user,
            trigger_message=trigger,
        )
        package_data = io.BytesIO()
        with zipfile.ZipFile(package_data, "w") as archive:
            archive.writestr(
                "SKILL.md",
                "---\nname: Local rollback\ndescription: rollback test\n---\n\n"
                "## Goal\nTest\n## Steps\n1. Test\n",
            )
            archive.writestr("references/a.md", "reference")
        prepared = PreparedConversationSkill(
            skill_id="local-rollback-workflow",
            filename="local-rollback-workflow.zip",
            package_data=package_data.getvalue(),
            name="Local rollback",
            description="rollback test",
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with (
                override_settings(SKILLS_WORKSPACE_ROOT=root),
                patch(
                    "apps.skills.repository.SkillAsset.objects.update_or_create",
                    side_effect=RuntimeError("injected local DB failure"),
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "injected local DB failure"):
                    complete_xiaoce_run_with_skill(run.id, prepared)

            user_root = root / str(user.id)
            self.assertFalse(user_root.exists() and any(user_root.iterdir()))
        self.assertFalse(SkillAsset.objects.exists())
        self.assertFalse(UserSkill.objects.exists())
