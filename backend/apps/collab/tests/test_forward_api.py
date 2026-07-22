from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom


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
