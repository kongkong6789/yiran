"""In-process SOP evolution scheduler (starts with Django by default)."""
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
    """Django runserver parent process should not start the worker."""
    if "runserver" not in sys.argv or "--noreload" in sys.argv:
        return False
    return os.environ.get("RUN_MAIN") != "true"


def should_autostart() -> bool:
    if not bool(getattr(settings, "SOP_EVOLUTION_AUTOSTART", True)):
        return False
    if _is_skip_command():
        return False
    if _is_autoreload_parent():
        return False
    return True


def _interval_seconds() -> int:
    try:
        value = int(getattr(settings, "SOP_EVOLUTION_INTERVAL_SECONDS", 3600) or 3600)
    except (TypeError, ValueError):
        value = 3600
    return min(max(value, 60), 86400)


def _run_once() -> dict:
    from .management.commands.run_sop_evolution_analyzer import analyze_due_sops

    close_old_connections()
    try:
        return analyze_due_sops(limit=int(getattr(settings, "SOP_EVOLUTION_BATCH_LIMIT", 40) or 40))
    finally:
        close_old_connections()


def _loop():
    interval = _interval_seconds()
    # Delay first pass so migrations / boot settle.
    warmup = min(30, interval)
    logger.info("SOP evolution scheduler started (warmup %ss, interval %ss)", warmup, interval)
    if _stop.wait(warmup):
        return
    while not _stop.is_set():
        try:
            result = _run_once()
            logger.info(
                "SOP evolution tick: orgs=%s scanned=%s created=%s skipped=%s",
                result.get("orgs"),
                result.get("scanned"),
                result.get("created"),
                result.get("skipped"),
            )
        except Exception:
            logger.exception("SOP evolution scheduler tick failed")
        if _stop.wait(interval):
            break


def start_evolution_scheduler(*, force: bool = False) -> bool:
    """Start background thread once. Returns True if newly started."""
    global _started
    with _lock:
        if _started:
            return False
        if not force and not should_autostart():
            return False
        _stop.clear()
        thread = threading.Thread(
            target=_loop,
            name="sop-evolution-scheduler",
            daemon=True,
        )
        thread.start()
        _started = True
        return True


def stop_evolution_scheduler() -> None:
    global _started
    _stop.set()
    with _lock:
        _started = False
