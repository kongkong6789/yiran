"""
Django 配置 —— Agent SaaS 后端。

分层架构(自底向上):
  apps.datalake      第1层 DuckDB 数据底座
  apps.rag           第2层 LightRAG 图谱检索
  apps.wiki          第3层 LLM Wiki 知识组织层
  apps.orchestration 第4层 LangGraph SOP 编排层
  apps.ontology      第5层 Ontology 业务对象层
  apps.harness       第6层 Harness 闸机层
  apps.connectors    第7层 业务系统执行层
  apps.core          通用:用户/权限/审计
"""
from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
WECOM_CONFIG_ENCRYPTION_KEY = os.getenv("WECOM_CONFIG_ENCRYPTION_KEY", "")
WECOM_BINDING_CONFIG_USER_ID = int(os.getenv("WECOM_BINDING_CONFIG_USER_ID", "0") or 0)
WECOM_BINDING_ASYNC_ENABLED = os.getenv("WECOM_BINDING_ASYNC_ENABLED", "true").lower() == "true"
WECOM_CALLBACK_BASE_URL = os.getenv("WECOM_CALLBACK_BASE_URL", "").strip().rstrip("/")
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = [host.strip() for host in os.getenv("DJANGO_ALLOWED_HOSTS", "*").split(",") if host.strip()]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # 第三方
    "channels",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    # 业务分层 App
    "apps.core",
    "apps.datalake",
    "apps.rag",
    "apps.wiki",
    "apps.ontology",
    "apps.loops",
    "apps.harness",
    "apps.orchestration",
    "apps.connectors",
    "apps.council",
    "apps.mcp",
    "apps.skills",
    "apps.collab",
    "apps.commerce",
    "apps.wecom",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# 圆桌/聊天 WebSocket（单进程开发用内存层；多进程部署请换 Redis）
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}

# 本地 SQLite 仅作为未配置 PostgreSQL 时的显式开发回退；下方会按环境变量切换 ORM 主库。
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# DuckDB 数据底座文件路径
DUCKDB_PATH = os.getenv("DUCKDB_PATH", str(BASE_DIR / "data" / "datalake.duckdb"))

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
]

LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

# 前后端分离跨域
if DEBUG and not os.getenv("CORS_ALLOWED_ORIGINS", "").strip():
    # 开发环境放开:允许局域网内任意来源直接访问后端
    CORS_ALLOW_ALL_ORIGINS = True
    CORS_ALLOW_CREDENTIALS = False
else:
    CORS_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",") if origin.strip()]
    CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.getenv(
    "CSRF_TRUSTED_ORIGINS",
    "",
).split(",") if origin.strip()]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = os.getenv("USE_X_FORWARDED_HOST", "true").lower() == "true"

# PostgreSQL 连接参数同时供 Django ORM 主库与数据湖模块使用。
# 支持 POSTGRES_* 与旧版 PG_* 两种环境变量名
def _pg_env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = os.getenv(key)
        if val is not None and val != "":
            return val
    return default


PG_HOST = _pg_env("POSTGRES_HOST", "PG_HOST")
PG_HOST_FALLBACK = _pg_env("POSTGRES_HOST_FALLBACK", "PG_HOST_FALLBACK")
PG_PORT = int(_pg_env("POSTGRES_PORT", "PG_PORT", default="5432"))
PG_DB = _pg_env("POSTGRES_DB", "PG_DB")
PG_USER = _pg_env("POSTGRES_USER", "PG_USER", default="postgres")
PG_PASSWORD = _pg_env("POSTGRES_PASSWORD", "PG_PASSWORD")
PG_SCHEMA = _pg_env("POSTGRES_SCHEMA", "PG_SCHEMA", default="lake")

# PostgreSQL is the Django ORM primary database whenever it is configured.
# SQLite remains available only as an explicit local fallback.
DATABASE_ENGINE = os.getenv("DATABASE_ENGINE", "").strip().lower()
USE_POSTGRESQL = DATABASE_ENGINE in {"postgres", "postgresql"} or (
    DATABASE_ENGINE == "" and bool(PG_HOST and PG_DB)
)
if USE_POSTGRESQL:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": PG_DB,
            "USER": PG_USER,
            "PASSWORD": PG_PASSWORD,
            "HOST": PG_HOST,
            "PORT": PG_PORT,
            "CONN_MAX_AGE": int(os.getenv("POSTGRES_CONN_MAX_AGE", "60")),
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {
                "connect_timeout": int(os.getenv("POSTGRES_CONNECT_TIMEOUT", "5")),
            },
        }
    }

# LightRAG / AGE 图谱
LIGHTRAG_SOURCE_ID = os.getenv("LIGHTRAG_SOURCE_ID", "")
LIGHTRAG_WORKSPACE = os.getenv("LIGHTRAG_WORKSPACE", "")

# LLM 配置(意图识别/生成),无 key 时降级为规则引擎
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
# 圆桌发言/上下文压缩用的"快模型";最终方案仍用 LLM_MODEL(更强)。
LLM_MODEL_FAST = os.getenv("LLM_MODEL_FAST", LLM_MODEL)

# 图片 API(文生图/图生图),与对话 Key 可分离
IMAGE_API_KEY = os.getenv("IMAGE_API_KEY", "")
IMAGE_BASE_URL = os.getenv("IMAGE_BASE_URL", "") or LLM_BASE_URL
IMAGE_GEN_MODEL = os.getenv("IMAGE_GEN_MODEL", "dall-e-3")
IMAGE_EDIT_MODEL = os.getenv("IMAGE_EDIT_MODEL", "dall-e-2")
IMAGE_VISION_MODEL = os.getenv("IMAGE_VISION_MODEL", "") or LLM_MODEL

# 吉客云只读同步(不配则用 fixture 灌入 DataLake)
JACKYUN_APP_KEY = os.getenv("JACKYUN_APP_KEY", "")
JACKYUN_APP_SECRET = os.getenv("JACKYUN_APP_SECRET", "")
JACKYUN_BASE_URL = os.getenv(
    "JACKYUN_BASE_URL", "https://open.jackyun.com/open/openapi/do"
)
JACKYUN_METHOD_GOODS = os.getenv("JACKYUN_METHOD_GOODS", "erp.goods.listget")
JACKYUN_METHOD_TRADE = os.getenv("JACKYUN_METHOD_TRADE", "oms.trade.listget")

# MCP 业务系统接入(HTTP/SSE 填 URL;stdio 填 COMMAND + ARGS)
MCP_WECOM_URL = os.getenv("MCP_WECOM_URL", "")
MCP_TENCENT_DOCS_URL = os.getenv("MCP_TENCENT_DOCS_URL", "")
MCP_WEDRIVE_URL = os.getenv("MCP_WEDRIVE_URL", "")
MCP_KINGDEE_URL = os.getenv("MCP_KINGDEE_URL", "")
MCP_JACKYUN_URL = os.getenv("MCP_JACKYUN_URL", "")
MCP_WORKBUDDY_URL = os.getenv("MCP_WORKBUDDY_URL", "")
MCP_NAS_COMMAND = os.getenv("MCP_NAS_COMMAND", "")
MCP_NAS_ARGS = os.getenv("MCP_NAS_ARGS", "")

# 腾讯云 COS(通用 media 与 Skill 仓库分离)
USE_TENCENT_COS = os.getenv("USE_TENCENT_COS", "false").lower() == "true"
TENCENT_COS_SECRET_ID = os.getenv("TENCENT_COS_SECRET_ID", "")
TENCENT_COS_SECRET_KEY = os.getenv("TENCENT_COS_SECRET_KEY", "")
TENCENT_COS_BUCKET = os.getenv("TENCENT_COS_BUCKET", "")
TENCENT_COS_REGION = os.getenv("TENCENT_COS_REGION", "ap-guangzhou")
TENCENT_COS_CUSTOM_DOMAIN = os.getenv("TENCENT_COS_CUSTOM_DOMAIN", "")
TENCENT_COS_SCHEME = os.getenv("TENCENT_COS_SCHEME", "https")
TENCENT_COS_LOCATION = os.getenv("TENCENT_COS_LOCATION", "media")
TENCENT_COS_ACL = os.getenv("TENCENT_COS_ACL", "public-read")
# Skill 专用:可单独建桶;未配置则复用主桶但使用独立路径前缀 skills/
TENCENT_COS_SKILLS_BUCKET = os.getenv("TENCENT_COS_SKILLS_BUCKET", "")
TENCENT_COS_SKILLS_LOCATION = os.getenv("TENCENT_COS_SKILLS_LOCATION", "skills")

CHAT_ATTACHMENTS_ROOT = BASE_DIR / "chat_attachments"
SKILLS_WORKSPACE_ROOT = BASE_DIR / "skill_workspaces"
SKILL_SCRIPT_TIMEOUT = int(os.getenv("SKILL_SCRIPT_TIMEOUT", "180"))
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 支持较大图片 multipart 直进内存
