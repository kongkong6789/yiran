from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import AuditLog, OrganizationMembership, Team, TeamMembership, UserSettings
from .organizations import assign_user_to_organization, create_organization_with_owner, create_personal_organization


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

    def test_organization_admin_cannot_delete_member_shared_with_another_enterprise(self):
        other_owner = User.objects.create_user("other-delete-owner", password="password123")
        other_organization = create_personal_organization(
            other_owner,
            name="账号删除边界企业",
        ).organization
        assign_user_to_organization(
            self.member,
            other_organization,
            role=OrganizationMembership.Role.MEMBER,
            make_primary=False,
        )
        self.client.force_authenticate(self.admin)

        response = self.client.delete(
            f"/api/auth/admin/users/{self.member.id}/",
        )

        self.assertEqual(response.status_code, 403)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_active)
        self.assertTrue(
            OrganizationMembership.objects.filter(
                user=self.member,
                organization=self.organization,
                is_active=True,
            ).exists(),
        )
        self.assertTrue(
            OrganizationMembership.objects.filter(
                user=self.member,
                organization=other_organization,
                is_active=True,
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

    def test_owner_can_list_and_open_all_owned_organizations(self):
        second, _ = create_organization_with_owner(
            name="第二企业", owner=self.owner, actor=self.owner,
        )
        self.client.force_authenticate(self.owner)
        listed = self.client.get("/api/auth/admin/organizations/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual({row["id"] for row in listed.data["results"]}, {self.organization.id, second.id})

        opened = self.client.get(
            "/api/auth/organization/", {"organizationId": self.organization.id},
        )
        self.assertEqual(opened.status_code, 200)
        self.assertEqual(opened.data["organization"]["id"], self.organization.id)
        self.assertEqual(opened.data["organization"]["role"], OrganizationMembership.Role.OWNER)
        self.assertEqual(len(opened.data["members"]), 3)

    def test_switch_current_organization_is_persisted(self):
        second, _ = create_organization_with_owner(
            name="第二企业", owner=self.owner, actor=self.owner,
        )
        OrganizationMembership.objects.filter(user=self.owner).update(is_primary=False)
        OrganizationMembership.objects.filter(
            user=self.owner,
            organization=self.organization,
        ).update(is_primary=True)

        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/auth/organization/switch/",
            {"organizationId": second.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["organization"]["id"], second.id)
        self.assertTrue(
            OrganizationMembership.objects.get(user=self.owner, organization=second).is_primary,
        )
        self.assertFalse(
            OrganizationMembership.objects.get(user=self.owner, organization=self.organization).is_primary,
        )
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.data["user"]["organization"]["id"], second.id)
        self.assertTrue(
            AuditLog.objects.filter(
                action="organization.switch",
                actor=self.owner.username,
                payload__organization_id=second.id,
            ).exists(),
        )

    def test_switch_current_organization_rejects_non_member(self):
        outsider = User.objects.create_user("switch-outsider", password="password123")
        outsider_organization = create_personal_organization(
            outsider,
            name="不可访问企业",
        ).organization
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/auth/organization/switch/",
            {"organizationId": outsider_organization.id},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_platform_account_row_contains_every_active_enterprise_membership(self):
        settings, _ = UserSettings.objects.get_or_create(user=self.owner)
        settings.avatar = "owner-avatar.png"
        settings.save(update_fields=["avatar", "updated_at"])
        second, _ = create_organization_with_owner(
            name="第二企业", owner=self.owner, actor=self.owner,
        )
        superuser = User.objects.create_superuser("root-account-scope", password="password123")
        self.client.force_authenticate(superuser)
        response = self.client.get("/api/auth/admin/users/")
        self.assertEqual(response.status_code, 200)
        owner_row = next(row for row in response.data["results"] if row["id"] == self.owner.id)
        self.assertEqual(owner_row["avatar_url"], "/api/auth/avatars/owner-avatar.png/")
        self.assertEqual(
            {row["id"] for row in owner_row["organizations"]},
            {self.organization.id, second.id},
        )

        scoped = self.client.get(
            "/api/auth/admin/users/", {"organizationId": self.organization.id},
        )
        self.assertEqual(scoped.status_code, 200)
        self.assertEqual({row["id"] for row in scoped.data["results"]}, {self.owner.id, self.admin.id, self.member.id})

    def test_enterprise_team_is_visible_only_inside_its_enterprise(self):
        team = Team.objects.create(
            name="企业内部团队",
            kind=Team.Kind.ENTERPRISE,
            organization=self.organization,
            created_by=self.owner,
        )
        TeamMembership.objects.create(team=team, user=self.member)
        outsider = User.objects.create_user("team-outsider", password="password123")
        create_personal_organization(outsider, name="外部企业")

        self.client.force_authenticate(self.member)
        visible = self.client.get("/api/auth/teams/")
        self.assertEqual(visible.status_code, 200)
        self.assertEqual([row["id"] for row in visible.data["results"]], [team.id])

        self.client.force_authenticate(outsider)
        hidden = self.client.get("/api/auth/teams/")
        self.assertEqual(hidden.status_code, 200)
        self.assertEqual(hidden.data["results"], [])

    def test_enterprise_team_list_follows_current_organization_for_multi_org_user(self):
        second_owner = User.objects.create_user("second-team-owner", password="password123")
        second_membership = create_personal_organization(second_owner, name="第二团队企业")
        assign_user_to_organization(
            self.member,
            second_membership.organization,
            role=OrganizationMembership.Role.MEMBER,
            make_primary=False,
        )
        first_team = Team.objects.create(
            name="当前企业团队",
            kind=Team.Kind.ENTERPRISE,
            organization=self.organization,
            created_by=self.owner,
        )
        second_team = Team.objects.create(
            name="其他企业团队",
            kind=Team.Kind.ENTERPRISE,
            organization=second_membership.organization,
            created_by=second_owner,
        )
        # 即使用户也是另一企业团队的显式成员，未切换到该企业时仍不可见。
        TeamMembership.objects.create(team=second_team, user=self.member)

        self.client.force_authenticate(self.member)
        current = self.client.get("/api/auth/teams/")
        self.assertEqual(current.status_code, 200)
        self.assertEqual([row["id"] for row in current.data["results"]], [first_team.id])

        switched = self.client.post(
            "/api/auth/organization/switch/",
            {"organizationId": second_membership.organization_id},
            format="json",
        )
        self.assertEqual(switched.status_code, 200)
        after_switch = self.client.get("/api/auth/teams/")
        self.assertEqual([row["id"] for row in after_switch.data["results"]], [second_team.id])

    def test_platform_team_is_visible_only_to_its_members(self):
        platform_team = Team.objects.create(
            name="跨企业平台团队",
            kind=Team.Kind.PLATFORM,
            created_by=self.owner,
        )
        TeamMembership.objects.create(team=platform_team, user=self.member)
        platform_admin = User.objects.create_user(
            "platform-team-admin",
            password="password123",
            is_staff=True,
        )
        create_personal_organization(platform_admin, name="平台管理员企业")

        self.client.force_authenticate(self.member)
        member_result = self.client.get("/api/auth/teams/")
        self.assertIn(platform_team.id, [row["id"] for row in member_result.data["results"]])

        self.client.force_authenticate(self.owner)
        non_member_result = self.client.get("/api/auth/teams/", {"kind": "platform"})
        self.assertEqual(non_member_result.data["results"], [])

        self.client.force_authenticate(platform_admin)
        admin_non_member_result = self.client.get("/api/auth/teams/", {"kind": "platform"})
        self.assertEqual(admin_non_member_result.data["results"], [])

    def test_platform_team_creator_is_automatically_added_as_member(self):
        platform_admin = User.objects.create_user(
            "platform-team-creator",
            password="password123",
            is_staff=True,
        )
        create_personal_organization(platform_admin, name="平台团队创建企业")
        self.client.force_authenticate(platform_admin)
        created = self.client.post(
            "/api/auth/teams/",
            {"name": "创建人可见的平台团队", "kind": "platform", "memberIds": []},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        team_id = created.data["team"]["id"]
        self.assertTrue(
            TeamMembership.objects.filter(team_id=team_id, user=platform_admin).exists()
        )
        listed = self.client.get("/api/auth/teams/", {"kind": "platform"})
        self.assertEqual([row["id"] for row in listed.data["results"]], [team_id])

    def test_superuser_can_bulk_assign_existing_users(self):
        superuser = User.objects.create_superuser("root-assign-users", password="password123")
        target_owner = User.objects.create_user("target-owner", password="password123")
        target_membership = create_personal_organization(target_owner, name="目标企业")
        movable_one = User.objects.create_user("movable-one", password="password123")
        movable_two = User.objects.create_user("movable-two", password="password123")
        create_personal_organization(movable_one, name="旧企业一")
        create_personal_organization(movable_two, name="旧企业二")
        original_organizations = {
            movable_one.id: OrganizationMembership.objects.get(user=movable_one).organization,
            movable_two.id: OrganizationMembership.objects.get(user=movable_two).organization,
        }

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
            self.assertFalse(membership.is_primary)
            self.assertEqual(membership.role, OrganizationMembership.Role.MEMBER)
            self.assertTrue(
                OrganizationMembership.objects.filter(
                    user=user,
                    is_active=True,
                    organization=original_organizations[user.id],
                    role=OrganizationMembership.Role.OWNER,
                    is_primary=True,
                ).exists(),
            )

    def test_bulk_assignment_allows_owner_to_join_another_enterprise(self):
        superuser = User.objects.create_superuser("root-owner-multi-org", password="password123")
        target_owner = User.objects.create_user("bulk-target-owner", password="password123")
        target = create_personal_organization(target_owner, name="批量目标企业").organization
        original_membership = OrganizationMembership.objects.get(
            organization=self.organization,
            user=self.owner,
        )
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
        self.assertEqual(response.status_code, 200)
        original_membership.refresh_from_db()
        self.assertTrue(original_membership.is_active)
        self.assertTrue(original_membership.is_primary)
        self.assertEqual(original_membership.role, OrganizationMembership.Role.OWNER)
        added = OrganizationMembership.objects.get(organization=target, user=self.owner)
        self.assertTrue(added.is_active)
        self.assertFalse(added.is_primary)
        self.assertEqual(added.role, OrganizationMembership.Role.MEMBER)

    def test_bulk_assignment_is_idempotent_and_keeps_one_current_enterprise(self):
        superuser = User.objects.create_superuser("root-assign-idempotent", password="password123")
        target_owner = User.objects.create_user("idempotent-target-owner", password="password123")
        target = create_personal_organization(target_owner, name="幂等目标企业").organization
        self.client.force_authenticate(superuser)
        payload = {
            "organizationId": target.id,
            "userIds": [self.member.id],
            "role": "member",
        }
        first = self.client.post("/api/auth/admin/organizations/assign-users/", payload, format="json")
        second = self.client.post("/api/auth/admin/organizations/assign-users/", payload, format="json")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["assignedCount"], 1)
        self.assertEqual(first.data["skippedCount"], 0)
        self.assertEqual(second.data["assignedCount"], 0)
        self.assertEqual(second.data["skippedCount"], 1)
        self.assertEqual(
            OrganizationMembership.objects.filter(organization=target, user=self.member).count(),
            1,
        )
        self.assertEqual(
            OrganizationMembership.objects.filter(
                user=self.member,
                is_active=True,
                is_primary=True,
            ).count(),
            1,
        )
        self.assertTrue(
            OrganizationMembership.objects.get(
                organization=self.organization,
                user=self.member,
            ).is_primary,
        )

    def test_bulk_assignment_does_not_change_existing_member_role(self):
        superuser = User.objects.create_superuser("root-assign-role-safe", password="password123")
        self.client.force_authenticate(superuser)
        response = self.client.post(
            "/api/auth/admin/organizations/assign-users/",
            {
                "organizationId": self.organization.id,
                "userIds": [self.admin.id],
                "role": "member",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assignedCount"], 0)
        self.assertEqual(response.data["skippedCount"], 1)
        self.assertEqual(
            OrganizationMembership.objects.get(
                organization=self.organization,
                user=self.admin,
            ).role,
            OrganizationMembership.Role.ADMIN,
        )
