# Conversation Skill Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an explicit natural-language request in an existing chat into a validated, private, automatically enabled Skill package without asking the user to download or upload files manually.

**Architecture:** A focused conversation-skill service recognizes packaging intent, reads and sanitizes the complete database-backed session, requests strict structured content from the user's LLM, builds a valid in-memory zip, and stores it through the existing Skill repository. `SkillAsset.visibility` separates private generated assets from the existing shared team repository.

**Tech Stack:** Django 5, Django REST Framework, Python `zipfile`, existing OpenAI-compatible LLM client, existing Skill parser/repository, React 18, TypeScript, Axios, Ant Design, Vitest.

## Global Constraints

- Generated assets default to `private` and are enabled only for the current user.
- Existing uploaded assets remain `shared` and retain current behavior.
- Read the complete current session, excluding the packaging command, pause placeholders, empty messages, and unrelated chatter.
- Never copy raw chat transcripts or credentials into the package.
- `SKILL.md` YAML frontmatter contains only `name` and `description`.
- Do not invent executable scripts; create only `SKILL.md` and `references/workflow-summary.md` unless a separately validated deterministic script already exists.
- Repeating the command in the same session updates the same stable Skill ID.
- A failed generation creates no visible partial asset and never tells the user to upload manually.

---

### Task 1: Add private Skill assets without changing shared behavior

**Files:**
- Modify: `backend/apps/skills/models.py`
- Create: `backend/apps/skills/migrations/0004_skillasset_visibility.py`
- Modify: `backend/apps/skills/repository.py`
- Modify: `backend/apps/skills/views.py`
- Create: `backend/apps/skills/tests/__init__.py`
- Create: `backend/apps/skills/tests/test_visibility.py`

**Interfaces:**
- Produces: `SkillAsset.Visibility`, `save_skill_asset_from_bytes(..., visibility="shared", skill_id_override=None)`, owner-filtered private storage, and shared-only repository queries.
- Consumes: existing upload/adopt/list endpoints and `UserSkill` materialization.

- [ ] **Step 1: Write failing privacy tests**

Create two users and one private asset for user A. Assert `list_skill_assets(shared=True)` excludes it, `ensure_shared_skills_for_user(user_b)` does not adopt it, and user B cannot delete or adopt it. Create a shared asset and assert existing list/adopt behavior still works.

- [ ] **Step 2: Run the focused tests and confirm failures**

Run: `cd backend && .venv/bin/python manage.py test apps.skills.tests.test_visibility -v 2`

Expected: `visibility` is not a model field and private filtering is unavailable.

- [ ] **Step 3: Add visibility and thread it through repository operations**

```python
class Visibility(models.TextChoices):
    PRIVATE = "private", "仅自己可见"
    SHARED = "shared", "团队共享"

visibility = models.CharField(
    "可见性", max_length=16, choices=Visibility.choices, default=Visibility.SHARED, db_index=True
)
```

The migration default is `shared`, preserving all existing rows. Change shared list/find/auto-adopt queries to filter `visibility=SkillAsset.Visibility.SHARED`. Add keyword-only arguments `visibility=SkillAsset.Visibility.SHARED` and `skill_id_override: str | None = None` to `save_skill_asset_from_bytes`; use `skill_id_override` after validating it with `slugify` and otherwise retain the parser-derived ID. Store visibility in both COS and local `update_or_create` branches. Include visibility in API payloads. Existing upload views pass `shared` explicitly and never pass an override.

- [ ] **Step 4: Run migrations checks and privacy tests**

Run: `cd backend && .venv/bin/python manage.py makemigrations --check --dry-run && .venv/bin/python manage.py test apps.skills.tests.test_visibility -v 2`

Expected: no missing migration; privacy and compatibility tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/apps/skills
git commit -m "feat: support private skill assets"
```

### Task 2: Build and validate a Skill package from a complete session

**Files:**
- Create: `backend/apps/core/conversation_skill.py`
- Create: `backend/apps/core/tests/test_conversation_skill.py`
- Modify: `backend/apps/skills/repository.py`

**Interfaces:**
- Produces: `is_conversation_skill_request(message: str) -> bool`, `sanitize_conversation(messages) -> list[dict]`, `build_conversation_skill(session, user, *, cancel_check=None) -> dict`, and `save_private_skill_package`.
- Consumes: `llm.chat_messages_result`, `extract_skill_from_upload`, and `save_skill_asset_from_bytes`.

- [ ] **Step 1: Write failing intent, sanitization, and package tests**

Test positive commands such as `把我们这次的对话和工作流程打包成一个skill并自动上传到平台` and negative messages such as `Skill 是什么` or `上传这个现有 zip`. Build a session containing `sk-secret`, `Bearer abc`, a pause placeholder, and a packaging command. Mock the LLM JSON result. Assert the zip contains exactly `SKILL.md` and `references/workflow-summary.md`, neither file contains secrets or raw transcript lines, frontmatter contains only `name` and `description`, and repeated generation returns the same `skill_id`.

- [ ] **Step 2: Run the focused tests and confirm the module is missing**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_conversation_skill -v 2`

Expected: import failure for `conversation_skill`.

- [ ] **Step 3: Implement deterministic intent and sanitization**

```python
def is_conversation_skill_request(message: str) -> bool:
    text = (message or "").lower()
    has_source = any(k in text for k in ("这次对话", "本次对话", "聊天记录", "会话", "工作流程"))
    has_skill = "skill" in text or "技能" in text
    has_action = any(k in text for k in ("打包", "生成", "提炼", "上传"))
    return has_source and has_skill and has_action
```

Sanitize credential patterns for `sk-...`, `Bearer ...`, `api[_ -]?key`, `token`, `cookie`, and password assignments. Exclude messages with `meta.cancelled`, the final packaging command, and empty content. Require at least one earlier user message and one assistant response.

- [ ] **Step 4: Implement structured generation, validation, zip creation, and private save**

Ask the LLM for a JSON object with `name`, `description`, `instructions`, and `workflow_summary`. Strip optional Markdown fences, parse JSON, enforce non-empty fields and required instruction sections (`目标`, `输入`, `步骤`, `输出`, `校验`, `失败处理`), and reject remaining credential patterns.

Derive a stable ID from the first retained user task plus `str(session.id)[:8]`; do not use the model name for identity. Render:

```markdown
---
name: <display name>
description: <trigger-rich description>
---

# 目标
...
```

Build a deflated in-memory zip with `SKILL.md` and `references/workflow-summary.md`, validate it with `extract_skill_from_upload`, then call `save_skill_asset_from_bytes(user, filename, data, adopt=True, visibility=SkillAsset.Visibility.PRIVATE, skill_id_override=stable_skill_id)`. Wrap database writes and materialization in `transaction.atomic`.

- [ ] **Step 5: Run package tests and the Skill parser tests**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_conversation_skill apps.skills.tests -v 2`

Expected: all intent, privacy, zip, and stable-ID tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add backend/apps/core/conversation_skill.py backend/apps/core/tests/test_conversation_skill.py backend/apps/skills/repository.py
git commit -m "feat: package conversations as private skills"
```

### Task 3: Route packaging commands through Agent Chat

**Files:**
- Modify: `backend/apps/core/views.py`
- Modify: `backend/apps/core/agent_chat.py`
- Create: `backend/apps/core/tests/test_conversation_skill_chat.py`

**Interfaces:**
- Consumes: Task 2 intent/build functions and the cancellation callback from the pause plan.
- Produces: `created_skill` in `AgentChatResult` and persisted success/failure assistant messages.

- [ ] **Step 1: Write failing endpoint tests**

Create a session with one complete user/assistant exchange. Mock `build_conversation_skill`. POST a packaging command and assert normal `run_chat` is not called, the complete session is passed to the builder, the response contains `created_skill.visibility == "private"`, and the success assistant message is saved. Mock a validation failure and assert no asset exists and the reply describes the exact failure without suggesting manual upload.

- [ ] **Step 2: Run the endpoint tests and confirm normal chat handles the command**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_conversation_skill_chat -v 2`

Expected: `run_chat` is called and `created_skill` is absent.

- [ ] **Step 3: Add the packaging branch after the user message is saved**

In `agent_chat`, after creating the `ChatRun` and saving the packaging user message, call `is_conversation_skill_request(message)`. When true, call `build_conversation_skill(session, request.user, cancel_check=...)`, construct a concise Markdown reply with name, `@skill-id`, private visibility, upload success, and enabled state, save it as the assistant message, mark the run completed, and return the standard chat payload plus `created_skill`. Catch `ConversationSkillError` and persist a retryable failure reply; do not fall through to normal LLM chat.

- [ ] **Step 4: Run endpoint and full backend tests**

Run: `cd backend && .venv/bin/python manage.py test apps.core.tests.test_conversation_skill_chat -v 2 && .venv/bin/python manage.py test -v 1`

Expected: packaging routing tests and full backend suite pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add backend/apps/core
git commit -m "feat: route chat requests to skill packaging"
```

### Task 4: Reflect generated Skills immediately in the conversation UI

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/AgentChat.tsx`
- Modify: `frontend/src/components/ChatSkillPicker.tsx`
- Modify: `frontend/src/pages/AgentChat.test.tsx`

**Interfaces:**
- Consumes: backend `created_skill` payload.
- Produces: typed generated-Skill metadata, a success tag, and immediate picker refresh.

- [ ] **Step 1: Add a failing UI test**

Resolve mocked `agentChat` with `created_skill: {skill_id:"gmv-workflow-ab12cd34", name:"GMV 复盘", description:"...", visibility:"private", enabled:true}`. Assert the reply appears, a `Skill · GMV 复盘` tag appears, and reopening the Skill picker reloads the personal Skill list.

- [ ] **Step 2: Run the test and confirm the payload is ignored**

Run: `cd frontend && npm test -- AgentChat.test.tsx`

Expected: generated Skill tag/refresh assertions fail.

- [ ] **Step 3: Type and render generated Skill metadata**

Add `created_skill?: { skill_id: string; name: string; description: string; visibility: "private" | "shared"; enabled: boolean }` to `AgentChatResult`. Include it in `lastMeta`, render a gold Skill tag, and pass a monotonically increasing `refreshKey` to `ChatSkillPicker`. Increment that key after a successful generated Skill response; make the picker reload when it changes.

- [ ] **Step 4: Run frontend tests and build**

Run: `cd frontend && npm test && npm run build`

Expected: all tests pass and build exits 0.

- [ ] **Step 5: Commit Task 4**

```bash
git add frontend/src
git commit -m "feat: surface generated skills in chat"
```

### Task 5: Verify private auto-upload end to end

**Files:**
- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: Run all automated checks**

Run: `cd backend && .venv/bin/python manage.py migrate && .venv/bin/python manage.py check && .venv/bin/python manage.py test -v 1`

Run: `cd frontend && npm test && npm run build`

Expected: all commands exit 0.

- [ ] **Step 2: Browser-check the complete user flow**

In `/agent`, complete a multi-turn task, send `把我们这次的对话和工作流程打包成一个 Skill 并自动上传到平台`, and verify the response says generated/uploaded/enabled/private. Open the Skill picker and invoke the new `@skill-id`. Log in as another user and verify the generated Skill is absent from shared assets and personal Skills.

- [ ] **Step 3: Commit verification fixes if required**

```bash
git add backend frontend
git commit -m "fix: harden conversation skill packaging"
```
