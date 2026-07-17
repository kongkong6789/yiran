# Xiaoce Pause, Theme, and Conversation Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real cancellation, a remembered black/white theme, and private conversation-to-Skill packaging to the existing `/collab` Xiaoce bot without changing other collaboration rooms.

**Architecture:** Persist every Xiaoce answer as a user-owned `XiaoceRun`, propagate a database-backed cancellation callback through the existing Agent dependencies, and settle cancellation versus completion under a row lock. Prepare Skill ZIPs in memory from sanitized `CollabRoom` history, then atomically save the private asset, enable it, create the Xiaoce result message, and complete the run. The React UI consumes the existing room/WebSocket channel for run state and scopes theme variables to the middle Xiaoce panel.

**Tech Stack:** Django, Django REST Framework, SQLite/PostgreSQL-compatible migrations, Python threads/urllib/subprocess, React 18, TypeScript, Ant Design, existing WebSocket and polling sync, Node test runner.

## Global Constraints

- Preserve the current `/collab` room, message, WebSocket, polling, attachment, and risk-monitoring behavior.
- Only Xiaoce bot direct messages receive pause, theme, and conversation-packaging behavior.
- Default theme is pure white; the alternative is pure black; do not add a neutral-gray theme.
- Keep the existing `liangce_chat_theme` storage key and preserve Xiaoce/logo/avatar colors.
- Generated conversation Skills are `private`, visible only to the current user, automatically uploaded and enabled.
- Repeated packaging in the same Xiaoce room updates the same stable Skill ID.
- Never put raw chat transcripts, credentials, or model-invented executable scripts in the package.
- Do not change the `/agent` route or bulk-merge the old feature branch.
- Use focused red/green tests; run one frontend build and one browser acceptance pass at the end.
- Do not push or deploy until the user approves the local browser preview.

---

## File Map

- `backend/apps/core/cancellation.py`: dependency-free cancellation exception/guard.
- `backend/apps/collab/xiaoce_runs.py`: transactional run state and completion helpers.
- `backend/apps/core/conversation_skill.py`: intent detection, history sanitization, validated in-memory ZIP preparation.
- `backend/apps/collab/models.py` and migration `0013_xiaoce_run_and_message_meta.py`: run persistence, message metadata, Xiaoce AI kind.
- `backend/apps/skills/models.py` and migration `0004_skillasset_visibility.py`: private/shared assets.
- `backend/apps/skills/repository.py` and `views.py`: visibility-aware storage and responses.
- `backend/apps/core/agent_chat.py`, `council/llm.py`, `mcp/client.py`, `skills/runner.py`: cooperative cancellation.
- `backend/apps/collab/views.py` and `urls.py`: create/cancel/recover runs and route packaging commands.
- Backend tests: `backend/apps/collab/tests/`, `backend/apps/core/tests/`, `backend/apps/skills/tests/`.
- `frontend/src/pages/xiaoceChat.ts`: pure Xiaoce detection and UUID helpers.
- `frontend/src/api/client.ts`: run, metadata, and created-Skill contracts.
- `frontend/src/pages/CollabRisk.tsx`: stop control, local theme switch, created-Skill refresh.
- `frontend/src/styles/xiaoceChatTheme.css`: selectors scoped to `.xiaoce-chat-shell`.
- `frontend/tests/xiaoceChat.test.ts`: pure and source-scope regressions.

---

### Task 1: Add persistent Xiaoce runs and message metadata

**Files:**
- Create: `backend/apps/collab/tests/__init__.py`
- Create: `backend/apps/collab/tests/test_xiaoce_runs.py`
- Create: `backend/apps/collab/xiaoce_runs.py`
- Create: `backend/apps/collab/migrations/0013_xiaoce_run_and_message_meta.py`
- Modify: `backend/apps/collab/models.py:70-126`

**Interfaces:**
- Produces: `create_xiaoce_run(run_id, room, user, trigger_message) -> XiaoceRun`
- Produces: `is_xiaoce_run_cancelled(run_id) -> bool`
- Produces: `cancel_xiaoce_run(run) -> XiaoceRun`
- Produces: `complete_xiaoce_run(run_id, reply, meta=None) -> CollabMessage | None`
- Produces: `fail_xiaoce_run(run_id, error) -> None`
- Produces: `xiaoce_run_payload(run) -> dict`

- [ ] **Step 1: Write failing state and idempotency tests**

```python
# backend/apps/collab/tests/test_xiaoce_runs.py
import uuid
from django.contrib.auth.models import User
from django.test import TestCase
from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom, XiaoceRun
from apps.collab.xiaoce_runs import cancel_xiaoce_run, complete_xiaoce_run, create_xiaoce_run

class XiaoceRunTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner", password="pw")
        bot = get_xiaoce_bot_user()
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=bot)
        self.trigger = CollabMessage.objects.create(room=self.room, sender=self.user, content="分析数据")

    def make_run(self):
        return create_xiaoce_run(uuid.uuid4(), self.room, self.user, self.trigger)

    def test_cancel_is_idempotent(self):
        run = self.make_run()
        first = cancel_xiaoce_run(run)
        second = cancel_xiaoce_run(run)
        self.assertEqual(first.cancel_message_id, second.cancel_message_id)
        self.assertEqual(first.cancel_message.meta, {"run_id": str(run.id), "cancelled": True})
        self.assertEqual(CollabMessage.objects.filter(content="已暂停本次生成。").count(), 1)

    def test_cancelled_run_cannot_save_reply(self):
        run = self.make_run()
        cancel_xiaoce_run(run)
        self.assertIsNone(complete_xiaoce_run(run.id, "不应保存"))
        self.assertFalse(CollabMessage.objects.filter(content="不应保存").exists())

    def test_completed_run_cannot_be_cancelled(self):
        run = self.make_run()
        complete_xiaoce_run(run.id, "完成")
        with self.assertRaisesMessage(ValueError, "本轮回答已经完成，无法暂停"):
            cancel_xiaoce_run(run)
```

- [ ] **Step 2: Verify RED**

Run: `backend/.venv/bin/python backend/manage.py test apps.collab.tests.test_xiaoce_runs -v 2`

Expected: import/model failure because `XiaoceRun` and `CollabMessage.meta` do not exist.

- [ ] **Step 3: Implement the model, migration, and transactional helpers**

```python
# append after CollabMessage in backend/apps/collab/models.py
class XiaoceRun(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "运行中"
        CANCELLED = "cancelled", "已暂停"
        COMPLETED = "completed", "已完成"
        FAILED = "failed", "失败"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.ForeignKey(CollabRoom, related_name="xiaoce_runs", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="xiaoce_runs", on_delete=models.CASCADE)
    trigger_message = models.OneToOneField(CollabMessage, related_name="xiaoce_run", on_delete=models.CASCADE)
    cancel_message = models.OneToOneField(
        CollabMessage, related_name="cancelled_xiaoce_run", null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING, db_index=True)
    error = models.TextField(blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["room", "user"], condition=models.Q(status="running"),
                name="uniq_running_xiaoce_per_user_room",
            ),
        ]
```

Add `meta = models.JSONField("元数据", default=dict, blank=True)` to `CollabMessage` and add `("xiaoce", "小策bot")` to `ai_kind` choices. Migration `0013` must create `XiaoceRun`, add `meta`, alter `ai_kind`, and add the conditional unique constraint.

```python
# backend/apps/collab/xiaoce_runs.py
from django.db import transaction
from django.utils import timezone
from .mentions import get_xiaoce_bot_user
from .models import CollabMessage, XiaoceRun

PAUSED_REPLY = "已暂停本次生成。"

def create_xiaoce_run(run_id, room, user, trigger_message):
    return XiaoceRun.objects.create(id=run_id, room=room, user=user, trigger_message=trigger_message)

def is_xiaoce_run_cancelled(run_id):
    return XiaoceRun.objects.filter(id=run_id, status=XiaoceRun.Status.CANCELLED).exists()

def xiaoce_run_payload(run):
    return {"id": str(run.id), "status": run.status, "room_id": str(run.room_id)}

@transaction.atomic
def cancel_xiaoce_run(run):
    locked = XiaoceRun.objects.select_for_update().select_related("room").get(id=run.id)
    if locked.status == XiaoceRun.Status.COMPLETED:
        raise ValueError("本轮回答已经完成，无法暂停")
    if locked.status == XiaoceRun.Status.CANCELLED:
        return locked
    if locked.status == XiaoceRun.Status.FAILED:
        raise ValueError("本轮回答已经结束，无法暂停")
    now = timezone.now()
    locked.status = XiaoceRun.Status.CANCELLED
    locked.cancelled_at = locked.finished_at = now
    locked.cancel_message = CollabMessage.objects.create(
        room=locked.room, sender=get_xiaoce_bot_user(), content=PAUSED_REPLY,
        attachments=[], mentions=[], msg_type="ai", ai_kind="xiaoce",
        meta={"run_id": str(locked.id), "cancelled": True},
    )
    locked.save(update_fields=["status", "cancelled_at", "finished_at", "cancel_message", "updated_at"])
    locked.room.save(update_fields=["updated_at"])
    return locked

@transaction.atomic
def complete_xiaoce_run(run_id, reply, meta=None):
    locked = XiaoceRun.objects.select_for_update().select_related("room").get(id=run_id)
    if locked.status != XiaoceRun.Status.RUNNING:
        return None
    msg = CollabMessage.objects.create(
        room=locked.room, sender=get_xiaoce_bot_user(), content=reply[:8000],
        attachments=[], mentions=[], msg_type="ai", ai_kind="xiaoce",
        meta={"run_id": str(locked.id), **(meta or {})},
    )
    locked.status = XiaoceRun.Status.COMPLETED
    locked.finished_at = timezone.now()
    locked.save(update_fields=["status", "finished_at", "updated_at"])
    locked.room.save(update_fields=["updated_at"])
    return msg

def fail_xiaoce_run(run_id, error):
    XiaoceRun.objects.filter(id=run_id, status=XiaoceRun.Status.RUNNING).update(
        status=XiaoceRun.Status.FAILED, error=str(error)[:2000], finished_at=timezone.now(),
    )
```

- [ ] **Step 4: Verify GREEN and migration consistency**

Run: `backend/.venv/bin/python backend/manage.py test apps.collab.tests.test_xiaoce_runs -v 2`

Expected: 3 tests PASS.

Run: `backend/.venv/bin/python backend/manage.py makemigrations --check --dry-run`

Expected: `No changes detected`.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/collab/models.py backend/apps/collab/migrations/0013_xiaoce_run_and_message_meta.py backend/apps/collab/xiaoce_runs.py backend/apps/collab/tests
git commit -m "feat: add cancellable xiaoce runs"
```

---

### Task 2: Propagate cooperative cancellation through Agent dependencies

**Files:**
- Create: `backend/apps/core/cancellation.py`
- Create: `backend/apps/core/tests/__init__.py`
- Create: `backend/apps/core/tests/test_agent_cancellation.py`
- Modify: `backend/apps/core/agent_chat.py:80-330`
- Modify: `backend/apps/council/llm.py:154-360`
- Modify: `backend/apps/mcp/client.py:15-360`
- Modify: `backend/apps/skills/runner.py:160-350`

**Interfaces:**
- Produces: `AgentRunCancelled`, `raise_if_cancelled(cancel_check)`
- Extends: `run_chat(message, history=None, user=None, skill_ids=None, attachments=None, model=None, cancel_check=None)`
- Extends: `chat_messages_result(system, messages, temperature=0.7, max_tokens=800, model=None, timeout=45, llm_user=None, allow_images=True, api_key=None, base_url=None, cancel_check=None)`
- Extends: `read_wecom_document(question, document_url=None, user=None, cancel_check=None)`
- Extends: `try_execute_skill_scripts(skills, message, user, history=None, cancel_check=None)`

- [ ] **Step 1: Write failing dependency tests**

```python
# backend/apps/core/tests/test_agent_cancellation.py
import sys, tempfile
from pathlib import Path
from unittest import TestCase, mock
from apps.core.cancellation import AgentRunCancelled
from apps.mcp.client import StreamableHttpClient
from apps.skills.runner import run_shell_command

class AgentCancellationTests(TestCase):
    def test_mcp_stops_before_network(self):
        with mock.patch("urllib.request.urlopen") as opened:
            with self.assertRaises(AgentRunCancelled):
                StreamableHttpClient("http://mcp", cancel_check=lambda: True).initialize()
        opened.assert_not_called()

    def test_skill_process_is_terminated(self):
        with tempfile.TemporaryDirectory() as tmp:
            cmd = f'{sys.executable} -c "import time; time.sleep(30)"'
            with self.assertRaises(AgentRunCancelled):
                run_shell_command(Path(tmp), cmd, cancel_check=lambda: True, poll_interval=0.01)
```

- [ ] **Step 2: Verify RED**

Run: `backend/.venv/bin/python backend/manage.py test apps.core.tests.test_agent_cancellation -v 2`

Expected: missing cancellation module/signatures.

- [ ] **Step 3: Add the shared guard and proven cancellation loops**

```python
# backend/apps/core/cancellation.py
class AgentRunCancelled(RuntimeError):
    """The current Agent execution was cancelled by its owner."""

def raise_if_cancelled(cancel_check):
    if cancel_check and cancel_check():
        raise AgentRunCancelled()
```

In `llm.py`, add `cancel_check=None` to `chat_messages_result`. Preserve the non-streaming path when it is absent; when present, send `"stream": True`, read SSE lines, call `raise_if_cancelled` before every line and after `[DONE]`, close the response by leaving its context, and re-raise `AgentRunCancelled` unchanged.

In `mcp/client.py`, store `cancel_check` on `StreamableHttpClient`; check before opening, after opening, around `initialize/tools/list/tools/call`, and before every `resp.read(64 * 1024)`. Add the callback to `read_wecom_document` and never convert `AgentRunCancelled` into `McpClientError`.

In `skills/runner.py`, use `subprocess.Popen(command, cwd=str(workspace), shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", env=env, start_new_session=True)` plus `communicate(timeout=poll_interval)`. On cancellation terminate the process group, wait two seconds, kill if needed, then raise `AgentRunCancelled`. Pass the callback through `try_execute_skill_scripts`.

In `agent_chat.py`, add `cancel_check=None`, call `raise_if_cancelled` before and after RAG, graph lookup, MCP, Skill scripts, images, and LLM, and pass the callback to each cancellable dependency. Do not change prompts, model fallback, or result fields.

- [ ] **Step 4: Verify GREEN**

Run: `backend/.venv/bin/python backend/manage.py test apps.core.tests.test_agent_cancellation -v 2`

Expected: tests PASS in under 5 seconds and no orphan sleep process.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/cancellation.py backend/apps/core/tests backend/apps/core/agent_chat.py backend/apps/council/llm.py backend/apps/mcp/client.py backend/apps/skills/runner.py
git commit -m "feat: support cooperative agent cancellation"
```

---

### Task 3: Add private Skill asset support without changing shared assets

**Files:**
- Create: `backend/apps/skills/migrations/0004_skillasset_visibility.py`
- Create: `backend/apps/skills/tests/__init__.py`
- Create: `backend/apps/skills/tests/test_private_assets.py`
- Modify: `backend/apps/skills/models.py:43-90`
- Modify: `backend/apps/skills/repository.py:54-270`
- Modify: `backend/apps/skills/views.py:44-60`

**Interfaces:**
- Extends: `save_skill_asset_from_bytes(user, filename, data, adopt=False, visibility="shared", skill_id_override=None)`
- Guarantees: shared listing/find/sync excludes private assets.

- [ ] **Step 1: Write failing visibility tests**

```python
# backend/apps/skills/tests/test_private_assets.py
from django.contrib.auth.models import User
from django.test import TestCase
from apps.skills.models import SkillAsset
from apps.skills.repository import find_shared_asset, list_skill_assets

class PrivateAssetTests(TestCase):
    def test_private_asset_is_not_shared(self):
        user = User.objects.create_user("owner")
        SkillAsset.objects.create(
            uploader=user, skill_id="private-one", name="Private", visibility="private",
        )
        self.assertEqual(list_skill_assets(shared=True), [])
        self.assertIsNone(find_shared_asset("private-one"))
```

- [ ] **Step 2: Verify RED**

Run: `backend/.venv/bin/python backend/manage.py test apps.skills.tests.test_private_assets -v 2`

Expected: `visibility` field failure.

- [ ] **Step 3: Add visibility and repository filters**

```python
# inside SkillAsset
class Visibility(models.TextChoices):
    SHARED = "shared", "全员共享"
    PRIVATE = "private", "仅上传者"

visibility = models.CharField(
    "可见范围", max_length=16, choices=Visibility.choices,
    default=Visibility.SHARED, db_index=True,
)
```

Migration `0004` adds the field with default `shared`. Filter `list_skill_assets(shared=True)`, `find_shared_asset`, and `ensure_shared_skills_for_user` by `visibility=SkillAsset.Visibility.SHARED`. Add `visibility` to API payloads.

Extend storage exactly as follows:

```python
def save_skill_asset_from_bytes(
    user, filename, data, *, adopt=False,
    visibility=SkillAsset.Visibility.SHARED,
    skill_id_override=None,
):
    extracted = extract_skill_from_upload(filename, data)
    parsed = {k: v for k, v in extracted.items() if k not in {"package_files", "upload_kind"}}
    package_files = extracted.get("package_files") or []
    upload_kind = extracted.get("upload_kind") or "single"
    if visibility not in SkillAsset.Visibility.values:
        raise ValueError("Skill 可见范围无效")
    skill_id = parsed["skill_id"]
    if skill_id_override is not None:
        skill_id = slugify(skill_id_override, allow_unicode=False)[:64]
        if not skill_id:
            raise ValueError("Skill ID 无效")
    # Continue through the existing COS/local storage branches. In both
    # SkillAsset.update_or_create defaults dictionaries set:
    # "visibility": visibility,
```

- [ ] **Step 4: Verify GREEN and migrations**

Run: `backend/.venv/bin/python backend/manage.py test apps.skills.tests.test_private_assets -v 2`

Expected: tests PASS.

Run: `backend/.venv/bin/python backend/manage.py makemigrations --check --dry-run`

Expected: `No changes detected`.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/skills/models.py backend/apps/skills/migrations/0004_skillasset_visibility.py backend/apps/skills/repository.py backend/apps/skills/views.py backend/apps/skills/tests
git commit -m "feat: support private skill assets"
```

---

### Task 4: Prepare a validated Skill package from Xiaoce room history

**Files:**
- Create: `backend/apps/core/conversation_skill.py`
- Create: `backend/apps/core/tests/test_conversation_skill.py`

**Interfaces:**
- Produces: `is_conversation_skill_request(text) -> bool`
- Produces: `prepare_conversation_skill(user, room, exclude_message_id, cancel_check=None, model=None) -> PreparedConversationSkill`
- Produces dataclass fields: `skill_id`, `filename`, `package_data`, `name`, `description`

- [ ] **Step 1: Write failing intent, filtering, and sanitization tests**

```python
# backend/apps/core/tests/test_conversation_skill.py
from django.contrib.auth.models import User
from django.test import TestCase
from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom
from apps.core.conversation_skill import _conversation_rows, _sanitize, is_conversation_skill_request

class ConversationSkillTests(TestCase):
    def test_intent_requires_conversation_skill_and_action(self):
        self.assertTrue(is_conversation_skill_request("把这次对话打包成 Skill 并上传"))
        self.assertFalse(is_conversation_skill_request("Skill 是什么"))
        self.assertFalse(is_conversation_skill_request("总结这次对话"))

    def test_sanitize_removes_credentials(self):
        text = _sanitize("api_key=sk-1234567890abcdef password:secret Bearer abc.def")
        self.assertNotIn("secret", text)
        self.assertNotIn("sk-1234567890abcdef", text)
        self.assertNotIn("abc.def", text)

    def test_rows_exclude_command_and_paused_placeholder(self):
        user = User.objects.create_user("owner")
        bot = get_xiaoce_bot_user()
        room = CollabRoom.objects.create(created_by=user, room_kind="dm")
        CollabParticipant.objects.create(room=room, user=user)
        CollabParticipant.objects.create(room=room, user=bot)
        CollabMessage.objects.create(room=room, sender=user, content="分析销售")
        CollabMessage.objects.create(room=room, sender=bot, content="结论", msg_type="ai", ai_kind="xiaoce")
        CollabMessage.objects.create(room=room, sender=bot, content="已暂停本次生成。", msg_type="ai", ai_kind="xiaoce", meta={"cancelled": True})
        command = CollabMessage.objects.create(room=room, sender=user, content="打包成 Skill")
        rows = _conversation_rows(room, exclude_message_id=command.id)
        self.assertEqual([row["content"] for row in rows], ["分析销售", "结论"])
```

- [ ] **Step 2: Verify RED**

Run: `backend/.venv/bin/python backend/manage.py test apps.core.tests.test_conversation_skill -v 2`

Expected: missing module/functions.

- [ ] **Step 3: Implement preparation without database asset writes**

Implement the intent and credential rules exactly, then adapt history to `CollabRoom`:

```python
SOURCE_TERMS = ("这次对话", "本次对话", "当前对话", "聊天记录", "会话记录", "conversation", "chat history")
SKILL_TERMS = ("skill", "技能")
ACTION_TERMS = ("打包", "生成", "创建", "整理", "总结", "提炼", "package", "create", "build")
UPLOAD_TERMS = ("上传", "启用", "安装", "平台", "upload", "enable", "install")
SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"\bBearer\s+[^\s,;]+", re.IGNORECASE),
    re.compile(
        r"(?P<label>\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|cookie|password)\b|密码|密钥)"
        r"\s*[:=：]\s*[^\s,;]+", re.IGNORECASE,
    ),
)

def is_conversation_skill_request(text):
    normalized = (text or "").strip().lower()
    return bool(
        normalized
        and any(term in normalized for term in SKILL_TERMS)
        and any(term in normalized for term in ACTION_TERMS)
        and (any(term in normalized for term in SOURCE_TERMS) or any(term in normalized for term in UPLOAD_TERMS))
    )

@dataclass(frozen=True)
class PreparedConversationSkill:
    skill_id: str
    filename: str
    package_data: bytes
    name: str
    description: str

def _conversation_rows(room, exclude_message_id=None):
    query = room.messages.select_related("sender").exclude(status__in=["deleted", "recalled"]).order_by("created_at", "id")
    if exclude_message_id is not None:
        query = query.exclude(id=exclude_message_id)
    rows = []
    for row in query:
        if row.msg_type not in {"user", "ai"} or (row.meta or {}).get("cancelled"):
            continue
        role = "assistant" if row.msg_type == "ai" else "user"
        content = _sanitize(row.content).strip()
        if content:
            rows.append({"role": role, "content": content})
    if not any(r["role"] == "user" for r in rows) or not any(r["role"] == "assistant" for r in rows):
        raise ConversationSkillError("当前会话至少完成一轮用户与助手对话后才能打包")
    return rows

def _stable_skill_id(room, rows):
    first_task = next(row["content"] for row in rows if row["role"] == "user")
    base = slugify(first_task, allow_unicode=False) or "conversation-workflow"
    suffix = room.id.hex[:8]
    return f"{base[:55].strip('-') or 'conversation-workflow'}-{suffix}"
```

`prepare_conversation_skill` must call `llm.chat_messages_result(system, messages, temperature=0.2, max_tokens=3000, model=model, timeout=90, llm_user=user, allow_images=False, cancel_check=cancel_check)`, require strict JSON keys `name`, `description`, `instructions`, `workflow_summary`, validate the generated ZIP with `extract_skill_from_upload`, require paths exactly `SKILL.md` and `references/workflow-summary.md`, and return the dataclass. It must not call `save_skill_asset_from_bytes`.

- [ ] **Step 4: Verify GREEN**

Run: `backend/.venv/bin/python backend/manage.py test apps.core.tests.test_conversation_skill -v 2`

Expected: intent/filter/sanitization tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/conversation_skill.py backend/apps/core/tests/test_conversation_skill.py
git commit -m "feat: prepare skills from xiaoce conversations"
```

---

### Task 5: Wire Xiaoce send, cancel, packaging, and atomic Skill completion

**Files:**
- Create: `backend/apps/collab/tests/test_xiaoce_api.py`
- Modify: `backend/apps/collab/xiaoce_runs.py`
- Modify: `backend/apps/collab/views.py:80-120,472-537,1080-1158`
- Modify: `backend/apps/collab/urls.py:5-21`

**Interfaces:**
- Produces: `POST /api/collab/rooms/{room_id}/xiaoce-runs/{run_id}/cancel/`
- Extends room/message response with `active_xiaoce_run` and `xiaoce_run`.
- Produces: `complete_xiaoce_run_with_skill(run_id, prepared) -> CollabMessage | None`

- [ ] **Step 1: Write failing API and atomic packaging tests**

```python
# backend/apps/collab/tests/test_xiaoce_api.py
import uuid
from unittest.mock import patch
from django.contrib.auth.models import User
from rest_framework.test import APITestCase
from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabParticipant, CollabRoom, XiaoceRun

class XiaoceApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner", password="pw")
        bot = get_xiaoce_bot_user()
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=bot)
        self.client.force_authenticate(self.user)

    @patch("apps.collab.views.threading.Thread")
    def test_send_returns_active_run(self, thread_cls):
        run_id = uuid.uuid4()
        res = self.client.post(f"/api/collab/rooms/{self.room.id}/messages/", {"content": "分析", "run_id": str(run_id)})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["xiaoce_run"]["id"], str(run_id))
        thread_cls.return_value.start.assert_called_once()

    @patch("apps.collab.views.threading.Thread")
    def test_cancel_is_idempotent(self, _thread_cls):
        run_id = uuid.uuid4()
        self.client.post(f"/api/collab/rooms/{self.room.id}/messages/", {"content": "分析", "run_id": str(run_id)})
        url = f"/api/collab/rooms/{self.room.id}/xiaoce-runs/{run_id}/cancel/"
        first = self.client.post(url)
        second = self.client.post(url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.data["message"]["id"], first.data["message"]["id"])
```

- [ ] **Step 2: Verify RED**

Run: `backend/.venv/bin/python backend/manage.py test apps.collab.tests.test_xiaoce_api -v 2`

Expected: missing response contract/cancel route.

- [ ] **Step 3: Add atomic Skill settlement**

```python
# backend/apps/collab/xiaoce_runs.py
@transaction.atomic
def complete_xiaoce_run_with_skill(run_id, prepared):
    locked = XiaoceRun.objects.select_for_update().select_related("room", "user").get(id=run_id)
    if locked.status != XiaoceRun.Status.RUNNING:
        return None
    asset, personal = save_skill_asset_from_bytes(
        locked.user, prepared.filename, prepared.package_data, adopt=True,
        visibility=SkillAsset.Visibility.PRIVATE,
        skill_id_override=prepared.skill_id,
    )
    if personal is None:
        raise ConversationSkillError("Skill 已生成但未能自动启用")
    created = {
        "asset_id": asset.id, "personal_id": personal.id, "skill_id": asset.skill_id,
        "name": personal.name, "description": personal.description,
        "visibility": asset.visibility, "enabled": personal.enabled,
    }
    reply = f"已将这次对话提炼为 Skill「{personal.name}」，已自动上传并启用（仅你可见）。\n\nSkill ID：`{asset.skill_id}`"
    return _complete_locked_run(locked, reply, {"created_skill": created})
```

`_complete_locked_run` creates the Xiaoce message, embeds `run_id` plus supplied metadata, marks the run completed, and updates the room within the same transaction. Therefore cancel either wins before asset creation, or waits and receives 409 after completion.

- [ ] **Step 4: Wire views and realtime state**

During Xiaoce POST, validate/generate `run_id`, create the run after the user message, reject a second active run with HTTP 409, start `_run_xiaoce_reply_async(run.id, content)`, and return `xiaoce_run_payload(run)`.

The background function must:

```python
def _xiaoce_history_before(room, trigger_message_id):
    rows = (
        room.messages.select_related("sender")
        .exclude(status__in=["deleted", "recalled"])
        .filter(id__lt=trigger_message_id)
        .order_by("-id")[:20]
    )
    history = []
    for message in reversed(list(rows)):
        if not (message.content or "").strip() or (message.meta or {}).get("cancelled"):
            continue
        history.append({
            "role": "assistant" if message.msg_type == "ai" else "user",
            "content": message.content,
        })
    return history

history = _xiaoce_history_before(run.room, run.trigger_message_id)
if is_conversation_skill_request(trigger_content):
    try:
        prepared = prepare_conversation_skill(
            run.user, run.room, exclude_message_id=run.trigger_message_id,
            cancel_check=lambda: is_xiaoce_run_cancelled(run.id),
        )
        ai_msg = complete_xiaoce_run_with_skill(run.id, prepared)
    except ConversationSkillError as exc:
        ai_msg = complete_xiaoce_run(
            run.id, f"Skill 自动生成失败：{exc}", {"skill_generation_failed": True},
        )
else:
    result = run_chat(
        message=trigger_content, history=history[-16:], user=run.user,
        cancel_check=lambda: is_xiaoce_run_cancelled(run.id),
    )
    reply = str(
        result.get("reply")
        or result.get("error")
        or "知识问答暂时不可用，请稍后再试。"
    ).strip()
    ai_msg = complete_xiaoce_run(run.id, reply)
```

Catch `AgentRunCancelled` without creating another message. Publish completed/cancelled messages with `active_xiaoce_run: None`; expose the current viewer's running item in room detail. Add the cancel route with room/user ownership, idempotent placeholder publication, 409 for completed/failed, and 404 for missing/not-owned.

- [ ] **Step 5: Verify backend integration and commit**

Run: `backend/.venv/bin/python backend/manage.py test apps.collab.tests apps.core.tests apps.skills.tests -v 2`

Expected: focused tests PASS.

```bash
git add backend/apps/collab/xiaoce_runs.py backend/apps/collab/views.py backend/apps/collab/urls.py backend/apps/collab/tests/test_xiaoce_api.py
git commit -m "feat: wire pause and skill packaging into xiaoce"
```

---

### Task 6: Add frontend pause, created-Skill state, and scoped theme

**Files:**
- Create: `frontend/src/pages/xiaoceChat.ts`
- Create: `frontend/src/styles/xiaoceChatTheme.css`
- Create: `frontend/tests/xiaoceChat.test.ts`
- Modify: `frontend/src/api/client.ts:1240-1306,1602-1636`
- Modify: `frontend/src/components/ChatSkillPicker.tsx:12-45`
- Modify: `frontend/src/pages/CollabRisk.tsx:1-48,603-666,1315-1404,2114-2180,2680-2712`

**Interfaces:**
- Produces: `isXiaoceRoom(room)`, `createXiaoceRunId()`.
- Consumes: `CollabRoom.active_xiaoce_run`, `CollabMessage.meta.created_skill`.
- Produces: `cancelXiaoceRun(roomId, runId)`.

- [ ] **Step 1: Write failing pure/source-scope tests**

```typescript
// frontend/tests/xiaoceChat.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createXiaoceRunId, isXiaoceRoom } from "../src/pages/xiaoceChat.ts";

test("recognizes only Xiaoce direct messages", () => {
  assert.equal(isXiaoceRoom({ room_kind: "dm", participants: [{ username: "小策bot", bot_id: "xiaoce" }] }), true);
  assert.equal(isXiaoceRoom({ room_kind: "group", participants: [{ username: "小策bot", bot_id: "xiaoce" }] }), false);
});

test("creates a UUID", () => {
  assert.match(createXiaoceRunId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("theme CSS is Xiaoce-scoped and preserves avatars", () => {
  const css = readFileSync(new URL("../src/styles/xiaoceChatTheme.css", import.meta.url), "utf8");
  assert.match(css, /\.xiaoce-chat-shell\[data-chat-theme="dark"\]/);
  assert.doesNotMatch(css, /(?:^|\n)body\[data-chat-theme=/);
  assert.doesNotMatch(css, /filter\s*:/);
});
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && npm test`

Expected: missing helper/CSS failures.

- [ ] **Step 3: Add helpers and API types**

```typescript
// frontend/src/pages/xiaoceChat.ts
type RoomLike = { room_kind?: string; participants?: Array<{ username?: string; bot_id?: string }> };
export function isXiaoceRoom(room: RoomLike | null | undefined): boolean {
  return room?.room_kind === "dm" && Boolean(room.participants?.some(
    (p) => p.bot_id === "xiaoce" || p.username === "小策bot",
  ));
}
export function createXiaoceRunId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

Add `XiaoceRunSummary`, `CreatedSkillItem`, `active_xiaoce_run`, and message `meta` to `client.ts`. Append `run_id` to JSON/FormData only for Xiaoce and add the cancel POST. Add optional `refreshKey` to `ChatSkillPicker`; reload when it changes.

- [ ] **Step 4: Wire pause and created-Skill refresh**

In `CollabRisk`, derive the current active run from `activeRoom`, submit a UUID for Xiaoce, prevent a second send while active, and merge run state from HTTP/WebSocket. The composer button becomes:

```tsx
<Button
  className={xiaoceBusy ? "agent-chat-stop-circle" : "agent-chat-send-circle"}
  type="primary" shape="circle"
  icon={xiaoceBusy ? <span className="agent-chat-stop-glyph" aria-hidden="true" /> : <SendOutlined />}
  loading={Boolean(cancellingRunId)}
  disabled={xiaoceBusy ? Boolean(cancellingRunId) : sendDisabled}
  onClick={xiaoceBusy ? pauseXiaoce : handleSend}
  aria-label={cancellingRunId ? "正在暂停" : xiaoceBusy ? "暂停生成" : "发送"}
/>
```

When a new message contains `meta.created_skill`, increment `skillRefreshKey` and show its private/enabled state in the Xiaoce message. Failed/cancelled messages must not show a success tag.

- [ ] **Step 5: Add locally scoped theme**

Reuse `readChatTheme`, `persistChatTheme`, and the existing storage key without setting `document.body`. Apply only:

```tsx
<section
  className={`collab-main ${isXiaoce ? "xiaoce-chat-shell" : ""}`}
  data-chat-theme={isXiaoce ? chatTheme : undefined}
>
```

Create `xiaoceChatTheme.css` with light variables (`#ffffff` canvas, `#000000` text/action) and dark variables (`#000000` canvas, `#ffffff` text/action), using the two explicit roots `.xiaoce-chat-shell[data-chat-theme="light"]` and `.xiaoce-chat-shell[data-chat-theme="dark"]`. Style the middle header/messages/composer/bubbles only; do not target sider, monitor, avatars, images, or `body`. Render the existing sun/moon control in the Xiaoce header only.

- [ ] **Step 6: Verify frontend and commit**

Run: `cd frontend && npm test && npm run build`

Expected: all tests PASS and Vite exits 0; existing chunk-size warning is acceptable.

```bash
git add frontend/src/pages/xiaoceChat.ts frontend/src/styles/xiaoceChatTheme.css frontend/src/api/client.ts frontend/src/components/ChatSkillPicker.tsx frontend/src/pages/CollabRisk.tsx frontend/tests/xiaoceChat.test.ts
git commit -m "feat: add xiaoce pause theme and skill feedback"
```

---

### Task 7: Focused verification and user preview

**Files:**
- Modify only when a failing regression test demonstrates a defect.

**Interfaces:**
- Verifies prior tasks; produces no new API.

- [ ] **Step 1: Run focused backend checks once**

Run: `backend/.venv/bin/python backend/manage.py test apps.collab.tests apps.core.tests apps.skills.tests -v 2`

Expected: all focused tests PASS.

Run: `backend/.venv/bin/python backend/manage.py check && backend/.venv/bin/python backend/manage.py makemigrations --check --dry-run`

Expected: no system issues and no missing migrations.

- [ ] **Step 2: Run frontend checks once**

Run: `cd frontend && npm test && npm run build`

Expected: all Node tests PASS and build exits 0.

- [ ] **Step 3: Browser acceptance at local `/collab`**

Verify exactly:

1. Ordinary colleague DM has no theme control and unchanged send behavior.
2. Xiaoce DM has white/black switch; only the middle panel changes; refresh remembers dark; logo/avatar stay original.
3. Slow Xiaoce answer shows the square stop button; refresh recovers it; stop creates one placeholder and no later answer.
4. A completed paused conversation can accept a new question.
5. “把这次对话打包成 Skill 并上传平台” creates one private, enabled Skill and refreshes the picker.
6. Repeating the command in the same room updates that Skill ID instead of creating another.
7. A packaging failure or pause creates no asset and shows no success tag.

- [ ] **Step 4: Review without pushing**

Run: `git status --short && git diff --check && git log --oneline --decorate -10`

Expected: clean worktree, no whitespace errors, local feature commits present. Leave the branch unpushed until the user approves the preview.
