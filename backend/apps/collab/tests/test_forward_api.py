import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom
from apps.core.attachments import (
    attachment_public_meta,
    process_uploaded_files,
    resolve_attachment_path,
)


User = get_user_model()


class CollabForwardApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="forward-owner", password="test-pass-123")
        self.member = User.objects.create_user(username="forward-member", password="test-pass-123")
        self.source = CollabRoom.objects.create(title="项目群", room_kind="group", created_by=self.owner)
        self.target = CollabRoom.objects.create(title="目标群", room_kind="group", created_by=self.owner)
        for room in (self.source, self.target):
            CollabParticipant.objects.create(room=room, user=self.owner)
            CollabParticipant.objects.create(room=room, user=self.member)
        self.messages = [
            CollabMessage.objects.create(
                room=self.source,
                sender=self.owner if index % 2 == 0 else self.member,
                content=f"第 {index + 1} 条讨论",
            )
            for index in range(3)
        ]
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_messages_can_be_forwarded_as_a_merged_bundle(self):
        response = self.client.post(
            f"/api/collab/rooms/{self.target.id}/messages/forward/",
            {"message_ids": [self.messages[0].id, self.messages[1].id], "mode": "merge"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        forwarded = CollabMessage.objects.get(id=response.data["messages"][0]["id"])
        self.assertEqual(forwarded.meta["forward_mode"], "merge")
        self.assertEqual(len(forwarded.meta["forward_bundle"]), 2)
        self.assertEqual(forwarded.sender, self.owner)

    def test_messages_can_be_forwarded_separately_in_selected_order(self):
        response = self.client.post(
            f"/api/collab/rooms/{self.target.id}/messages/forward/",
            {"message_ids": [self.messages[2].id, self.messages[0].id], "mode": "separate"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            [row["content"] for row in response.data["messages"]],
            [self.messages[2].content, self.messages[0].content],
        )

    def test_forward_copies_another_members_attachment_to_the_forwarder(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(CHAT_ATTACHMENTS_ROOT=Path(tmp)):
                uploaded = process_uploaded_files(
                    [
                        SimpleUploadedFile(
                            "member-report.md",
                            b"# member report\nreal content",
                            content_type="text/markdown",
                        ),
                    ],
                    self.member.id,
                )
                source = CollabMessage.objects.create(
                    room=self.source,
                    sender=self.member,
                    content="成员报告",
                    attachments=attachment_public_meta(uploaded),
                )

                response = self.client.post(
                    f"/api/collab/rooms/{self.target.id}/messages/forward/",
                    {"message_ids": [source.id], "mode": "separate"},
                    format="json",
                )

                self.assertEqual(response.status_code, 201)
                forwarded = CollabMessage.objects.get(
                    id=response.data["messages"][0]["id"],
                )
                original_id = source.attachments[0]["id"]
                copied = forwarded.attachments[0]
                copied_path = resolve_attachment_path(self.owner.id, copied["id"])
                self.assertNotEqual(copied["id"], original_id)
                self.assertIsNotNone(copied_path)
                self.assertEqual(copied_path.read_bytes(), b"# member report\nreal content")
                self.assertIsNotNone(resolve_attachment_path(self.member.id, original_id))

                download = self.client.get(
                    f"/api/collab/attachments/{copied['id']}/?download=1",
                )
                self.assertEqual(download.status_code, 200)
                self.assertEqual(
                    b"".join(download.streaming_content),
                    b"# member report\nreal content",
                )

    def test_forward_rejects_messages_from_a_room_the_user_did_not_join(self):
        outsider = User.objects.create_user(username="forward-outsider", password="test-pass-123")
        hidden = CollabRoom.objects.create(title="隐藏群", room_kind="group", created_by=outsider)
        CollabParticipant.objects.create(room=hidden, user=outsider)
        hidden_message = CollabMessage.objects.create(room=hidden, sender=outsider, content="不可转发")

        response = self.client.post(
            f"/api/collab/rooms/{self.target.id}/messages/forward/",
            {"message_ids": [hidden_message.id], "mode": "merge"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
