from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Organization, OrganizationMembership
from apps.loops.models import OperationalLoop


class OpsLoopsApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="ops-loop-user", password="pass")
        self.org = Organization.objects.create(name="Ops Org", slug="ops-org", created_by=self.user)
        OrganizationMembership.objects.create(
            organization=self.org,
            user=self.user,
            role=OrganizationMembership.Role.OWNER,
            is_primary=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_publish_and_list(self):
        created = self.client.post(
            "/api/ops-loops/",
            {"name": "利润异常监控 Loop", "description": "demo", "confidence": 90},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        loop_id = created.data["id"]
        published = self.client.post(f"/api/ops-loops/{loop_id}/publish/")
        self.assertEqual(published.status_code, 200)
        self.assertEqual(published.data["status"], OperationalLoop.Status.ACTIVE)
        listed = self.client.get("/api/ops-loops/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.data["results"]), 1)

    def test_discover_returns_candidates(self):
        resp = self.client.post("/api/ops-loops/discover/", {"query": "库存 补货"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.data.get("candidates") or []), 1)
