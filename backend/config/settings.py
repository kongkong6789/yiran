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
YIRAN_PILOT_READ_ONLY = os.getenv("YIRAN_PILOT_READ_ONLY", "true").lower() == "true"
YIRAN_ALLOW_FIXTURE_DATA = os.getenv("YIRAN_ALLOW_FIXTURE_DATA", "false").lower() == "true"
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
    "drf_spectacular",
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
    "apps.knowledge",
    "apps.commerce",
    "apps.wecom",
    "apps.smarttable",
    "apps.agentctx",
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

# Channels / WebSocket（开发默认内存层；生产可换 Redis）
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
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
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.core.authentication.LiangceTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

SPECTACULAR_SETTINGS = {
    "TITLE": "良策智能协作工作台 API",
    "DESCRIPTION": "良策工作台后端接口文档。需要登录的接口使用 Token 认证。",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
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

# 知识库可单独指定库（KNOWLEDGE_POSTGRES_*）；未设时回退 POSTGRES_*
KNOWLEDGE_PG_HOST = _pg_env("KNOWLEDGE_POSTGRES_HOST", "KNOWLEDGE_PG_HOST", default=PG_HOST)
KNOWLEDGE_PG_PORT = int(_pg_env("KNOWLEDGE_POSTGRES_PORT", "KNOWLEDGE_PG_PORT", default=str(PG_PORT)))
KNOWLEDGE_PG_DB = _pg_env("KNOWLEDGE_POSTGRES_DB", "KNOWLEDGE_PG_DB", default=PG_DB)
KNOWLEDGE_PG_USER = _pg_env("KNOWLEDGE_POSTGRES_USER", "KNOWLEDGE_PG_USER", default=PG_USER)
KNOWLEDGE_PG_PASSWORD = _pg_env("KNOWLEDGE_POSTGRES_PASSWORD", "KNOWLEDGE_PG_PASSWORD", default=PG_PASSWORD)

# 主库选择（只在这里赋值一次，避免多处 DATABASES 互相覆盖）：
# - DATABASE_ENGINE=sqlite → 业务/账号走本地 SQLite（推荐本地开发）
# - DATABASE_ENGINE=postgres → 业务也走 PostgreSQL
# - 未设且配置了 POSTGRES_* → 兼容旧行为，业务走 PostgreSQL
# 知识库始终优先走独立 knowledge 别名（可连另一台 PG）
DATABASE_ENGINE = os.getenv("DATABASE_ENGINE", "").strip().lower()
USE_POSTGRESQL = DATABASE_ENGINE in {"postgres", "postgresql"} or (
    DATABASE_ENGINE == "" and bool(PG_HOST and PG_DB)
)


def _postgres_db_config(*, name: str, user: str, password: str, host: str, port: int) -> dict:
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": name,
        "USER": user,
        "PASSWORD": password,
        "HOST": host,
        "PORT": port,
        "CONN_MAX_AGE": int(os.getenv("POSTGRES_CONN_MAX_AGE", "0")),
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {
            "connect_timeout": int(os.getenv("POSTGRES_CONNECT_TIMEOUT", "5")),
        },
    }


if USE_POSTGRESQL:
    DATABASES = {
        "default": _postgres_db_config(
            name=PG_DB,
            user=PG_USER,
            password=PG_PASSWORD,
            host=PG_HOST,
            port=PG_PORT,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# apps.knowledge 经 KnowledgeDatabaseRouter 固定走 knowledge 别名
USE_KNOWLEDGE_POSTGRES = bool(KNOWLEDGE_PG_HOST and KNOWLEDGE_PG_DB)
if USE_KNOWLEDGE_POSTGRES:
    DATABASES["knowledge"] = _postgres_db_config(
        name=KNOWLEDGE_PG_DB,
        user=KNOWLEDGE_PG_USER,
        password=KNOWLEDGE_PG_PASSWORD,
        host=KNOWLEDGE_PG_HOST,
        port=KNOWLEDGE_PG_PORT,
    )
else:
    DATABASES["knowledge"] = DATABASES["default"]
DATABASE_ROUTERS = ["config.db_routers.KnowledgeDatabaseRouter"]

# LightRAG / AGE 图谱
# AGE 可与业务库分主机：AGE_POSTGRES_HOST / AGE_POSTGRES_PORT / AGE_POSTGRES_DB ...
# 未配置时回退 POSTGRES_*
LIGHTRAG_SOURCE_ID = os.getenv("LIGHTRAG_SOURCE_ID", "")
LIGHTRAG_WORKSPACE = os.getenv("LIGHTRAG_WORKSPACE", "")
LIGHTRAG_QUERY_MODE = os.getenv("LIGHTRAG_QUERY_MODE", "mix").strip().lower()
GRAPH_RAG_BASE_URL = os.getenv("GRAPH_RAG_BASE_URL", "http://127.0.0.1:8102").strip().rstrip("/")
GRAPH_RAG_INTERNAL_TOKEN = os.getenv("GRAPH_RAG_INTERNAL_TOKEN", os.getenv("RAG_INTERNAL_TOKEN", "")).strip()
GRAPH_RAG_QUERY_TIMEOUT_SECONDS = float(os.getenv("GRAPH_RAG_QUERY_TIMEOUT_SECONDS", "45"))
AGE_PG_HOST = _pg_env("AGE_POSTGRES_HOST", "AGE_PG_HOST", default=PG_HOST)
AGE_PG_PORT = int(_pg_env("AGE_POSTGRES_PORT", "AGE_PG_PORT", default=str(PG_PORT)))
AGE_PG_DB = _pg_env("AGE_POSTGRES_DB", "AGE_PG_DB", default=PG_DB)

# LLM 配置(意图识别/生成),无 key 时降级为规则引擎
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
# 圆桌发言/上下文压缩用的"快模型";最终方案仍用 LLM_MODEL(更强)。
LLM_MODEL_FAST = os.getenv("LLM_MODEL_FAST", LLM_MODEL)
# 主模型 channel 不可用时按序重试（逗号分隔）
LLM_MODEL_FALLBACKS = [
    m.strip()
    for m in (os.getenv("LLM_MODEL_FALLBACKS", "") or "").split(",")
    if m.strip()
]
# Traditional RAG embedding. Default format matches the local /v1/embeddings service:
# {"inputs": [{"text": "..."}], "normalize": true, "pooling": "mean"}
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "")
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "local-embedding")
EMBEDDING_API_FORMAT = os.getenv("EMBEDDING_API_FORMAT", "local-inputs")
EMBEDDING_NORMALIZE = os.getenv("EMBEDDING_NORMALIZE", "true").lower() == "true"
EMBEDDING_POOLING = os.getenv("EMBEDDING_POOLING", "mean")
EMBEDDING_TIMEOUT_SECONDS = float(os.getenv("EMBEDDING_TIMEOUT_SECONDS", "30"))
EMBEDDING_RETRY_ATTEMPTS = int(os.getenv("EMBEDDING_RETRY_ATTEMPTS", "5"))
EMBEDDING_OPTIONAL_TIMEOUT_SECONDS = float(os.getenv("EMBEDDING_OPTIONAL_TIMEOUT_SECONDS", "90"))
EMBEDDING_OPTIONAL_RETRY_ATTEMPTS = int(os.getenv("EMBEDDING_OPTIONAL_RETRY_ATTEMPTS", "1"))
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "64"))
EMBEDDING_MAX_TEXT_CHARS = int(os.getenv("EMBEDDING_MAX_TEXT_CHARS", "8192"))
EMBEDDING_MAX_BATCH_CHARS = int(os.getenv("EMBEDDING_MAX_BATCH_CHARS", "60000"))
EMBEDDING_REQUEST_CONCURRENCY = int(os.getenv("EMBEDDING_REQUEST_CONCURRENCY", "4"))
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "0"))
EMBEDDING_DOCUMENT_INSTRUCTION = os.getenv("EMBEDDING_DOCUMENT_INSTRUCTION", "")
EMBEDDING_QUERY_INSTRUCTION = os.getenv(
    "EMBEDDING_QUERY_INSTRUCTION",
    "Represent this query for retrieving relevant enterprise knowledge passages: ",
)
KNOWLEDGE_TABLE_ROW_CHUNKING = os.getenv("KNOWLEDGE_TABLE_ROW_CHUNKING", "false").lower() == "true"

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
JACKYUN_METHOD_INVENTORY = os.getenv(
    "JACKYUN_METHOD_INVENTORY", "erp.stockquantity.get"
)
JACKYUN_API_TIMEOUT = int(os.getenv("JACKYUN_API_TIMEOUT", "30"))
JACKYUN_MAX_RETRIES = int(os.getenv("JACKYUN_MAX_RETRIES", "2"))

# 金蝶云星空 K3Cloud（只读）
KINGDEE_BASE_URL = os.getenv("KINGDEE_BASE_URL", "")
KINGDEE_ACCT_ID = os.getenv("KINGDEE_ACCT_ID", "")
KINGDEE_USERNAME = os.getenv("KINGDEE_USERNAME", "")
KINGDEE_PASSWORD = os.getenv("KINGDEE_PASSWORD", "")
KINGDEE_LCID = os.getenv("KINGDEE_LCID", "2052")
KINGDEE_API_TIMEOUT = int(os.getenv("KINGDEE_API_TIMEOUT", "30"))

# MCP 业务系统接入(HTTP/SSE 填 URL;stdio 填 COMMAND + ARGS)
MCP_WECOM_URL = os.getenv("MCP_WECOM_URL", "")
MCP_KINGDEE_URL = os.getenv("MCP_KINGDEE_URL", "")
MCP_JACKYUN_URL = os.getenv("MCP_JACKYUN_URL", "")
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
TENCENT_COS_AVATAR_LOCATION = os.getenv("TENCENT_COS_AVATAR_LOCATION", "media/avatars")
TENCENT_COS_AVATAR_ACL = os.getenv("TENCENT_COS_AVATAR_ACL", "private")
TENCENT_COS_ACL = os.getenv("TENCENT_COS_ACL", "public-read")
# Skill 专用:可单独建桶;未配置则复用主桶但使用独立路径前缀 skills/
TENCENT_COS_SKILLS_BUCKET = os.getenv("TENCENT_COS_SKILLS_BUCKET", "")
TENCENT_COS_SKILLS_LOCATION = os.getenv("TENCENT_COS_SKILLS_LOCATION", "skills")

MINERU_API_TOKEN = os.getenv("MINERU_API_TOKEN", "")
MINERU_API_BASE_URL = os.getenv("MINERU_API_BASE_URL", "https://mineru.net").rstrip("/")
MINERU_MODEL_VERSION = os.getenv("MINERU_MODEL_VERSION", "vlm")
MINERU_LANGUAGE = os.getenv("MINERU_LANGUAGE", "ch")
MINERU_REQUEST_TIMEOUT_SECONDS = float(os.getenv("MINERU_REQUEST_TIMEOUT_SECONDS", "60"))
MINERU_DOWNLOAD_TIMEOUT_SECONDS = float(os.getenv("MINERU_DOWNLOAD_TIMEOUT_SECONDS", "180"))
MINERU_POLL_INTERVAL_SECONDS = float(os.getenv("MINERU_POLL_INTERVAL_SECONDS", "5"))
MINERU_POLL_TIMEOUT_SECONDS = float(os.getenv("MINERU_POLL_TIMEOUT_SECONDS", "1200"))

CHAT_ATTACHMENTS_ROOT = BASE_DIR / "chat_attachments"
SKILLS_WORKSPACE_ROOT = BASE_DIR / "skill_workspaces"
SKILL_SCRIPT_TIMEOUT = int(os.getenv("SKILL_SCRIPT_TIMEOUT", "180"))
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 支持较大图片 multipart 直进内存
