from rest_framework import exceptions
from rest_framework.authentication import TokenAuthentication

ACCOUNT_DISABLED_MESSAGE = "账号已停用，请联系管理员"


class LiangceTokenAuthentication(TokenAuthentication):
    def authenticate_credentials(self, key):
        model = self.get_model()
        try:
            token = model.objects.select_related("user").get(key=key)
        except model.DoesNotExist as exc:
            raise exceptions.AuthenticationFailed("无效的认证凭据。") from exc

        if not token.user.is_active:
            raise exceptions.AuthenticationFailed(ACCOUNT_DISABLED_MESSAGE)

        return (token.user, token)
