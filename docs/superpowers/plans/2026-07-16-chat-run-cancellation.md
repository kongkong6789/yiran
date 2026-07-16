# Chat Run Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, idempotent pause action for an in-flight Agent Chat request while preserving the user message and preventing a completed assistant reply from being stored after cancellation.

**Architecture:** The browser generates a UUID `run_id` for each send. Django persists a `ChatRun`, exposes an owner-scoped cancel endpoint, and passes a database-backed cancellation callback through Skill scripts, MCP, and the upstream LLM stream. The existing synchronous chat response remains in place; only the in-flight work becomes cooperatively cancellable.

**Tech Stack:** Django 5, Django REST Framework, SQLite/Postgres-compatible ORM, Python `urllib` and `subprocess`, React 18, TypeScript, Axios, Ant Design, Vitest.

## Global Constraints

- Pausing must be backend-observable cancellation, not only a hidden loading state.
- Preserve the user message and store exactly one assistant placeholder with content `已暂停本次生成。`.
- Never store partial LLM text.
- Repeated cancel requests are idempotent; a completed run returns HTTP 409.
- An already-sent third-party MCP request cannot be retracted, but its result must be abandoned and no later work may start.
- Do not add Celery, Redis, or another runtime service.

---

### Task 1: Persist chat runs and expose idempotent cancellation

**Files:**
- Modify: `backend/apps/core/models.py`
- Create: `backend/apps/core/migrations/0005_chat_run.py`
- Create: `backend/apps/core/chat_runs.py`
- Modify: `backend/apps/core/views.py`
- Modify: `backend/apps/core/urls.py`
- Create: `backend/apps/core/tests/__init__.py`
- Create: `backend/apps/core/tests/test_chat_runs.py`

**Interfaces:**
- Produces: `ChatRun`, `ChatRunCancelled`, `is_run_cancelled(run_id) -> bool`, `cancel_run(run, *, save_message=True) -> ChatRun`, and `POST /api/agent/runs/<uuid>/cancel/`.
- Consumes: existing `ChatSession`, `ChatMessage`, and authenticated DRF token requests.

- [ ] **Step 1: Write failing model and API tests**

```python
# backend/apps/core/tests/test_chat_runs.py
import uuid
from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase
from apps.core.models import ChatMessage, ChatRun, ChatSession


class ChatRunCancelTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner", password="pw")
        self.other = User.objects.create_user("other", password="pw")
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=self.user).key}")
        self.session = ChatSession.objects.create(user=self.user, title="测试")
        self.run = ChatRun.objects.create(id=uuid.uuid4(), user=self.user, session=self.session)

    def test_cancel_is_idempotent_and_creates_one_placeholder(self):
        url = reverse("agent-chat-run-cancel", args=[self.run.id])
        self.assertEqual(self.client.post(url).status_code, 200)
        self.assertEqual(self.client.post(url).status_code, 200)
        self.run.refresh_from_db()
        self.assertEqual(self.run.status, ChatRun.Status.CANCELLED)
        self.assertEqual(
            ChatMessage.objects.filter(session=self.session, meta__run_id=str(self.run.id), meta__cancelled=True).count(),
            1,
        )

    def test_other_user_receives_not_found(self):
        token = Token.objects.create(user=self.other)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(reverse("agent-chat-run-cancel", args=[self.run.id]) and self.client.post(
            reverse("agent-chat-run-cancel", args=[self.run.id])
        ).status_code, 404)

    def test_completed_run_cannot_be_cancelled(self):
        self.run.status = ChatRun.Status.COMPLETED
        self.run.save(update_fields=["status"])
        self.assertEqual(self.client.post(reverse("agent-chat-run-cancel", args=[self.run.id])).status_code, 409)
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_chat_runs -v 2`

Expected: import failure because `ChatRun` does not exist.

- [ ] **Step 3: Implement the model, migration, service, endpoint, and URL**

```python
# backend/apps/core/models.py
class ChatRun(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "运行中"
        CANCELLED = "cancelled", "已暂停"
        COMPLETED = "completed", "已完成"
        FAILED = "failed", "失败"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("auth.User", related_name="chat_runs", on_delete=models.CASCADE)
    session = models.ForeignKey(ChatSession, related_name="runs", on_delete=models.CASCADE)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING)
    cancel_message = models.OneToOneField(
        ChatMessage, null=True, blank=True, on_delete=models.SET_NULL, related_name="cancelled_run"
    )
    error = models.TextField(blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

```python
# backend/apps/core/chat_runs.py
from django.db import transaction
from django.utils import timezone
from .models import ChatMessage, ChatRun

PAUSED_REPLY = "已暂停本次生成。"


class ChatRunCancelled(RuntimeError):
    pass


def is_run_cancelled(run_id) -> bool:
    return ChatRun.objects.filter(id=run_id, status=ChatRun.Status.CANCELLED).exists()


@transaction.atomic
def cancel_run(run: ChatRun, *, save_message: bool = True) -> ChatRun:
    run = ChatRun.objects.select_for_update().get(id=run.id)
    if run.status == ChatRun.Status.COMPLETED:
        raise ValueError("本轮回答已经完成，无法暂停")
    if run.status == ChatRun.Status.CANCELLED:
        return run
    run.status = ChatRun.Status.CANCELLED
    run.cancelled_at = timezone.now()
    if save_message and run.cancel_message_id is None:
        run.cancel_message = ChatMessage.objects.create(
            session=run.session,
            role="assistant",
            content=PAUSED_REPLY,
            meta={"run_id": str(run.id), "cancelled": True},
        )
    run.save(update_fields=["status", "cancelled_at", "cancel_message", "updated_at"])
    return run
```

Add `agent_chat_run_cancel` to `views.py`, look up with `ChatRun.objects.filter(id=run_id, user=request.user).first()`, return 404 for missing ownership, 409 for completed, and the payload `{"ok": True, "cancelled": True, "run_id": str(run.id), "conversation_id": str(run.session_id)}`. Register it as `path("agent/runs/<uuid:run_id>/cancel/", views.agent_chat_run_cancel, name="agent-chat-run-cancel")`.

- [ ] **Step 4: Generate/check the migration and run the tests**

Run: `cd backend && .venv/bin/python manage.py makemigrations --check --dry-run && .venv/bin/python manage.py test apps.core.tests.test_chat_runs -v 2`

Expected: `No changes detected`; three tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/apps/core
git commit -m "feat: add cancellable chat run records"
```

### Task 2: Make scripts, MCP, and LLM cooperatively cancellable

**Files:**
- Modify: `backend/apps/skills/runner.py`
- Modify: `backend/apps/mcp/client.py`
- Modify: `backend/apps/council/llm.py`
- Create: `backend/apps/core/tests/test_cancellable_services.py`

**Interfaces:**
- Consumes: `cancel_check: Callable[[], bool] | None` and `ChatRunCancelled` from Task 1.
- Produces: cancellable `run_shell_command`, `try_execute_skill_scripts`, `StreamableHttpClient`, `read_wecom_document`, and `llm.chat_messages_result` without changing behavior when `cancel_check` is omitted.

- [ ] **Step 1: Write failing cancellation tests**

```python
# backend/apps/core/tests/test_cancellable_services.py
import sys
import tempfile
from pathlib import Path
from django.test import SimpleTestCase
from apps.core.chat_runs import ChatRunCancelled
from apps.skills.runner import run_shell_command


class CancellableServiceTests(SimpleTestCase):
    def test_script_is_terminated_when_cancelled(self):
        checks = iter([False, True])
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ChatRunCancelled):
                run_shell_command(
                    Path(folder),
                    f'{sys.executable} -c "import time; time.sleep(30)"',
                    cancel_check=lambda: next(checks, True),
                    poll_interval=0.01,
                )
```

Add a mocked SSE response test for `chat_messages_result(..., cancel_check=...)` that yields one `data:` chunk, then reports cancellation, and asserts `ChatRunCancelled`. Add an MCP test that sets `cancel_check=lambda: True` and asserts no mocked `urlopen` call occurs.

- [ ] **Step 2: Run the focused test and confirm signature failures**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_cancellable_services -v 2`

Expected: failures because the three services do not accept `cancel_check`.

- [ ] **Step 3: Replace blocking script execution with a cancellable process loop**

```python
def run_shell_command(workspace, command, *, timeout=None, cancel_check=None, poll_interval=0.1):
    proc = subprocess.Popen(
        command,
        cwd=str(workspace),
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        start_new_session=True,
    )
    deadline = time.monotonic() + timeout
    while proc.poll() is None:
        if cancel_check and cancel_check():
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=2)
            raise ChatRunCancelled()
        if time.monotonic() >= deadline:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=2)
            return {"ok": False, "command": command, "stdout": "", "stderr": f"脚本超时(>{timeout}s)", "returncode": -1}
        time.sleep(poll_interval)
    stdout, stderr = proc.communicate()
```

Thread `cancel_check` through `try_execute_skill_scripts` to `run_shell_command`. Preserve the existing JSON-output collection and output truncation.

- [ ] **Step 4: Add MCP checkpoints and cancellable LLM streaming**

Add `_raise_if_cancelled(cancel_check)` to both modules. `StreamableHttpClient.__init__` accepts `cancel_check`; `_post` checks before `urlopen` and after each response read; `_read_smartsheet` checks before each sheet request. `read_wecom_document(..., cancel_check=None)` creates the client with that callback.

For `llm.chat_messages_result`, add `cancel_check=None`. When present, call `_chat_completions_stream_once` with `"stream": True`, parse `data: {json}` lines, append `choices[0].delta.content`, stop on `[DONE]`, and raise `ChatRunCancelled` as soon as the callback returns true. Keep `_chat_completions_once` unchanged for callers without cancellation.

- [ ] **Step 5: Run service tests and existing Django tests**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_cancellable_services -v 2 && .venv/bin/python manage.py test -v 1`

Expected: cancellation tests pass; full Django suite passes.

- [ ] **Step 6: Commit Task 2**

```bash
git add backend/apps/skills/runner.py backend/apps/mcp/client.py backend/apps/council/llm.py backend/apps/core/tests/test_cancellable_services.py
git commit -m "feat: stop chat dependencies cooperatively"
```

### Task 3: Connect ChatRun lifecycle to the existing chat endpoint

**Files:**
- Modify: `backend/apps/core/agent_chat.py`
- Modify: `backend/apps/core/views.py`
- Create: `backend/apps/core/tests/test_agent_chat_cancellation.py`

**Interfaces:**
- Consumes: Task 1 `ChatRun` and Task 2 cancellable service signatures.
- Produces: `run_chat(..., cancel_check=None)` and `/api/agent/chat/` support for required `run_id`.

- [ ] **Step 1: Write lifecycle tests**

Mock `run_chat` to call the provided `cancel_check`; assert a cancelled run returns `{ok: false, cancelled: true}`, keeps one user message, keeps one pause placeholder, and stores no normal assistant response. Add success and exception tests asserting `completed` and `failed` statuses respectively.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_agent_chat_cancellation -v 2`

Expected: the endpoint ignores `run_id` and does not create a `ChatRun`.

- [ ] **Step 3: Implement endpoint lifecycle and cancellation checkpoints**

Parse `run_id` with `uuid.UUID`; reject missing/invalid IDs with 400. After the session and user message exist, create `ChatRun(id=run_id, user=request.user, session=session)`. Pass `cancel_check=lambda: is_run_cancelled(run.id)` to `run_chat`. Catch `ChatRunCancelled` and return status 200 with `ok=False`, `cancelled=True`, and identifiers. Before saving a normal assistant response, check cancellation once more. Mark successful runs completed and exceptions failed with timestamps.

Thread `cancel_check` through `run_chat` and call it before and after Skill resolution/execution, knowledge/graph gathering, MCP, image work, and LLM. Pass it to `try_execute_skill_scripts`, `read_wecom_document`, and `chat_messages_result`.

- [ ] **Step 4: Run lifecycle and full backend tests**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_agent_chat_cancellation -v 2 && .venv/bin/python manage.py test -v 1`

Expected: lifecycle tests and all backend tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add backend/apps/core
git commit -m "feat: wire cancellation into agent chat"
```

### Task 4: Add the pause control to the React conversation page

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/AgentChat.tsx`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/pages/AgentChat.test.tsx`
- Create: `frontend/src/test/setup.ts`

**Interfaces:**
- Consumes: `POST /agent/chat/` with `run_id` and `POST /agent/runs/{run_id}/cancel/`.
- Produces: `cancelAgentChatRun(runId)` and a send/stop button state machine with `idle | running | cancelling`.

- [ ] **Step 1: Install and configure the frontend test runner**

Add scripts `"test": "vitest run"` and dev dependencies `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom`. Configure `test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] }` in Vite.

- [ ] **Step 2: Write failing UI tests**

Mock the API module. Render `AgentChat`, send text, assert `agentChat` receives a UUID `run_id`, and assert the send button changes from `aria-label="发送"` to `aria-label="暂停生成"`. Click it twice and assert `cancelAgentChatRun` is called once. Resolve with `{ok:false,cancelled:true}` and assert `已暂停本次生成。` is shown with no extra assistant result.

- [ ] **Step 3: Run the UI test and confirm it fails**

Run: `cd frontend && npm test -- AgentChat.test.tsx`

Expected: missing cancel API and missing pause button assertions fail.

- [ ] **Step 4: Implement the API and state machine**

Extend `AgentChatResult` with `cancelled?: boolean` and `run_id?: string`. Extend `agentChat` body and multipart form with `run_id`. Add:

```ts
export const cancelAgentChatRun = (runId: string) =>
  api.post<{ ok: boolean; cancelled: boolean; run_id: string; conversation_id: string }>(
    `/agent/runs/${runId}/cancel/`,
  ).then((r) => r.data);
```

In `AgentChat`, replace `loading` as the sole control with `runState` and `activeRunIdRef`. `send` creates `crypto.randomUUID()`, stores it before awaiting, and passes it to `agentChat`. `pause` sets `cancelling`, awaits the cancel endpoint, inserts or reloads the unique pause placeholder, then returns to idle. While running, render a square `StopOutlined` icon inside the existing round button. Do not use Axios abort as the source of truth.

- [ ] **Step 5: Run UI tests and build**

Run: `cd frontend && npm test && npm run build`

Expected: tests pass and Vite build exits 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add frontend
git commit -m "feat: add pause control to agent chat"
```

### Task 5: Verify the pause flow end to end

**Files:**
- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: Run migrations and all automated checks**

Run: `cd backend && .venv/bin/python manage.py migrate && .venv/bin/python manage.py check && .venv/bin/python manage.py test -v 1`

Run: `cd frontend && npm test && npm run build`

Expected: all commands exit 0.

- [ ] **Step 2: Browser-check the running application**

Start Django and Vite, open `/agent`, send a prompt that takes several seconds, click the stop button, and verify: the button changes immediately, exactly one pause message appears, the user message survives refresh, no later assistant answer appears, and a new message can be sent normally.

- [ ] **Step 3: Commit verification fixes if required**

```bash
git add backend frontend
git commit -m "fix: harden chat pause flow"
```
