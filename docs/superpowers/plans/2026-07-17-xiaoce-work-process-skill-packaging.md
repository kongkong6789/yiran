# Xiaoce Work Process and Conversation Skill Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, real-time, safe work-process summaries to Xiaoce conversations and make explicit conversation-to-Skill requests create a private, uploaded, enabled Skill.

**Architecture:** Selectively restore the previously tested Xiaoce run, cancellation, private asset, and conversation packaging code without restoring global theme changes. Extend the durable run with an allowlisted progress snapshot; backend stages report real lifecycle events through a callback, WebSocket publishes run snapshots, and final Xiaoce messages retain the same snapshot in `meta` for history rendering.

**Tech Stack:** Django 5, Django REST Framework, PostgreSQL/SQLite-compatible ORM, React 18, TypeScript, Ant Design, Axios, Node test runner.

## Global Constraints

- The feature applies only to Xiaoce direct messages in the first release.
- Progress is emitted by real backend stages; the frontend must not simulate stages with timers.
- Public progress never contains prompts, chain of thought, raw conversation text, SQL, tool arguments/results, secrets, paths, or stack traces.
- Completed answers collapse to `查看处理过程（N步）`; completed, cancelled, and failed snapshots survive refresh.
- Conversation-generated Skills are private and enabled for the current user; they are never auto-published to the shared repository.
- A generated ZIP contains exactly `SKILL.md` and `references/workflow-summary.md`.
- Existing global theme and monitor-board code on `main` must not be changed.
- Use test-first development for every production change.

---

## File Structure

- `backend/apps/skills/models.py`: add private/shared visibility to Skill assets.
- `backend/apps/skills/repository.py`: enforce visibility in list, lookup, materialization, and save paths.
- `backend/apps/skills/migrations/0004_skillasset_visibility.py`: migrate existing assets to shared visibility.
- `backend/apps/skills/tests/test_private_assets.py`: prove private asset isolation.
- `backend/apps/core/cancellation.py`: shared cooperative cancellation exception and guard.
- `backend/apps/core/progress.py`: framework-neutral progress callback type and safe emitter.
- `backend/apps/core/conversation_skill.py`: sanitize and package a CollabRoom conversation.
- `backend/apps/core/agent_chat.py`: emit real stage boundaries and honor cancellation.
- `backend/apps/core/tests/test_agent_cancellation.py`: cancellation regression tests.
- `backend/apps/core/tests/test_conversation_skill.py`: packaging, intent, sanitization, and structure tests.
- `backend/apps/collab/models.py`: add message metadata and durable Xiaoce run state/progress.
- `backend/apps/collab/migrations/0013_xiaoce_run_and_message_meta.py`: create the run and metadata schema.
- `backend/apps/collab/xiaoce_progress.py`: allowlisted progress state transitions and realtime publication.
- `backend/apps/collab/xiaoce_runs.py`: create, cancel, complete, fail, and atomically persist Skills.
- `backend/apps/collab/views.py`: wire run lifecycle into Xiaoce send/worker/detail/cancel endpoints.
- `backend/apps/collab/urls.py`: expose the cancel endpoint.
- `backend/apps/collab/realtime.py`: include Xiaoce run snapshots in realtime events.
- `backend/apps/collab/tests/test_xiaoce_progress.py`: progress lifecycle and redaction tests.
- `backend/apps/collab/tests/test_xiaoce_runs.py`: run state transition and race tests.
- `backend/apps/collab/tests/test_xiaoce_api.py`: API, refresh recovery, private upload, and failure tests.
- `backend/apps/council/llm.py`: check cancellation between streamed response chunks.
- `backend/apps/mcp/client.py`: honor cooperative cancellation around MCP requests.
- `backend/apps/skills/runner.py`: terminate Skill subprocesses on cancellation and report real tool counts.
- `frontend/src/api/client.ts`: Xiaoce run/progress types and send/cancel API fields.
- `frontend/src/pages/xiaoceChat.ts`: Xiaoce room/run helpers and immutable snapshot merge.
- `frontend/src/components/XiaoceProcess.tsx`: render live and historical process summaries.
- `frontend/src/pages/CollabRisk.tsx`: connect active runs, pause, final metadata, and Skill refresh.
- `frontend/src/index.css`: add process-card styles using existing global color tokens only.
- `frontend/tests/xiaoceChat.test.ts`: helper and source-level wiring regressions.

---

### Task 1: Private Skill Asset Isolation

**Files:**
- Modify: `backend/apps/skills/models.py`
- Modify: `backend/apps/skills/repository.py`
- Modify: `backend/apps/skills/views.py`
- Create: `backend/apps/skills/migrations/0004_skillasset_visibility.py`
- Create: `backend/apps/skills/tests/__init__.py`
- Create: `backend/apps/skills/tests/test_private_assets.py`

**Interfaces:**
- Produces: `SkillAsset.Visibility.PRIVATE`, `SkillAsset.Visibility.SHARED`.
- Produces: `save_skill_asset_from_bytes(user, filename: str, data: bytes, *, adopt: bool = False, visibility: str = SkillAsset.Visibility.SHARED, skill_id_override: str | None = None)`.
- Produces: `list_skill_assets(user=None, *, shared=True)` that never leaks private assets.
- Consumes: existing parser, COS, and local workspace storage behavior.

- [ ] **Step 1: Write failing visibility tests**

```python
class PrivateSkillAssetTests(TestCase):
    def test_private_asset_is_visible_only_to_owner(self):
        private, _ = save_skill_asset_from_bytes(
            self.owner, "private.md", VALID_SKILL,
            visibility=SkillAsset.Visibility.PRIVATE,
        )
        self.assertNotIn(private, list_skill_assets(shared=True))
        self.assertIn(private, list_skill_assets(self.owner, shared=False))
        self.assertNotIn(private, list_skill_assets(self.other, shared=False))

    def test_shared_sync_ignores_private_assets(self):
        private, _ = save_skill_asset_from_bytes(
            self.owner, "private.md", VALID_SKILL,
            visibility=SkillAsset.Visibility.PRIVATE,
        )
        ensure_shared_skills_for_user(self.other)
        self.assertFalse(UserSkill.objects.filter(user=self.other, source_asset=private).exists())
```

- [ ] **Step 2: Run tests and confirm the missing visibility API fails**

Run: `cd backend && python manage.py test apps.skills.tests.test_private_assets -v 2`

Expected: FAIL because `SkillAsset.Visibility` and the `visibility` keyword do not exist.

- [ ] **Step 3: Implement visibility and stable-ID override**

Add a `visibility` field whose default is `shared`; filter shared reads with `visibility=shared`, filter personal reads by `uploader=user`, and use `skill_id_override or parsed["skill_id"]` when saving. Include visibility in asset API payloads.

```python
class Visibility(models.TextChoices):
    PRIVATE = "private", "仅上传者"
    SHARED = "shared", "团队共享"

visibility = models.CharField(
    "可见性", max_length=16, choices=Visibility.choices,
    default=Visibility.SHARED, db_index=True,
)
```

- [ ] **Step 4: Run tests and migration consistency checks**

Run: `cd backend && python manage.py test apps.skills.tests.test_private_assets -v 2 && python manage.py makemigrations --check --dry-run`

Expected: PASS and `No changes detected`.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/skills
git commit -m "feat: support private skill assets"
```

---

### Task 2: Durable Xiaoce Runs and Safe Progress State

**Files:**
- Modify: `backend/apps/collab/models.py`
- Create: `backend/apps/collab/migrations/0013_xiaoce_run_and_message_meta.py`
- Create: `backend/apps/collab/xiaoce_progress.py`
- Create: `backend/apps/collab/tests/__init__.py`
- Create: `backend/apps/collab/tests/test_xiaoce_progress.py`

**Interfaces:**
- Produces: `XiaoceRun` with `status`, `current_stage`, `progress_steps`, `error_code`, `error`, and terminal message relations.
- Produces: `XiaoceProgressReporter(run_id).start(code)`, `.complete(code, tool_count=0)`, `.fail(code, error_code="stage_failed")`, `.cancel_current()`.
- Produces: `xiaoce_run_payload(run)` with only safe public fields.

- [ ] **Step 1: Write failing progress lifecycle tests**

```python
class XiaoceProgressTests(TestCase):
    @patch("apps.collab.xiaoce_progress.ws_push.publish_sync")
    def test_progress_updates_one_allowlisted_step_and_publishes_snapshot(self, publish):
        reporter = XiaoceProgressReporter(self.run.id)
        reporter.start("understanding")
        reporter.complete("understanding")
        reporter.complete("tools", tool_count=2)
        self.run.refresh_from_db()
        self.assertEqual([s["code"] for s in self.run.progress_steps], ["understanding", "tools"])
        self.assertEqual(self.run.progress_steps[0]["status"], "completed")
        self.assertEqual(self.run.progress_steps[1]["label"], "已运行 2 个工具")
        publish.assert_called()

    def test_progress_rejects_unknown_stage_and_ignores_raw_detail(self):
        reporter = XiaoceProgressReporter(self.run.id)
        with self.assertRaises(ValueError):
            reporter.start("print-secret", detail="sk-secret-value")
        self.assertEqual(XiaoceRun.objects.get(id=self.run.id).progress_steps, [])
```

- [ ] **Step 2: Run tests and confirm run/progress symbols are missing**

Run: `cd backend && python manage.py test apps.collab.tests.test_xiaoce_progress -v 2`

Expected: FAIL because `XiaoceRun` and `XiaoceProgressReporter` do not exist.

- [ ] **Step 3: Add the run schema and message metadata**

Add `CollabMessage.meta = models.JSONField(default=dict, blank=True)`, the `xiaoce` AI kind, the run model and its partial unique constraint. Store progress as a JSON list with default `list`; keep public errors separate from server logs.

- [ ] **Step 4: Implement the allowlisted reporter**

Use a constant mapping from code/status to label. Mutate a step only by matching `code`; generate timestamps server-side; ignore caller-provided display strings. Publish after transaction commit.

```python
STAGES = {
    "understanding": ("正在理解你的问题…", "已理解你的问题"),
    "knowledge_search": ("正在检索知识库与 PostgreSQL 数据…", "已检索知识库与 PostgreSQL 数据"),
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
```

- [ ] **Step 5: Run progress tests and schema checks**

Run: `cd backend && python manage.py test apps.collab.tests.test_xiaoce_progress -v 2 && python manage.py makemigrations --check --dry-run`

Expected: PASS and `No changes detected`.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/collab/models.py backend/apps/collab/migrations/0013_xiaoce_run_and_message_meta.py backend/apps/collab/xiaoce_progress.py backend/apps/collab/tests
git commit -m "feat: persist safe xiaoce progress"
```

---

### Task 3: Cooperative Cancellation and Conversation Skill Preparation

**Files:**
- Create: `backend/apps/core/cancellation.py`
- Create: `backend/apps/core/conversation_skill.py`
- Create: `backend/apps/core/tests/__init__.py`
- Create: `backend/apps/core/tests/test_agent_cancellation.py`
- Create: `backend/apps/core/tests/test_conversation_skill.py`

**Interfaces:**
- Produces: `AgentRunCancelled`, `raise_if_cancelled(cancel_check)`.
- Produces: `is_conversation_skill_request(text: str) -> bool`.
- Produces: `prepare_conversation_skill(user, room, *, exclude_message_id=None, cancel_check=None, progress_callback=None) -> PreparedConversationSkill`.

- [ ] **Step 1: Write failing intent, sanitization, and package tests**

```python
def test_packaging_redacts_secrets_and_contains_only_safe_files(self):
    self.add_exchange("Use api_key=sk-1234567890abcdef", "Completed")
    prepared = prepare_conversation_skill(self.user, self.room)
    with zipfile.ZipFile(io.BytesIO(prepared.package_data)) as archive:
        self.assertEqual(sorted(archive.namelist()), ["SKILL.md", "references/workflow-summary.md"])
        combined = b"".join(archive.read(name) for name in archive.namelist())
    self.assertNotIn(b"sk-1234567890abcdef", combined)

def test_plain_skill_question_does_not_trigger_packaging(self):
    self.assertFalse(is_conversation_skill_request("Skill 是什么？"))
    self.assertTrue(is_conversation_skill_request("把当前聊天记录打包成 skill 并上传平台"))
```

- [ ] **Step 2: Run tests and confirm the preparation module is missing**

Run: `cd backend && python manage.py test apps.core.tests.test_conversation_skill apps.core.tests.test_agent_cancellation -v 2`

Expected: FAIL with import errors for the new modules.

- [ ] **Step 3: Implement cancellation and conversation packaging**

Restore the validated conversation filters, secret patterns, 48,000-character bound, strict JSON parser, required sections, stable room-derived ID, and exact two-file ZIP. Emit only allowlisted stage codes through `progress_callback` before/after history read, redaction, summary, and package validation.

- [ ] **Step 4: Run preparation tests**

Run: `cd backend && python manage.py test apps.core.tests.test_conversation_skill apps.core.tests.test_agent_cancellation -v 2`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/cancellation.py backend/apps/core/conversation_skill.py backend/apps/core/tests
git commit -m "feat: prepare skills from xiaoce conversations"
```

---

### Task 4: Xiaoce Run Completion, Pause, Failure, and Atomic Skill Save

**Files:**
- Create: `backend/apps/collab/xiaoce_runs.py`
- Create: `backend/apps/collab/tests/test_xiaoce_runs.py`
- Modify: `backend/apps/collab/tests/test_xiaoce_progress.py`

**Interfaces:**
- Produces: `create_xiaoce_run`, `is_xiaoce_run_cancelled`, `cancel_xiaoce_run`, `complete_xiaoce_run`, `complete_xiaoce_run_with_skill`, `fail_xiaoce_run`.
- Consumes: `PreparedConversationSkill`, private asset save API, progress reporter.

- [ ] **Step 1: Write failing terminal-state tests**

```python
def test_cancel_keeps_progress_and_complete_cannot_overwrite_it(self):
    XiaoceProgressReporter(self.run.id).start("knowledge_search")
    cancelled = cancel_xiaoce_run(self.run)
    self.assertEqual(cancelled.progress_steps[-1]["status"], "cancelled")
    self.assertIsNone(complete_xiaoce_run(self.run.id, "late answer"))
    self.assertFalse(CollabMessage.objects.filter(content="late answer").exists())

def test_failure_persists_safe_message_and_snapshot(self):
    XiaoceProgressReporter(self.run.id).start("skill_summary")
    message = fail_xiaoce_run(self.run.id, "package_invalid")
    self.assertEqual(message.meta["process_status"], "failed")
    self.assertNotIn("Traceback", message.content)
```

- [ ] **Step 2: Run tests and confirm lifecycle functions are missing**

Run: `cd backend && python manage.py test apps.collab.tests.test_xiaoce_runs -v 2`

Expected: FAIL with import errors.

- [ ] **Step 3: Implement row-locked terminal transitions**

Create every terminal message and update the run inside one transaction. Copy `progress_steps` to `message.meta["process_steps"]`; use `transaction.on_commit` for realtime publication. For Skill completion, lock the running row before calling `save_skill_asset_from_bytes(locked.user, prepared.filename, prepared.package_data, adopt=True, visibility=SkillAsset.Visibility.PRIVATE, skill_id_override=prepared.skill_id)`.

- [ ] **Step 4: Run lifecycle tests**

Run: `cd backend && python manage.py test apps.collab.tests.test_xiaoce_runs apps.collab.tests.test_xiaoce_progress -v 2`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/collab/xiaoce_runs.py backend/apps/collab/tests
git commit -m "feat: complete and cancel xiaoce runs safely"
```

---

### Task 5: Instrument Real Agent Stages and Long-Running Tools

**Files:**
- Create: `backend/apps/core/progress.py`
- Modify: `backend/apps/core/agent_chat.py`
- Modify: `backend/apps/council/llm.py`
- Modify: `backend/apps/mcp/client.py`
- Modify: `backend/apps/skills/runner.py`
- Modify: `backend/apps/core/tests/test_agent_cancellation.py`

**Interfaces:**
- Produces: `emit_progress(callback, code, status, **data)`.
- Extends: `run_chat(message: str, history: list[dict] | None = None, user=None, skill_ids: list[str] | None = None, attachments: list[dict] | None = None, model: str | None = None, cancel_check=None, progress_callback=None) -> dict`.
- Extends long-running helpers with optional `cancel_check` without breaking existing callers.

- [ ] **Step 1: Write failing callback and cancellation tests**

```python
def test_run_chat_emits_only_stages_that_execute(self):
    events = []
    result = run_chat("hello", user=self.user, progress_callback=lambda *event: events.append(event))
    self.assertTrue(result["ok"])
    self.assertEqual(events[0][:2], ("understanding", "running"))
    self.assertIn(("composing", "completed", {}), events)
    self.assertNotIn("skill", [event[0] for event in events])

def test_streaming_llm_closes_when_cancelled(self):
    with self.assertRaises(AgentRunCancelled):
        chat_messages_result(
            "system",
            [{"role": "user", "content": "hello"}],
            api_key="test-key",
            base_url="https://example.invalid/v1",
            cancel_check=lambda: True,
        )
```

- [ ] **Step 2: Run tests and confirm callback signatures fail**

Run: `cd backend && python manage.py test apps.core.tests.test_agent_cancellation -v 2`

Expected: FAIL because progress and cancellation parameters are not accepted.

- [ ] **Step 3: Thread optional callbacks through real boundaries**

Emit `understanding` around input setup, `knowledge_search` only around actual RAG/data access, `skill` only when Skills resolve, `tools` with the actual successful/attempted script and MCP count, `validation` when structured business evidence is checked, and `composing` around the final LLM response. Check cancellation before and after network calls and between streamed chunks; terminate Skill subprocesses cooperatively.

- [ ] **Step 4: Run focused tests**

Run: `cd backend && python manage.py test apps.core.tests.test_agent_cancellation apps.orchestration.tests -v 2`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/progress.py backend/apps/core/agent_chat.py backend/apps/council/llm.py backend/apps/mcp/client.py backend/apps/skills/runner.py backend/apps/core/tests/test_agent_cancellation.py
git commit -m "feat: report real agent work stages"
```

---

### Task 6: Xiaoce APIs and Realtime Recovery

**Files:**
- Modify: `backend/apps/collab/realtime.py`
- Modify: `backend/apps/collab/views.py`
- Modify: `backend/apps/collab/urls.py`
- Create: `backend/apps/collab/tests/test_xiaoce_api.py`

**Interfaces:**
- POST message accepts `run_id` for Xiaoce DMs and returns `xiaoce_run`.
- GET room detail returns `active_xiaoce_run` for the current user.
- POST `/api/collab/rooms/<room_id>/xiaoce-runs/<run_id>/cancel/` returns the terminal snapshot/message.
- Realtime payload accepts `xiaoce_runs=[xiaoce_run_payload(run)]`.

- [ ] **Step 1: Write failing API and refresh tests**

```python
@patch("apps.collab.views.threading.Thread")
def test_send_returns_progress_run_and_room_detail_recovers_it(self, thread_cls):
    run_id = uuid.uuid4()
    response = self.client.post(self.messages_url, {"content": "分析", "run_id": str(run_id)})
    self.assertEqual(response.status_code, 201)
    self.assertEqual(response.data["xiaoce_run"]["id"], str(run_id))
    detail = self.client.get(self.room_url)
    self.assertEqual(detail.data["active_xiaoce_run"]["id"], str(run_id))
```

- [ ] **Step 2: Run API tests and confirm endpoints/payloads fail**

Run: `cd backend && python manage.py test apps.collab.tests.test_xiaoce_api -v 2`

Expected: FAIL because the run response and cancel route do not exist.

- [ ] **Step 3: Wire the worker and endpoints**

Create the user message and `XiaoceRun` atomically before starting the background thread. In the worker, choose normal chat or conversation packaging, pass both cancellation and progress callbacks, then invoke exactly one row-locked terminal transition. Return a 409 before creating a second user message when a run is active.

- [ ] **Step 4: Run Xiaoce API and collaboration regressions**

Run: `cd backend && python manage.py test apps.collab.tests.test_xiaoce_api apps.collab.tests.test_xiaoce_runs apps.collab.tests.test_xiaoce_progress -v 2`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/collab/realtime.py backend/apps/collab/views.py backend/apps/collab/urls.py backend/apps/collab/tests/test_xiaoce_api.py
git commit -m "feat: wire xiaoce runs into collaboration chat"
```

---

### Task 7: Frontend Types, Helpers, and Process Component

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/pages/xiaoceChat.ts`
- Create: `frontend/src/components/XiaoceProcess.tsx`
- Create: `frontend/tests/xiaoceChat.test.ts`

**Interfaces:**
- Produces: `XiaoceProgressStep`, `XiaoceRun`, `CreatedSkillItem` types.
- Produces: `isXiaoceRoom`, `createXiaoceRunId`, `mergeXiaoceRunSnapshot`.
- Produces: `<XiaoceProcess steps status live defaultExpanded />`.

- [ ] **Step 1: Write failing helper and rendering-contract tests**

```typescript
test("newer Xiaoce snapshots replace older state by run id", () => {
  const running = { id: "r1", status: "running", progress_steps: [{ code: "understanding", status: "running" }] };
  const complete = { id: "r1", status: "completed", progress_steps: [{ code: "understanding", status: "completed" }] };
  assert.deepEqual(mergeXiaoceRunSnapshot(running, complete), complete);
});

test("process component contains the collapsed Chinese summary", () => {
  const source = readFileSync(new URL("../src/components/XiaoceProcess.tsx", import.meta.url), "utf8");
  assert.match(source, /查看处理过程（\{steps\.length\}步）/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});
```

- [ ] **Step 2: Run tests and confirm missing helpers/component fail**

Run: `cd frontend && npm test -- --test-name-pattern="Xiaoce|process"`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Add typed API fields and deterministic rendering**

Extend Collab messages with `meta`, send Xiaoce `run_id`, add cancel API, and render status icons from server snapshots. The component starts expanded only when `live`; terminal snapshots start collapsed and use an accessible button with `aria-expanded`.

- [ ] **Step 4: Run frontend tests and type build**

Run: `cd frontend && npm test && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/pages/xiaoceChat.ts frontend/src/components/XiaoceProcess.tsx frontend/tests/xiaoceChat.test.ts
git commit -m "feat: render xiaoce process snapshots"
```

---

### Task 8: Xiaoce Composer, Pause, History, and Skill Refresh UI

**Files:**
- Modify: `frontend/src/pages/CollabRisk.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/tests/xiaoceChat.test.ts`

**Interfaces:**
- Consumes: Xiaoce run API, helpers, and process component from Task 7.
- Produces: live synthetic process row, historical message process block, pause button, and Skill picker refresh.

- [ ] **Step 1: Write failing source-contract tests**

```typescript
test("Collab chat wires live progress, pause, history, and Skill refresh", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.match(source, /activeXiaoceRun/);
  assert.match(source, /cancelXiaoceRun/);
  assert.match(source, /<XiaoceProcess/);
  assert.match(source, /meta\?\.process_steps/);
  assert.match(source, /meta\?\.created_skill/);
  assert.match(source, /setSkillRefreshKey/);
});
```

- [ ] **Step 2: Run the source-contract test and confirm wiring is absent**

Run: `cd frontend && npm test -- --test-name-pattern="Collab chat wires"`

Expected: FAIL because the active run and process component are not wired.

- [ ] **Step 3: Wire state and interactions**

Generate `run_id` only for Xiaoce DMs, store the response/realtime snapshot, clear the live card on terminal state, and render final metadata under the associated Xiaoce message. Replace the send button with a square pause button only while a Xiaoce run is active; prevent duplicate cancellation while the request is pending. Increment `skillRefreshKey` when a new message contains `created_skill`.

- [ ] **Step 4: Add token-based process styles**

Use existing `--lc-*` variables for surface, ink, muted text, border, and focus states. Preserve avatar and semantic status colors. Do not add theme state or modify global theme providers.

- [ ] **Step 5: Run frontend tests and build**

Run: `cd frontend && npm test && npm run build`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CollabRisk.tsx frontend/src/index.css frontend/tests/xiaoceChat.test.ts
git commit -m "feat: show and pause xiaoce work process"
```

---

### Task 9: Full Verification and Migration Audit

**Files:**
- Modify only files required by failures found during this task.

**Interfaces:**
- Verifies every public interface and constraint from the design.

- [ ] **Step 1: Run focused backend suite**

Run: `cd backend && python manage.py test apps.skills.tests.test_private_assets apps.core.tests.test_agent_cancellation apps.core.tests.test_conversation_skill apps.collab.tests.test_xiaoce_progress apps.collab.tests.test_xiaoce_runs apps.collab.tests.test_xiaoce_api -v 2`

Expected: PASS.

- [ ] **Step 2: Run Django system and migration checks**

Run: `cd backend && python manage.py check && python manage.py makemigrations --check --dry-run`

Expected: `System check identified no issues` and `No changes detected`.

- [ ] **Step 3: Run frontend suite and production build**

Run: `cd frontend && npm test && npm run build`

Expected: PASS and a successful Vite production build.

- [ ] **Step 4: Review scope and diff hygiene**

Run: `git diff --check && git status --short && git diff --stat eee1cad..HEAD`

Expected: no whitespace errors; only Xiaoce run/progress, private Skill, packaging, focused UI, tests, migration, and plan files are changed.

- [ ] **Step 5: Commit verification fixes if any**

```bash
git add backend/apps/skills backend/apps/core backend/apps/collab backend/apps/council/llm.py backend/apps/mcp/client.py frontend/src frontend/tests
git commit -m "fix: close xiaoce process verification gaps"
```

Skip this commit when Step 1 through Step 4 pass without additional changes.
