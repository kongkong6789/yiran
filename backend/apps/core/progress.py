from __future__ import annotations


def emit_progress(progress_callback, code: str, status: str, **data) -> None:
    """Emit a structured internal event; display text is resolved by the caller's reporter."""
    if progress_callback is not None:
        progress_callback(code, status, data)
