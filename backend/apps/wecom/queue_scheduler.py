"""In-process WeCom queue scheduler (starts with Django by default)."""
from __future__ import annotations

import logging
import os
import sys
import threading
import time

from django.conf import settings
from django.db import close_old_connections

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_started = False
_stop = threading.Event()


def _is_skip_command() -> bool:
    skip = {
        "migrate",
        "makemigrations",
        "test",
        "shell",
        "dbshell",
        "collectstatic",
        "flush",
        "createsuperuser",
        "showmigrations",
        "check",
        "dumpdata",
        "loaddata",
    }
    return any(arg in skip for arg in sys.argv)


def _is_autoreload_parent() -> bool:
    if "runserver" not in sys.argv or "--noreload" in sys.argv:
        return False
    return os.environ.get("RUN_MAIN") != "true"


def should_autostart() -> bool:
    if not bool(getattr(settings, "WECOM_QUEUE_AUTOSTART", True)):
        return False
    if _is_skip_command():
        return False
    if _is_autoreload_parent():
        return False
    return True


def _interval_seconds() -> int:
    try:
        value = int(getattr(settings, "WECOM_QUEUE_INTERVAL_SECONDS", 30) or 30)
    except (TypeError, ValueError):
        value = 30
    return min(max(value, 10), 600)


def _batch_limit() -> int:
    try:
        value = int(getattr(settings, "WECOM_QUEUE_BATCH_LIMIT", 100) or 100)
    except (TypeError, ValueError):
        value = 100
    return min(max(value, 1), 500)


def _run_once() -> dict:
    from apps.wecom.queue_worker import process_wecom_queue_once

    close_old_connections()
    try:
        return process_wecom_queue_once(limit=_batch_limit())
    finally:
        close_old_connections()


def _loop():
    interval = _interval_seconds()
    warmup = min(15, interval)
    logger.info("WeCom queue scheduler started (warmup %ss, interval %ss)", warmup, interval)
    if _stop.wait(warmup):
        return
    while not _stop.is_set():
        try:
            result = _run_once()
            logger.info(
                "WeCom queue tick: notifications=%s events=%s bindings=%s todo_syncs=%s todo_refreshes=%s",
                result.get("notifications"),
                result.get("events"),
                result.get("bindings"),
                result.get("todo_syncs"),
                result.get("todo_refreshes"),
            )
        except Exception:
            logger.exception("WeCom queue scheduler tick failed")
        if _stop.wait(interval):
            break


def start_wecom_queue_scheduler(*, force: bool = False) -> bool:
    global _started
    with _lock:
        if _started:
            return False
        if not force and not should_autostart():
            return False
        _stop.clear()
        thread = threading.Thread(
            target=_loop,
            name="wecom-queue-scheduler",
            daemon=True,
        )
        thread.start()
        _started = True
        return True


def stop_wecom_queue_scheduler() -> None:
    global _started
    _stop.set()
    with _lock:
        _started = False
