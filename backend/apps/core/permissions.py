from rest_framework.permissions import BasePermission

from .organizations import is_organization_admin


class IsOrganizationAdmin(BasePermission):
    message = "仅企业管理员可执行此操作。"

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and is_organization_admin(request.user)
        )
