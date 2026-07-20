"""Windows-native Baserow settings without dev/e2e fixture users."""

import os

from baserow.config.settings.base import *  # noqa: F403,F401


SECRET_KEY = os.getenv("SECRET_KEY", "change-me-baserow-secret")
SIMPLE_JWT["SIGNING_KEY"] = (  # noqa: F405
    os.getenv("BASEROW_JWT_SIGNING_KEY") or SECRET_KEY
)

# Daphne makes Django's runserver serve ASGI/WebSocket routes.
if "daphne" not in INSTALLED_APPS:  # noqa: F405
    INSTALLED_APPS.insert(0, "daphne")  # noqa: F405

DEBUG = os.getenv("BASEROW_BACKEND_DEBUG", "off") == "on"

# The integration plugin is installed separately and discovered via
# BASEROW_PLUGIN_DIR. No test users or example workspaces are created here.
