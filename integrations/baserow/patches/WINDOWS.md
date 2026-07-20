# Windows native patch notes for Baserow 2.3.2

## Issues found

1. Official `uv.lock` only supports `linux` / `darwin`, not Windows.
2. `netifaces==0.11.0` needs MSVC build tools on Windows and is unused by Baserow Python imports in this tag.
3. Celery should use `--pool=solo` on Windows.
4. Redis/Memurai must be provided separately (port 6379).

## Applied by setup-baserow.ps1

- Install with `uv pip install -e .` (not `uv sync` lockfile).
- Temporarily comment out `netifaces` in `backend/pyproject.toml` if build fails.
- Prefer project portable Redis under `services/baserow/tools/` when present.
