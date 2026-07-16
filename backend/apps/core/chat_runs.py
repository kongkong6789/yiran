from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .models import ChatMessage, ChatRun

PAUSED_REPLY = "已暂停本次生成。"


class ChatRunCancelled(RuntimeError):
    """当前对话执行已由用户暂停。"""


def is_run_cancelled(run_id) -> bool:
    return ChatRun.objects.filter(
        id=run_id,
        status=ChatRun.Status.CANCELLED,
    ).exists()


@transaction.atomic
def cancel_run(run: ChatRun, *, save_message: bool = True) -> ChatRun:
    locked = ChatRun.objects.select_for_update().get(id=run.id)
    if locked.status == ChatRun.Status.COMPLETED:
        raise ValueError("本轮回答已经完成，无法暂停")
    if locked.status == ChatRun.Status.CANCELLED:
        return locked

    locked.status = ChatRun.Status.CANCELLED
    locked.cancelled_at = timezone.now()
    if save_message and locked.cancel_message_id is None:
        locked.cancel_message = ChatMessage.objects.create(
            session=locked.session,
            role="assistant",
            content=PAUSED_REPLY,
            meta={"run_id": str(locked.id), "cancelled": True},
        )
    locked.save(
        update_fields=["status", "cancelled_at", "cancel_message", "updated_at"],
    )
    return locked
