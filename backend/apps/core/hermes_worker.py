"""Isolated Hermes Agent worker for Xiaoce.

This module intentionally has no Django imports. It is executed with the
dedicated Hermes virtual environment and receives one trusted JSON request on
stdin. Only the ``liangce`` toolset and Hermes' profile-local memory tool are
enabled.
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.metadata
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any


MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_READ_CHARS = 120_000
TEXT_EXTENSIONS = {
    ".html",
    ".htm",
    ".md",
    ".markdown",
    ".txt",
    ".json",
    ".csv",
}
BINARY_EXTENSIONS = {".xlsx", ".docx", ".pdf"}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | BINARY_EXTENSIONS


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def _safe_filename(value: str) -> str:
    name = Path(str(value or "").replace("\\", "/")).name
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", name).strip(" .")
    if not name:
        raise ValueError("文件名不能为空")
    if len(name) > 120:
        name = f"{Path(name).stem[:100]}{Path(name).suffix[:12]}"
    if Path(name).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError("仅支持 HTML、Markdown、TXT、JSON、CSV、XLSX、DOCX 和 PDF")
    return name


class Workspace:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.inputs = (self.root / "input").resolve()
        self.artifacts = (self.root / "artifacts").resolve()
        self.requests = (self.root / ".artifact-requests").resolve()
        for path in (self.inputs, self.artifacts, self.requests):
            path.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _within(path: Path, parent: Path) -> bool:
        try:
            path.resolve().relative_to(parent.resolve())
            return True
        except (OSError, ValueError):
            return False

    def read_path(self, relative_path: str) -> Path:
        raw = Path(str(relative_path or "").replace("\\", "/"))
        if raw.is_absolute() or any(part in {"", ".", ".."} for part in raw.parts):
            raise ValueError("只能使用 input/ 或 artifacts/ 下的相对路径")
        path = (self.root / raw).resolve()
        if path.name.startswith(".") or not (
            self._within(path, self.inputs) or self._within(path, self.artifacts)
        ):
            raise ValueError("只能读取 input/ 或 artifacts/ 内的文件")
        if not path.is_file():
            raise FileNotFoundError(f"文件不存在：{relative_path}")
        return path

    def list_files(self) -> str:
        files: list[dict[str, Any]] = []
        for root in (self.inputs, self.artifacts):
            for path in sorted(root.rglob("*")):
                if not path.is_file() or path.name.startswith("."):
                    continue
                files.append(
                    {
                        "path": str(path.relative_to(self.root)),
                        "size": path.stat().st_size,
                    }
                )
                if len(files) >= 200:
                    break
        return json.dumps({"files": files}, ensure_ascii=False)

    def read_file(self, relative_path: str) -> str:
        path = self.read_path(relative_path)
        if path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("文件超过 20MB 限制")
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            extracted = path.with_name(f"{path.name}.extracted.txt")
            if extracted.is_file() and self._within(extracted, self.inputs):
                path = extracted
            else:
                raise ValueError("该二进制文件没有可读取的解析文本")
        text = path.read_text(encoding="utf-8", errors="replace")
        truncated = len(text) > MAX_READ_CHARS
        return json.dumps(
            {
                "path": relative_path,
                "content": text[:MAX_READ_CHARS],
                "truncated": truncated,
            },
            ensure_ascii=False,
        )

    def create_artifact(self, filename: str, content: str) -> str:
        name = _safe_filename(filename)
        text = str(content or "")
        if len(text.encode("utf-8")) > MAX_FILE_BYTES:
            raise ValueError("产物内容超过 20MB 限制")
        extension = Path(name).suffix.lower()
        if extension in BINARY_EXTENSIONS:
            request = self.requests / f"{uuid.uuid4().hex}.json"
            temp = request.with_suffix(".tmp")
            temp.write_text(
                json.dumps({"filename": name, "content": text}, ensure_ascii=False),
                encoding="utf-8",
            )
            temp.replace(request)
        else:
            path = (self.artifacts / name).resolve()
            if not self._within(path, self.artifacts):
                raise ValueError("产物路径无效")
            temp = path.with_suffix(f"{path.suffix}.tmp")
            temp.write_text(text, encoding="utf-8")
            temp.replace(path)
        return json.dumps(
            {"success": True, "path": f"artifacts/{name}", "real_file": True},
            ensure_ascii=False,
        )


def _ensure_hermes_profile(workspace: Workspace) -> Path:
    hermes_home = (workspace.root / ".hermes").resolve()
    hermes_home.mkdir(parents=True, exist_ok=True)
    os.environ["HERMES_HOME"] = str(hermes_home)
    os.environ["TERMINAL_CWD"] = str(workspace.root)
    config = hermes_home / "config.yaml"
    if not config.exists():
        config.write_text(
            "memory:\n"
            "  memory_enabled: true\n"
            "  user_profile_enabled: true\n"
            "  memory_char_limit: 6000\n"
            "  user_char_limit: 3000\n"
            "  nudge_interval: 6\n"
            "  write_approval: false\n"
            "skills:\n"
            "  creation_nudge_interval: 1000\n"
            "sessions:\n"
            "  write_json_snapshots: false\n",
            encoding="utf-8",
        )
    return hermes_home


def _open_stream_file(workspace: Workspace, payload: dict):
    value = str(payload.get("stream_path") or "").strip()
    if not value:
        return None
    stream_root = (workspace.root / ".hermes" / "streams").resolve()
    stream_path = Path(value).resolve()
    if stream_path.parent != stream_root:
        raise ValueError("流式输出路径无效")
    stream_root.mkdir(parents=True, exist_ok=True)
    return stream_path.open("a", encoding="utf-8", buffering=1)


def _register_liangce_tools(workspace: Workspace) -> None:
    from tools.registry import registry

    registry.register(
        name="liangce_list_files",
        toolset="liangce",
        schema={
            "description": "List readable user inputs and existing AI artifacts.",
            "parameters": {"type": "object", "properties": {}},
        },
        handler=lambda _args, **_kwargs: workspace.list_files(),
        description="List files in the isolated Xiaoce workspace.",
        emoji="📂",
    )
    registry.register(
        name="liangce_read_file",
        toolset="liangce",
        schema={
            "description": (
                "Read one text file from input/ or artifacts/. For uploaded office "
                "files, use the listed .extracted.txt companion when present."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path beginning with input/ or artifacts/.",
                    }
                },
                "required": ["path"],
            },
        },
        handler=lambda args, **_kwargs: workspace.read_file(str(args.get("path") or "")),
        description="Read a file inside the isolated Xiaoce workspace.",
        emoji="📖",
        max_result_size_chars=MAX_READ_CHARS + 1_000,
    )
    registry.register(
        name="liangce_create_artifact",
        toolset="liangce",
        schema={
            "description": (
                "Create a real downloadable artifact file in artifacts/. Supports "
                "HTML, Markdown, TXT, JSON, CSV, XLSX, DOCX and PDF. For XLSX, "
                'content is JSON: {"sheets":[{"name":"数据","rows":[[...],[...]]}]}.'
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Filename including a supported extension.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete file content or XLSX JSON payload.",
                    },
                },
                "required": ["filename", "content"],
            },
        },
        handler=lambda args, **_kwargs: workspace.create_artifact(
            str(args.get("filename") or ""),
            str(args.get("content") or ""),
        ),
        description="Create a real Xiaoce artifact file.",
        emoji="📎",
    )


def _run(payload: dict) -> dict:
    workspace = Workspace(Path(str(payload.get("workspace") or "")))
    hermes_home = _ensure_hermes_profile(workspace)
    stream_file = _open_stream_file(workspace, payload)

    def emit_stream_event(event: dict) -> None:
        if stream_file is None:
            return
        stream_file.write(
            json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
        )
        stream_file.flush()

    def on_stream_delta(delta) -> None:
        if not isinstance(delta, str) or not delta:
            return
        emit_stream_event({"type": "delta", "delta": delta})

    # Hermes can print provider retry diagnostics even in quiet mode. Redirect
    # those diagnostics to stderr so stdout remains a strict JSON IPC channel.
    agent = None
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from hermes_state import SessionDB
            from run_agent import AIAgent

            _register_liangce_tools(workspace)
            tool_count = 0

            def tool_detail(name: str, args) -> str:
                if not isinstance(args, dict):
                    return ""
                if name == "liangce_create_artifact":
                    return str(args.get("filename") or "")[:160]
                if name == "liangce_read_file":
                    return str(args.get("path") or "")[:160]
                if name == "liangce_list_files":
                    return "查看 input/ 与 artifacts/ 中可用文件"
                # Memory arguments may contain user content. Only expose the
                # operation name, never memory values or provider reasoning.
                return ""

            def tool_label(name: str, *, completed: bool = False) -> str:
                labels = {
                    "liangce_list_files": ("正在检查可用文件", "已检查可用文件"),
                    "liangce_read_file": ("正在读取文件", "已读取文件"),
                    "liangce_create_artifact": ("正在创建真实文件产物", "已创建真实文件产物"),
                    "memory_recall": ("正在读取上下文记忆", "已读取上下文记忆"),
                    "memory_store": ("正在更新上下文记忆", "已更新上下文记忆"),
                }
                pair = labels.get(name)
                if pair:
                    return pair[1 if completed else 0]
                if "memory" in name.casefold():
                    return "已处理上下文记忆" if completed else "正在处理上下文记忆"
                return f"{'已完成' if completed else '正在调用'}工具 {name[:64]}"

            def on_tool_start(call_id, name, args) -> None:
                nonlocal tool_count
                tool_count += 1
                emit_stream_event({
                    "type": "trace",
                    "event": {
                        "id": str(call_id or f"tool-{tool_count}"),
                        "status": "running",
                        "label": tool_label(str(name or "")),
                        "detail": tool_detail(str(name or ""), args),
                    },
                })

            def on_tool_complete(call_id, name, args, _result) -> None:
                emit_stream_event({
                    "type": "trace",
                    "event": {
                        "id": str(call_id or name or "tool"),
                        "status": "completed",
                        "label": tool_label(str(name or ""), completed=True),
                        "detail": tool_detail(str(name or ""), args),
                    },
                })

            session_key = str(payload.get("session_key") or "default")
            session_id = (
                "liangce-"
                + hashlib.sha256(session_key.encode("utf-8")).hexdigest()[:24]
            )
            agent = AIAgent(
                base_url=str(payload.get("base_url") or "").rstrip("/"),
                api_key=str(payload.get("api_key") or ""),
                api_mode="chat_completions",
                model=str(payload.get("model") or ""),
                max_iterations=max(1, min(int(payload.get("max_turns") or 10), 30)),
                tool_delay=0,
                enabled_toolsets=["liangce", "memory"],
                quiet_mode=True,
                tool_progress_mode="off",
                ephemeral_system_prompt=str(payload.get("system_prompt") or ""),
                session_id=session_id,
                session_db=SessionDB(hermes_home / "state.db"),
                tool_start_callback=on_tool_start,
                tool_complete_callback=on_tool_complete,
                stream_delta_callback=on_stream_delta,
                max_tokens=8_192,
                platform="liangce-collab",
                user_id=str(payload.get("user_id") or ""),
                chat_id=session_key,
                chat_type="collaboration",
                skip_context_files=True,
                load_soul_identity=False,
                skip_memory=False,
                checkpoints_enabled=False,
            )
            result = agent.run_conversation(
                str(payload.get("message") or ""),
                conversation_history=list(payload.get("history") or [])[-12:],
            )
    finally:
        if agent is not None:
            agent.close()
        if stream_file is not None:
            stream_file.close()
    reply = str(result.get("final_response") or "").strip()
    error = str(result.get("error") or "").strip()
    if error:
        raise RuntimeError(error)
    if not reply or reply.startswith(
        (
            "API call failed",
            "I apologize, but I encountered an error",
            "I apologize, but I encountered repeated errors",
        )
    ):
        raise RuntimeError(reply or "Hermes Agent 未返回有效内容")
    return {
        "ok": True,
        "reply": reply,
        "tool_count": tool_count,
        "hermes_version": importlib.metadata.version("hermes-agent"),
    }


def main() -> None:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("请求必须是 JSON 对象")
        _emit(_run(payload))
    except Exception as exc:
        _emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
        raise SystemExit(1)


if __name__ == "__main__":
    main()
