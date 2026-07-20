from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import AuditLog, OrganizationMembership, UserSettings
from .organizations import assign_user_to_organization, create_personal_organization


User = get_user_model()


class OrganizationOwnershipApiTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("org-owner", password="password123")
        self.admin = User.objects.create_user("org-admin", password="password123")
        self.member = User.objects.create_user("org-member", password="password123")
        owner_membership = create_personal_organization(self.owner, name="测试企业")
        self.organization = owner_membership.organization
        assign_user_to_organization(
            self.admin,
            self.organization,
            role=OrganizationMembership.Role.ADMIN,
        )
        assign_user_to_organization(
            self.member,
            self.organization,
            role=OrganizationMembership.Role.MEMBER,
        )

    def test_owner_can_transfer_ownership_atomically(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/auth/organization/transfer-ownership/",
            {"targetUserId": self.member.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            OrganizationMembership.objects.get(
                organization=self.organization,
                user=self.owner,
            ).role,
            OrganizationMembership.Role.ADMIN,
        )
        self.assertEqual(
            OrganizationMembership.objects.get(
                organization=self.organization,
                user=self.member,
            ).role,
            OrganizationMembership.Role.OWNER,
        )
        self.assertEqual(
            OrganizationMembership.objects.filter(
                organization=self.organization,
                role=OrganizationMembership.Role.OWNER,
                is_active=True,
            ).count(),
            1,
        )
        self.assertTrue(
            AuditLog.objects.filter(
                action="organization.transfer_ownership",
                actor=self.owner.username,
            ).exists(),
        )

    def test_admin_cannot_transfer_or_assign_owner_role(self):
        self.client.force_authenticate(self.admin)
        create = self.client.post(
            "/api/auth/admin/organizations/",
            {"name": "越权创建企业"},
            format="json",
        )
        self.assertEqual(create.status_code, 403)
        transfer = self.client.post(
            "/api/auth/organization/transfer-ownership/",
            {"targetUserId": self.member.id},
            format="json",
        )
        self.assertEqual(transfer.status_code, 403)
        direct = self.client.patch(
            f"/api/auth/admin/users/{self.member.id}/",
            {"organization_role": "owner"},
            format="json",
        )
        self.assertEqual(direct.status_code, 400)
        self.assertEqual(
            OrganizationMembership.objects.get(
                organization=self.organization,
                user=self.member,
            ).role,
            OrganizationMembership.Role.MEMBER,
        )

    def test_admin_cannot_modify_user_from_another_organization(self):
        outsider = User.objects.create_user("other-company-user", password="password123")
        create_personal_organization(outsider, name="其他企业")
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/auth/admin/users/{outsider.id}/",
            {"display_name": "越权修改"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_organization_admin_can_remove_member_without_disabling_account(self):
        self.client.force_authenticate(self.admin)
        response = self.client.delete(
            f"/api/auth/organization/members/{self.member.id}/",
        )
        self.assertEqual(response.status_code, 200)
        membership = OrganizationMembership.objects.get(
            organization=self.organization,
            user=self.member,
        )
        self.assertFalse(membership.is_active)
        self.assertFalse(membership.is_primary)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_active)
        self.assertTrue(
            AuditLog.objects.filter(
                action="organization.remove_member",
                actor=self.admin.username,
                payload__user_id=self.member.id,
            ).exists(),
        )

    def test_remove_member_rejects_owner_self_and_regular_member(self):
        self.client.force_authenticate(self.admin)
        owner_response = self.client.delete(
            f"/api/auth/organization/members/{self.owner.id}/",
        )
        self.assertEqual(owner_response.status_code, 400)
        self.assertIn("所有者", owner_response.data["error"])

        self.client.force_authenticate(self.owner)
        self_response = self.client.delete(
            f"/api/auth/organization/members/{self.owner.id}/",
        )
        self.assertEqual(self_response.status_code, 400)
        self.assertIn("自己", self_response.data["error"])

        self.client.force_authenticate(self.member)
        forbidden_response = self.client.delete(
            f"/api/auth/organization/members/{self.admin.id}/",
        )
        self.assertEqual(forbidden_response.status_code, 403)

    def test_owner_cannot_be_disabled_before_transfer(self):
        superuser = User.objects.create_superuser("root-owner-test", password="password123")
        self.client.force_authenticate(superuser)
        response = self.client.patch(
            f"/api/auth/admin/users/{self.owner.id}/",
            {"is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.is_active)

    def test_organization_admin_can_delete_member_account(self):
        original_username = self.member.username
        self.client.force_authenticate(self.admin)
        response = self.client.delete(
            f"/api/auth/admin/users/{self.member.id}/",
        )
        self.assertEqual(response.status_code, 200)
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_active)
        self.assertFalse(self.member.has_usable_password())
        self.assertNotEqual(self.member.username, original_username)
        membership = OrganizationMembership.objects.get(
            organization=self.organization,
            user=self.member,
        )
        self.assertFalse(membership.is_active)
        self.assertFalse(membership.is_primary)
        settings = UserSettings.objects.get(user=self.member)
        self.assertIsNotNone(settings.deleted_at)
        self.assertEqual(settings.display_name, "已删除用户")
        self.assertTrue(
            AuditLog.objects.filter(
                action="account.delete",
                actor=self.admin.username,
                payload__username=original_username,
            ).exists(),
        )

    def test_account_delete_rejects_self_owner_and_superuser(self):
        self.client.force_authenticate(self.admin)
        self_response = self.client.delete(
            f"/api/auth/admin/users/{self.admin.id}/",
        )
        self.assertEqual(self_response.status_code, 400)

        owner_response = self.client.delete(
            f"/api/auth/admin/users/{self.owner.id}/",
        )
        self.assertEqual(owner_response.status_code, 400)
        self.assertIn("所有权", owner_response.data["error"])

        superuser = User.objects.create_superuser("root-delete-block", password="password123")
        self.client.force_authenticate(superuser)
        superuser_response = self.client.delete(
            f"/api/auth/admin/users/{superuser.id}/",
        )
        self.assertEqual(superuser_response.status_code, 400)

    def test_superuser_created_organization_has_owner_membership(self):
        superuser = User.objects.create_superuser("root-create-org", password="password123")
        target = User.objects.create_user("new-company-owner", password="password123")
        self.client.force_authenticate(superuser)
        response = self.client.post(
            "/api/auth/admin/organizations/",
            {"name": "新企业", "ownerUserId": target.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        organization_id = response.data["organization"]["id"]
        self.assertTrue(
            OrganizationMembership.objects.filter(
                organization_id=organization_id,
                user=target,
                role=OrganizationMembership.Role.OWNER,
                is_active=True,
                is_primary=True,
            ).exists(),
        )
        self.assertTrue(
            AuditLog.objects.filter(
                action="organization.create",
                payload__organization_id=organization_id,
            ).exists(),
        )

    def test_superuser_can_bulk_assign_existing_users(self):
        superuser = User.objects.create_superuser("root-assign-users", password="password123")
        target_owner = User.objects.create_user("target-owner", password="password123")
        target_membership = create_personal_organization(target_owner, name="目标企业")
        movable_one = User.objects.create_user("movable-one", password="password123")
        movable_two = User.objects.create_user("movable-two", password="password123")
        create_personal_organization(movable_one, name="旧企业一")
        create_personal_organization(movable_two, name="旧企业二")
        OrganizationMembership.objects.filter(
            user__in=[movable_one, movable_two],
            role=OrganizationMembership.Role.OWNER,
        ).update(role=OrganizationMembership.Role.ADMIN)

        self.client.force_authenticate(superuser)
        response = self.client.post(
            "/api/auth/admin/organizations/assign-users/",
            {
                "organizationId": target_membership.organization_id,
                "userIds": [movable_one.id, movable_two.id],
                "role": "member",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assignedCount"], 2)
        for user in [movable_one, movable_two]:
            membership = OrganizationMembership.objects.get(
                organization=target_membership.organization,
                user=user,
            )
            self.assertTrue(membership.is_active)
            self.assertTrue(membership.is_primary)
            self.assertEqual(membership.role, OrganizationMembership.Role.MEMBER)
            self.assertFalse(
                OrganizationMembership.objects.filter(
                    user=user,
                    is_active=True,
                ).exclude(organization=target_membership.organization).exists(),
            )

    def test_bulk_assignment_rejects_active_owner(self):
        superuser = User.objects.create_superuser("root-owner-block", password="password123")
        target_owner = User.objects.create_user("bulk-target-owner", password="password123")
        target = create_personal_organization(target_owner, name="批量目标企业").organization
        self.client.force_authenticate(superuser)
        response = self.client.post(
            "/api/auth/admin/organizations/assign-users/",
            {
                "organizationId": target.id,
                "userIds": [self.owner.id],
                "role": "member",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("所有者", response.data["error"])
