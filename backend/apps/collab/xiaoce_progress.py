from __future__ import annotations

from copy import deepcopy

from django.db import transaction
from django.utils import timezone

from . import ws_push
from .models import CollabRoom, XiaoceRun


STAGES: dict[str, tuple[str, str]] = {
    "understanding": ("正在理解你的问题…", "已理解你的问题"),
    "knowledge_search": (
        "正在检索知识库与 PostgreSQL 数据…",
        "已检索知识库与 PostgreSQL 数据",
    ),
    "skill": ("正在调用 Skill…", "已调用 Skill"),
    "tools": ("正在运行工具…", "已运行 {tool_count} 个工具"),
    "validation": ("正在校验指标口径…", "已校验指标口径"),
    "composing": ("正在组织回答…", "分析完成，正在组织回答"),
    "history_read": ("正在读取当前会话…", "已读取当前会话"),
    "redaction": ("正在检查敏感信息…", "已完成敏感信息检查"),
    "skill_summary": ("正在提炼可复用流程…", "已提炼可复用流程"),
    "package_validation": ("正在校验 Skill 包…", "已校验 Skill 包"),
    "skill_upload": ("正在上传并启用 Skill…", "已上传并启用 Skill"),
}

ERROR_MESSAGES = {
    "knowledge_unavailable": "知识库或数据暂时不可用",
    "skill_generation_failed": "Skill 提炼失败",
    "package_invalid": "Skill 包结构校验失败",
    "skill_upload_failed": "Skill 上传或启用失败",
    "cancelled": "已暂停本次生成",
    "stage_failed": "当前步骤执行失败，请稍后重试",
}


def _iso_now() -> str:
    return timezone.now().isoformat()


def _tool_count(value) -> int:
    try:
        return max(0, min(int(value), 999))
    except (TypeError, ValueError):
        return 0


def _step_label(code: str, status: str, tool_count: int) -> str:
    running, completed = STAGES[code]
    if status == "running":
        return running
    if status == "completed":
        return completed.format(tool_count=tool_count)
    if status == "cancelled":
        return f"{running.rstrip('…')}（已暂停）"
    return f"{running.rstrip('…')}失败"


def _upsert_step(steps: list[dict], code: str, status: str, *, tool_count: int = 0) -> list[dict]:
    now = _iso_now()
    updated = deepcopy(steps or [])
    index = next((i for i, item in enumerate(updated) if item.get("code") == code), None)
    count = _tool_count(tool_count)
    if index is None:
        step = {
            "code": code,
            "label": _step_label(code, status, count),
            "status": status,
            "tool_count": count,
            "detail": "",
            "started_at": now,
            "finished_at": now if status != "running" else "",
        }
        updated.append(step)
    else:
        step = updated[index]
        step.update(
            label=_step_label(code, status, count),
            status=status,
            tool_count=count,
            finished_at=now if status != "running" else "",
        )
    return updated


def xiaoce_run_payload(run: XiaoceRun | None) -> dict | None:
    if run is None:
        return None
    return {
        "id": str(run.id),
        "status": run.status,
        "room_id": str(run.room_id),
        "current_stage": run.current_stage,
        "progress_steps": deepcopy(run.progress_steps or []),
        "error_code": run.error_code,
        "error_message": ERROR_MESSAGES.get(run.error_code, "") if run.error_code else "",
        "created_at": run.created_at.isoformat() if run.created_at else "",
        "updated_at": run.updated_at.isoformat() if run.updated_at else "",
    }


def _publish_after_commit(run: XiaoceRun) -> None:
    run_id = run.id
    room_id = run.room_id

    def publish_if_room_survives() -> None:
        with transaction.atomic():
            room = CollabRoom.objects.select_for_update().filter(id=room_id).first()
            if room is None:
                return
            current = (
                XiaoceRun.objects.select_for_update()
                .filter(id=run_id, room=room)
                .first()
            )
            if current is None:
                return
            ws_push.publish_sync(room_id, xiaoce_runs=[xiaoce_run_payload(current)])

    transaction.on_commit(
        publish_if_room_survives,
    )


class XiaoceProgressReporter:
    def __init__(self, run_id):
        self.run_id = run_id

    def start(self, code: str, *, detail: str = "") -> dict | None:
        del detail
        return self._record(code, "running")

    def complete(self, code: str, *, tool_count: int = 0, detail: str = "") -> dict | None:
        del detail
        return self._record(code, "completed", tool_count=tool_count)

    def fail(self, code: str, *, error_code: str = "stage_failed") -> dict | None:
        return self._record(code, "failed", error_code=error_code, terminal=True)

    def cancel_current(self) -> dict | None:
        run = XiaoceRun.objects.filter(id=self.run_id).only("current_stage").first()
        if not run or not run.current_stage:
            return None
        return self._record(run.current_stage, "cancelled", error_code="cancelled", terminal=True)

    @transaction.atomic
    def _record(
        self,
        code: str,
        status: str,
        *,
        tool_count: int = 0,
        error_code: str = "",
        terminal: bool = False,
    ) -> dict | None:
        if code not in STAGES:
            raise ValueError("小策工作阶段无效")
        if error_code and error_code not in ERROR_MESSAGES:
            error_code = "stage_failed"
        room_id = (
            XiaoceRun.objects.filter(id=self.run_id)
            .values_list("room_id", flat=True)
            .first()
        )
        if room_id is None:
            return None
        room = CollabRoom.objects.select_for_update().filter(id=room_id).first()
        if room is None:
            return None
        run = (
            XiaoceRun.objects.select_for_update()
            .filter(id=self.run_id, room=room)
            .first()
        )
        if run is None or run.status != XiaoceRun.Status.RUNNING:
            return xiaoce_run_payload(run)
        run.current_stage = code
        run.progress_steps = _upsert_step(
            run.progress_steps,
            code,
            status,
            tool_count=tool_count,
        )
        fields = ["current_stage", "progress_steps", "updated_at"]
        if error_code:
            run.error_code = error_code
            run.error = ERROR_MESSAGES[error_code]
            fields.extend(["error_code", "error"])
        if terminal:
            run.status = (
                XiaoceRun.Status.CANCELLED
                if status == "cancelled"
                else XiaoceRun.Status.FAILED
            )
            run.finished_at = timezone.now()
            if status == "cancelled":
                run.cancelled_at = run.finished_at
                fields.append("cancelled_at")
            fields.extend(["status", "finished_at"])
        run.save(update_fields=fields)
        _publish_after_commit(run)
        return xiaoce_run_payload(run)
