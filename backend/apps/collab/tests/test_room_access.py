from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.collab.models import CollabParticipant, CollabRoom


User = get_user_model()


class CollabRoomAccessTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="room-owner", password="test-pass-123")
        self.staff = User.objects.create_user(
            username="staff-observer",
            password="test-pass-123",
            is_staff=True,
        )
        self.room = CollabRoom.objects.create(
            title="成员私有会话",
            room_kind="group",
            created_by=self.owner,
        )
        CollabParticipant.objects.create(room=self.room, user=self.owner)
        self.client = APIClient()

    def test_staff_user_cannot_observe_room_without_membership(self):
        self.client.force_authenticate(self.staff)

        listing = self.client.get("/api/collab/rooms/")
        self.assertEqual(listing.status_code, 200)
        visible_ids = {str(item["id"]) for item in listing.data.get("results", [])}
        self.assertNotIn(str(self.room.id), visible_ids)

        detail = self.client.get(f"/api/collab/rooms/{self.room.id}/")
        self.assertEqual(detail.status_code, 403)
