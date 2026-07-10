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
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # 第三方
    "rest_framework",
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

# 用户/权限元数据用 SQLite;业务大数据用 DuckDB(见 apps.datalake)
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
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",  # 骨架阶段放开,后续接入鉴权
    ],
}

# 前后端分离跨域
if DEBUG:
    # 开发环境放开:允许局域网内任意来源直接访问后端
    CORS_ALLOW_ALL_ORIGINS = True
    CORS_ALLOW_CREDENTIALS = False
else:
    CORS_ALLOWED_ORIGINS = os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    CORS_ALLOW_CREDENTIALS = True

# 数据底座 PostgreSQL(业务数据建模);未配置或连不上时自动降级 DuckDB
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

# LightRAG / AGE 图谱
LIGHTRAG_SOURCE_ID = os.getenv("LIGHTRAG_SOURCE_ID", "")
LIGHTRAG_WORKSPACE = os.getenv("LIGHTRAG_WORKSPACE", "")

# LLM 配置(意图识别/生成),无 key 时降级为规则引擎
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
# 圆桌发言/上下文压缩用的"快模型";最终方案仍用 LLM_MODEL(更强)。
LLM_MODEL_FAST = os.getenv("LLM_MODEL_FAST", LLM_MODEL)
