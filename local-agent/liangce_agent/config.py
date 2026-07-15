"""本地 Agent 配置：数据目录、微信开放平台、LLM。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv


def _default_data_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    else:
        base = Path.home() / ".local" / "share"
    return base / "liangce-agent"


def _bundle_root() -> Path:
  if getattr(sys, "frozen", False):
      return Path(sys._MEIPASS)  # type: ignore[attr-defined]
  return Path(__file__).resolve().parent


BUNDLE_ROOT = _bundle_root()
DATA_DIR = Path(os.getenv("LIANGCE_DATA_DIR", "")).expanduser() if os.getenv("LIANGCE_DATA_DIR") else _default_data_dir()
ENV_FILE = DATA_DIR / "config.env"

DATA_DIR.mkdir(parents=True, exist_ok=True)
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
load_dotenv()

HOST = os.getenv("LIANGCE_HOST", "127.0.0.1")
PORT = int(os.getenv("LIANGCE_PORT", "5050"))
SECRET_KEY = os.getenv("LIANGCE_SECRET_KEY", "change-me-local-agent")
DEBUG = os.getenv("LIANGCE_DEBUG", "true").lower() in {"1", "true", "yes"}

# 微信开放平台 · 网站应用扫码登录
WECHAT_APP_ID = os.getenv("WECHAT_APP_ID", "")
WECHAT_APP_SECRET = os.getenv("WECHAT_APP_SECRET", "")
WECHAT_REDIRECT_URI = os.getenv(
    "WECHAT_REDIRECT_URI",
    f"http://{HOST}:{PORT}/auth/wechat/callback",
)

# LLM（OpenAI 兼容）
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")

# 未配置微信时允许本地开发登录
ALLOW_DEV_LOGIN = os.getenv("ALLOW_DEV_LOGIN", "true").lower() in {"1", "true", "yes"}

STATIC_DIR = BUNDLE_ROOT / "static"
TEMPLATES_DIR = BUNDLE_ROOT / "templates"
