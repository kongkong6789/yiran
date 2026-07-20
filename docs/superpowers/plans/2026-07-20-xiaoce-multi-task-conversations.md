# Xiaoce Multi-Task Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independently named, renameable, deletable, and concurrently runnable Xiaoce task conversations to the existing `/collab` workspace.

**Architecture:** Keep every task as an existing `CollabRoom(room_kind="dm")` between the user and Xiaoce, and add a dedicated create endpoint that bypasses direct-message reuse. Continue using room IDs for message, run, context, Skill, and composer isolation. Split the frontend room list into a focused Xiaoce task component and the existing conversations, while `CollabRisk` remains the owner of async state changes.

**Tech Stack:** Django 5 / Django REST Framework, React 18, TypeScript, Ant Design 5, Node test runner, existing WebSocket and 15-second room polling.

## Global Constraints

- Do not add or migrate a database model.
- New tasks default to `小策bot（新任务）` and titles are limited to 120 characters.
- `POST /api/collab/xiaoce-tasks/` always creates a new room; existing `POST /api/collab/rooms/` keeps direct-message reuse behavior.
- A user may run Xiaoce concurrently in different rooms, but the existing one-running-run-per-user-per-room constraint remains.
- Xiaoce room titles must be shown as task names; ordinary direct messages must still show the peer name.
- Deleting a running Xiaoce task must prevent all later answer writes and pushes from that run.
- Unsent drafts remain isolated during in-page room switching only; do not add persistent draft storage.
- Existing ordinary direct messages, groups, Xiaoce pause/process reporting, and conversation Skill packaging must not regress.
- New task controls must expose keyboard focus and descriptive accessible names.

---

### Task 1: Dedicated Xiaoce task creation and display titles

**Files:**
- Modify: `backend/apps/collab/tests/test_xiaoce_api.py`
- Modify: `backend/apps/collab/views.py:250-310,392-401,851-947`
- Modify: `backend/apps/collab/urls.py:5-8`

**Interfaces:**
- Produces: `POST /api/collab/xiaoce-tasks/ -> CollabRoom` with HTTP 201.
- Produces: `XIAOCE_TASK_DEFAULT_TITLE = "小策bot（新任务）"`.
- Preserves: `POST /api/collab/rooms/` returns the most recently updated matching direct-message room.
- Preserves: ordinary direct-message `display_title` is the peer display name.

- [ ] **Step 1: Write failing API tests for two independent task rooms**

Add these test methods to `XiaoceApiTests`:

```python
    @property
    def tasks_url(self):
        return "/api/collab/xiaoce-tasks/"

    def test_create_xiaoce_task_always_creates_an_independent_room(self):
        first = self.client.post(self.tasks_url, {}, format="json")
        second = self.client.post(self.tasks_url, {}, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.data["id"], second.data["id"])
        self.assertEqual(first.data["title"], "小策bot（新任务）")
        self.assertEqual(second.data["title"], "小策bot（新任务）")
        for payload in (first.data, second.data):
            self.assertEqual(payload["room_kind"], "dm")
            self.assertEqual(payload["display_title"], "小策bot（新任务）")
            self.assertEqual(len(payload["messages"]), 1)
            self.assertEqual(payload["messages"][0]["ai_kind"], "xiaoce")

    def test_create_xiaoce_task_trims_and_limits_custom_title(self):
        response = self.client.post(
            self.tasks_url,
            {"title": f"  {'GMV' * 60}  "},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.data["title"]), 120)
        self.assertTrue(response.data["title"].startswith("GMV"))
```

- [ ] **Step 2: Write failing regression tests for title selection and normal DM reuse**

Extend the test setup with an ordinary user and add:

```python
        self.colleague = User.objects.create_user("api-colleague", password="pw")
```

```python
    def test_room_list_uses_task_title_only_for_xiaoce_direct_messages(self):
        task = self.client.post(
            self.tasks_url,
            {"title": "小策bot（GMV运算处理任务）"},
            format="json",
        ).data
        normal = self.client.post(
            "/api/collab/rooms/",
            {"peer_username": self.colleague.username, "room_kind": "dm", "title": "内部标题"},
            format="json",
        ).data

        listed = self.client.get("/api/collab/rooms/").data["results"]
        by_id = {row["id"]: row for row in listed}
        self.assertEqual(by_id[task["id"]]["display_title"], "小策bot（GMV运算处理任务）")
        self.assertEqual(by_id[normal["id"]]["display_title"], self.colleague.username)

    def test_existing_room_endpoint_reuses_the_latest_xiaoce_task(self):
        first = self.client.post(self.tasks_url, {"title": "任务一"}, format="json").data
        second = self.client.post(self.tasks_url, {"title": "任务二"}, format="json").data

        opened = self.client.post(
            "/api/collab/rooms/",
            {"peer_username": "小策bot", "room_kind": "dm"},
            format="json",
        )

        self.assertEqual(opened.status_code, 200)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(opened.data["id"], second["id"])
```

- [ ] **Step 3: Run the focused tests and verify the missing endpoint and title failures**

Run:

```bash
'/Users/lhlforever/Documents/Yiran Agent SAAS、/backend/.venv/bin/python' backend/manage.py test apps.collab.tests.test_xiaoce_api.XiaoceApiTests.test_create_xiaoce_task_always_creates_an_independent_room apps.collab.tests.test_xiaoce_api.XiaoceApiTests.test_create_xiaoce_task_trims_and_limits_custom_title apps.collab.tests.test_xiaoce_api.XiaoceApiTests.test_room_list_uses_task_title_only_for_xiaoce_direct_messages apps.collab.tests.test_xiaoce_api.XiaoceApiTests.test_existing_room_endpoint_reuses_the_latest_xiaoce_task -v 2
```

Expected: FAIL because `/api/collab/xiaoce-tasks/` returns 404 and Xiaoce `display_title` still resolves to the peer name.

- [ ] **Step 4: Add the dedicated creation view and shared welcome helper**

In `backend/apps/collab/views.py`, add constants and a shared helper near `_create_room`:

```python
XIAOCE_TASK_DEFAULT_TITLE = "小策bot（新任务）"
XIAOCE_WELCOME = (
    "你好，我是小策bot。\n"
    "可以直接问我经营指标、知识库、图谱或业务问题；"
    "我会结合平台知识与数据作答。"
)


def _create_xiaoce_welcome(room: CollabRoom, bot) -> CollabMessage:
    return CollabMessage.objects.create(
        room=room,
        sender=bot,
        content=XIAOCE_WELCOME,
        attachments=[],
        mentions=[],
        msg_type="ai",
        ai_kind="xiaoce",
    )
```

Add the endpoint before `room_list`:

```python
@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def xiaoce_task_list(request):
    touch_presence(request.user)
    title = str(request.data.get("title") or "").strip()[:120]
    if not title:
        title = XIAOCE_TASK_DEFAULT_TITLE
    bot = get_xiaoce_bot_user()
    room = _create_room(
        creator=request.user,
        peers=[bot],
        room_kind="dm",
        title=title,
    )
    welcome = _create_xiaoce_welcome(room, bot)
    transaction.on_commit(
        lambda: ws_push.publish_sync(room.id, messages=[_message_payload(welcome)]),
    )
    return Response(
        _room_payload(room, include_messages=True, viewer=request.user),
        status=201,
    )
```

Register it in `backend/apps/collab/urls.py`:

```python
    path("xiaoce-tasks/", views.xiaoce_task_list, name="collab-xiaoce-tasks"),
```

Refactor the existing first-Xiaoce-room branch to use `XIAOCE_TASK_DEFAULT_TITLE` and `_create_xiaoce_welcome`, removing the duplicated welcome construction.

- [ ] **Step 5: Make Xiaoce task payloads preserve room titles**

In `_room_payload`, calculate the room kind before the direct-message title override:

```python
    xiaoce_dm = room.room_kind == "dm" and any(
        member.get("bot_id") == "xiaoce"
        or member.get("username") == XIAOCE_BOT_USERNAME
        for member in members
    )
    display_title = room.title
    if room.room_kind == "dm" and viewer is not None and not xiaoce_dm:
        others = [m["display_name"] for m in members if m["id"] != viewer.id]
        if others:
            display_title = others[0]
        elif members:
            display_title = members[0]["display_name"]
```

- [ ] **Step 6: Run the focused tests and the complete Xiaoce API file**

Run:

```bash
'/Users/lhlforever/Documents/Yiran Agent SAAS、/backend/.venv/bin/python' backend/manage.py test apps.collab.tests.test_xiaoce_api -v 2
```

Expected: PASS with all tests in `test_xiaoce_api.py` successful.

- [ ] **Step 7: Commit the creation boundary**

```bash
git add backend/apps/collab/views.py backend/apps/collab/urls.py backend/apps/collab/tests/test_xiaoce_api.py
git commit -m "feat: create independent xiaoce task rooms"
```

---

### Task 2: Parallel-run regression coverage and deletion safety

**Files:**
- Modify: `backend/apps/collab/tests/test_xiaoce_runs.py`
- Modify: `backend/apps/collab/tests/test_xiaoce_api.py`
- Modify: `backend/apps/collab/xiaoce_runs.py:17-229`
- Modify: `backend/apps/collab/views.py:694-770,950-1010`

**Interfaces:**
- Produces: `cancel_xiaoce_runs_for_room_deletion(room: CollabRoom) -> int`.
- Changes: `is_xiaoce_run_cancelled(run_id) -> bool` returns true for a cancelled or deleted run.
- Changes: completion and failure helpers return `None` when the run was deleted.
- Preserves: explicit pause still creates one persisted pause message and remains idempotent.

- [ ] **Step 1: Write failing tests for cross-room concurrency and deleted-run no-ops**

Add imports in `test_xiaoce_runs.py` for `IntegrityError`, `transaction`, and `is_xiaoce_run_cancelled`; keep the existing `fail_xiaoce_run` import. Then add:

```python
    def test_same_user_can_run_in_two_rooms_but_not_twice_in_one_room(self):
        room_b = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=room_b, user=self.user)
        CollabParticipant.objects.create(room=room_b, user=self.bot)
        trigger_b = CollabMessage.objects.create(
            room=room_b,
            sender=self.user,
            content="分析库存",
            msg_type="user",
        )

        second_room_run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=room_b,
            user=self.user,
            trigger_message=trigger_b,
        )
        self.assertEqual(second_room_run.status, XiaoceRun.Status.RUNNING)

        duplicate_trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="重复分析",
            msg_type="user",
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            XiaoceRun.objects.create(
                id=uuid.uuid4(),
                room=self.room,
                user=self.user,
                trigger_message=duplicate_trigger,
            )

    def test_deleted_run_is_cancelled_and_late_writes_are_noops(self):
        run_id = self.run.id
        self.room.delete()

        self.assertTrue(is_xiaoce_run_cancelled(run_id))
        self.assertIsNone(complete_xiaoce_run(run_id, "迟到回答"))
        self.assertIsNone(fail_xiaoce_run(run_id, RuntimeError("late")))
        self.assertFalse(CollabMessage.objects.filter(content="迟到回答").exists())
```

- [ ] **Step 2: Write the failing API test for deleting a running task**

Add to `XiaoceApiTests`:

```python
    @patch("apps.collab.views.threading.Thread")
    @patch("apps.collab.views.ws_push.publish_sync")
    def test_delete_running_xiaoce_task_prevents_late_worker_output(
        self,
        publish,
        _thread_cls,
    ):
        run_id = uuid.uuid4()
        self.client.post(
            self.messages_url,
            {"content": "长任务", "run_id": str(run_id)},
            format="json",
        )
        publish.reset_mock()

        response = self.client.delete(f"/api/collab/rooms/{self.room.id}/")
        views._run_xiaoce_reply_async(run_id)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(CollabRoom.objects.filter(id=self.room.id).exists())
        self.assertFalse(XiaoceRun.objects.filter(id=run_id).exists())
        publish.assert_not_called()
```

- [ ] **Step 3: Run the new tests and verify deleted-run failures**

Run:

```bash
'/Users/lhlforever/Documents/Yiran Agent SAAS、/backend/.venv/bin/python' backend/manage.py test apps.collab.tests.test_xiaoce_runs.XiaoceRunLifecycleTests.test_same_user_can_run_in_two_rooms_but_not_twice_in_one_room apps.collab.tests.test_xiaoce_runs.XiaoceRunLifecycleTests.test_deleted_run_is_cancelled_and_late_writes_are_noops apps.collab.tests.test_xiaoce_api.XiaoceApiTests.test_delete_running_xiaoce_task_prevents_late_worker_output -v 2
```

Expected: the concurrency assertion passes under the current constraint, while deleted-run completion and the late worker error because helpers use `.get()` and missing runs are not considered cancelled.

- [ ] **Step 4: Make run helpers tolerate deletion**

Change the cancellation predicate in `xiaoce_runs.py`:

```python
def is_xiaoce_run_cancelled(run_id) -> bool:
    status = (
        XiaoceRun.objects.filter(id=run_id)
        .values_list("status", flat=True)
        .first()
    )
    return status is None or status == XiaoceRun.Status.CANCELLED
```

In `complete_xiaoce_run`, `complete_xiaoce_run_with_skill`, and `fail_xiaoce_run`, replace `.get(id=run_id)` with `.filter(id=run_id).first()` and place this guard before reading status:

```python
    if locked is None or locked.status != XiaoceRun.Status.RUNNING:
        return None
```

Add the room-deletion helper:

```python
@transaction.atomic
def cancel_xiaoce_runs_for_room_deletion(room) -> int:
    now = timezone.now()
    return XiaoceRun.objects.filter(
        room=room,
        status=XiaoceRun.Status.RUNNING,
    ).update(
        status=XiaoceRun.Status.CANCELLED,
        error_code="cancelled",
        error=ERROR_MESSAGES["cancelled"],
        cancelled_at=now,
        finished_at=now,
        updated_at=now,
    )
```

Export the helper from `__all__`.

- [ ] **Step 5: Harden the DELETE view and worker exception path**

Import `cancel_xiaoce_runs_for_room_deletion` in `views.py`. Wrap the final delete in one transaction:

```python
        room_id_str = str(room.id)
        with transaction.atomic():
            cancel_xiaoce_runs_for_room_deletion(room)
            room.delete()
        return Response({"ok": True, "deleted": room_id_str})
```

At the top of the generic worker exception handler, silently return after deletion:

```python
    except Exception as exc:
        if not XiaoceRun.objects.filter(id=run_id).exists():
            return
        current_stage = (
            XiaoceRun.objects.filter(id=run_id)
            .values_list("current_stage", flat=True)
            .first()
            or "understanding"
        )
```

- [ ] **Step 6: Generalize title validation without changing group announcements**

Change the empty title response in `room_detail` to:

```python
                return Response(
                    {"ok": False, "error": "会话名称不能为空"},
                    status=400,
                )
```

Add this API test to confirm Xiaoce rename behavior without a group announcement:

```python
    def test_xiaoce_task_rename_rejects_blank_and_has_no_group_announcement(self):
        before = CollabMessage.objects.filter(room=self.room, msg_type="system").count()

        renamed = self.client.patch(
            f"/api/collab/rooms/{self.room.id}/",
            {"title": "  小策bot（GMV运算处理任务）  "},
            format="json",
        )
        blank = self.client.patch(
            f"/api/collab/rooms/{self.room.id}/",
            {"title": "   "},
            format="json",
        )

        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.data["title"], "小策bot（GMV运算处理任务）")
        self.assertEqual(blank.status_code, 400)
        self.assertEqual(blank.data["error"], "会话名称不能为空")
        self.assertEqual(
            CollabMessage.objects.filter(room=self.room, msg_type="system").count(),
            before,
        )
```

- [ ] **Step 7: Run backend lifecycle, API, and Django checks**

Run:

```bash
'/Users/lhlforever/Documents/Yiran Agent SAAS、/backend/.venv/bin/python' backend/manage.py test apps.collab.tests.test_xiaoce_runs apps.collab.tests.test_xiaoce_api -v 2
'/Users/lhlforever/Documents/Yiran Agent SAAS、/backend/.venv/bin/python' backend/manage.py check
```

Expected: all selected tests pass and Django reports `System check identified no issues`.

- [ ] **Step 8: Commit lifecycle safety**

```bash
git add backend/apps/collab/views.py backend/apps/collab/xiaoce_runs.py backend/apps/collab/tests/test_xiaoce_runs.py backend/apps/collab/tests/test_xiaoce_api.py
git commit -m "fix: cancel deleted xiaoce task runs safely"
```

---

### Task 3: Frontend room partitioning, API client, and task list component

**Files:**
- Modify: `frontend/tests/xiaoceChat.test.ts`
- Modify: `frontend/src/pages/xiaoceChat.ts`
- Modify: `frontend/src/api/client.ts:1886-1909`
- Create: `frontend/src/components/XiaoceTaskList.tsx`
- Create: `frontend/src/styles/xiaoceTaskList.css`

**Interfaces:**
- Produces: `partitionXiaoceRooms<T>(rooms: T[]) -> { xiaoceTasks: T[]; otherRooms: T[] }`.
- Produces: `createXiaoceTask(body?: { title?: string }): Promise<CollabRoom>`.
- Produces: `XiaoceTaskList` with callback-only mutation boundaries.

- [ ] **Step 1: Write failing pure-function and client contract tests**

Import `partitionXiaoceRooms` in `frontend/tests/xiaoceChat.test.ts` and add:

```typescript
test("partitions multiple Xiaoce tasks without reordering either group", () => {
  const rooms = [
    { id: "task-a", room_kind: "dm", participants: [{ bot_id: "xiaoce" }] },
    { id: "person", room_kind: "dm", participants: [{ username: "同事" }] },
    { id: "task-b", room_kind: "dm", participants: [{ username: "小策bot" }] },
    { id: "group", room_kind: "group", participants: [{ username: "小策bot" }] },
  ];

  const result = partitionXiaoceRooms(rooms);

  assert.deepEqual(result.xiaoceTasks.map((room) => room.id), ["task-a", "task-b"]);
  assert.deepEqual(result.otherRooms.map((room) => room.id), ["person", "group"]);
});

test("API client exposes the dedicated Xiaoce task endpoint", () => {
  const source = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.ok(source.includes("export const createXiaoceTask"));
  assert.ok(source.includes('api.post<CollabRoom>("/collab/xiaoce-tasks/"'));
});
```

- [ ] **Step 2: Run the frontend test and verify missing exports**

Run:

```bash
cd frontend
node --test --test-name-pattern="partitions multiple Xiaoce tasks|dedicated Xiaoce task endpoint" tests/xiaoceChat.test.ts
```

Expected: FAIL because `partitionXiaoceRooms` and `createXiaoceTask` do not exist.

- [ ] **Step 3: Implement the pure partition helper and API client**

Export the room-like type and add this helper to `xiaoceChat.ts`:

```typescript
export type XiaoceRoomLike = {
  room_kind?: string;
  participants?: Array<{ username?: string; bot_id?: string }>;
};

export function partitionXiaoceRooms<T extends XiaoceRoomLike>(rooms: T[]): {
  xiaoceTasks: T[];
  otherRooms: T[];
} {
  const xiaoceTasks: T[] = [];
  const otherRooms: T[] = [];
  for (const room of rooms) {
    (isXiaoceRoom(room) ? xiaoceTasks : otherRooms).push(room);
  }
  return { xiaoceTasks, otherRooms };
}
```

Add to `client.ts` next to `createCollabRoom`:

```typescript
export const createXiaoceTask = (body: { title?: string } = {}) =>
  api.post<CollabRoom>("/collab/xiaoce-tasks/", body).then((response) => response.data);
```

- [ ] **Step 4: Write failing source-contract tests for the focused component**

Add to `xiaoceChat.test.ts`:

```typescript
test("Xiaoce task list exposes create, select, rename, delete, and running state", () => {
  const source = readFileSync(
    new URL("../src/components/XiaoceTaskList.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('aria-label="新建小策bot任务"'));
  assert.ok(source.includes("处理中"));
  assert.ok(source.includes("修改任务名称"));
  assert.ok(source.includes("删除任务"));
  assert.ok(source.includes("onSelect(task.id)"));
});

test("Xiaoce task list styles use semantic theme variables", () => {
  const css = readFileSync(
    new URL("../src/styles/xiaoceTaskList.css", import.meta.url),
    "utf8",
  );
  assert.ok(css.includes("var(--lc-surface"));
  assert.ok(css.includes("var(--lc-border"));
  assert.ok(css.includes("var(--lc-ink)"));
  assert.ok(css.includes(":focus-visible"));
});
```

- [ ] **Step 5: Run the component contracts and verify missing files**

Run:

```bash
cd frontend
node --test --test-name-pattern="Xiaoce task list" tests/xiaoceChat.test.ts
```

Expected: FAIL with file-not-found errors for `XiaoceTaskList.tsx` and `xiaoceTaskList.css`.

- [ ] **Step 6: Create the focused task list component**

Create `frontend/src/components/XiaoceTaskList.tsx` with this public boundary and structure:

```tsx
import { Badge, Button, Dropdown, Empty, Tag, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import type { CollabRoom } from "../api/client";
import "../styles/xiaoceTaskList.css";

export type XiaoceTaskListProps = {
  tasks: CollabRoom[];
  activeId: string | null;
  creating: boolean;
  canRename: (task: CollabRoom) => boolean;
  canDelete: (task: CollabRoom) => boolean;
  onCreate: () => void;
  onSelect: (roomId: string) => void;
  onRename: (task: CollabRoom) => void;
  onDelete: (task: CollabRoom) => void;
};

export default function XiaoceTaskList({
  tasks,
  activeId,
  creating,
  canRename,
  canDelete,
  onCreate,
  onSelect,
  onRename,
  onDelete,
}: XiaoceTaskListProps) {
  return (
    <section className="xiaoce-task-section" aria-labelledby="xiaoce-task-heading">
      <div className="xiaoce-task-section-head">
        <strong id="xiaoce-task-heading">小策bot 任务</strong>
        <Tooltip title="新建小策bot任务">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label="新建小策bot任务"
            loading={creating}
            onClick={onCreate}
          />
        </Tooltip>
      </div>
      {tasks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无小策任务" />
      ) : tasks.map((task) => {
        const title = task.display_title || task.title;
        const running = task.active_xiaoce_run?.status === "running";
        const items: MenuProps["items"] = [
          canRename(task) ? {
            key: "rename",
            icon: <EditOutlined />,
            label: "修改任务名称",
            onClick: () => onRename(task),
          } : null,
          canDelete(task) ? {
            key: "delete",
            icon: <DeleteOutlined />,
            label: "删除任务",
            danger: true,
            onClick: () => onDelete(task),
          } : null,
        ].filter(Boolean) as MenuProps["items"];
        return (
          <div
            key={task.id}
            className={`xiaoce-task-item${activeId === task.id ? " active" : ""}`}
          >
            <button
              type="button"
              className="xiaoce-task-main"
              onClick={() => onSelect(task.id)}
              aria-current={activeId === task.id ? "page" : undefined}
            >
              <span className="xiaoce-task-icon" aria-hidden="true"><RobotOutlined /></span>
              <span className="xiaoce-task-copy">
                <span className="xiaoce-task-title">{title}</span>
                <span className="xiaoce-task-preview">
                  {running ? "小策bot 正在处理" : task.last_message?.content || "开始一个新任务"}
                </span>
              </span>
              <span className="xiaoce-task-state">
                {running ? <Tag color="processing">处理中</Tag> : null}
                {(task.unread_count || 0) > 0 ? <Badge count={task.unread_count} size="small" /> : null}
              </span>
            </button>
            {items && items.length > 0 ? (
              <Dropdown menu={{ items }} trigger={["click"]} placement="bottomRight">
                <button
                  type="button"
                  className="xiaoce-task-menu"
                  aria-label={`管理任务 ${title}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreOutlined />
                </button>
              </Dropdown>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 7: Add semantic, responsive task-list styles**

Create `frontend/src/styles/xiaoceTaskList.css` with scoped styles for `.xiaoce-task-section`, `.xiaoce-task-section-head`, `.xiaoce-task-item`, `.xiaoce-task-main`, `.xiaoce-task-menu`, `.xiaoce-task-icon`, `.xiaoce-task-copy`, `.xiaoce-task-title`, `.xiaoce-task-preview`, and `.xiaoce-task-state`. Use only existing semantic variables such as:

```css
.xiaoce-task-section {
  border-bottom: 1px solid var(--lc-border-light);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.xiaoce-task-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 8px;
  color: var(--lc-text-muted);
  font-size: 12px;
}

.xiaoce-task-item {
  position: relative;
  display: flex;
  align-items: stretch;
  border-radius: 10px;
  color: var(--lc-ink);
}

.xiaoce-task-item:hover {
  background: var(--lc-surface-raised);
}

.xiaoce-task-item.active {
  background: var(--lc-selected);
}

.xiaoce-task-main {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  border: 0;
  padding: 9px 36px 9px 8px;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.xiaoce-task-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border: 1px solid var(--lc-border-light);
  border-radius: 9px;
}

.xiaoce-task-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.xiaoce-task-title,
.xiaoce-task-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.xiaoce-task-title {
  font-size: 13px;
  font-weight: 600;
}

.xiaoce-task-preview {
  color: var(--lc-text-muted);
  font-size: 11px;
}

.xiaoce-task-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.xiaoce-task-state .ant-tag {
  margin-inline-end: 0;
}

.xiaoce-task-menu {
  position: absolute;
  top: 50%;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  color: var(--lc-text-muted);
  background: transparent;
  transform: translateY(-50%);
  cursor: pointer;
}

.xiaoce-task-menu:hover {
  color: var(--lc-ink);
  background: var(--lc-hover);
}

.xiaoce-task-main:focus-visible,
.xiaoce-task-menu:focus-visible {
  outline: 2px solid var(--lc-accent-blue);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .xiaoce-task-menu {
    opacity: 1;
  }
}
```

- [ ] **Step 8: Run frontend unit tests and build the isolated component**

Run:

```bash
cd frontend
npm test
npm run build
```

Expected: all Node tests pass and TypeScript plus Vite build exits 0.

- [ ] **Step 9: Commit frontend primitives**

```bash
git add frontend/src/api/client.ts frontend/src/pages/xiaoceChat.ts frontend/src/components/XiaoceTaskList.tsx frontend/src/styles/xiaoceTaskList.css frontend/tests/xiaoceChat.test.ts
git commit -m "feat: add xiaoce task list primitives"
```

---

### Task 4: Wire task creation, rename, deletion, and grouped rendering

**Files:**
- Modify: `frontend/tests/xiaoceChat.test.ts`
- Modify: `frontend/src/pages/CollabRisk.tsx:1-55,620-735,1360-1500,2019-2045,2310-2431,2534-2553,2620-2690,3403-3420`

**Interfaces:**
- Consumes: `createXiaoceTask`, `partitionXiaoceRooms`, and `XiaoceTaskList` from Task 3.
- Produces: room-aware create, rename, and delete handlers owned by `CollabRisk`.
- Preserves: current other-conversation row rendering and ordinary room deletion behavior.

- [ ] **Step 1: Write failing source-contract tests for page integration**

Add to `xiaoceChat.test.ts`:

```typescript
test("collaboration chat wires grouped Xiaoce task actions", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("<XiaoceTaskList"));
  assert.ok(source.includes("partitionXiaoceRooms(rooms)"));
  assert.ok(source.includes("createXiaoceTask()"));
  assert.ok(source.includes("roomComposerCacheRef.current.delete(id)"));
  assert.ok(source.includes("roomViewCacheRef.current.delete(id)"));
  assert.ok(source.includes("正在处理的任务也会停止"));
  assert.ok(source.includes("修改任务名称"));
});
```

- [ ] **Step 2: Run the integration contract and verify it fails**

Run:

```bash
cd frontend
node --test --test-name-pattern="grouped Xiaoce task actions" tests/xiaoceChat.test.ts
```

Expected: FAIL because `CollabRisk` has not imported or rendered the new task component and still uses group-only rename state.

- [ ] **Step 3: Import frontend primitives and partition the room list**

Add imports:

```typescript
import XiaoceTaskList from "../components/XiaoceTaskList";
import {
  createXiaoceRunId,
  isXiaoceRoom,
  mergeXiaoceRunSnapshot,
  partitionXiaoceRooms,
} from "./xiaoceChat";
```

Add `createXiaoceTask` to the API imports. Replace the single `creating` concern for Xiaoce with its own state:

```typescript
  const [creatingXiaoce, setCreatingXiaoce] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
```

Partition without changing order:

```typescript
  const { xiaoceTasks, otherRooms } = useMemo(
    () => partitionXiaoceRooms(rooms),
    [rooms],
  );
```

- [ ] **Step 4: Implement dedicated task creation owned by the page**

Add this handler near `openDm`:

```typescript
  const handleCreateXiaoceTask = async () => {
    if (creatingXiaoce) return;
    setCreatingXiaoce(true);
    try {
      const room = await createXiaoceTask();
      const roomMessages = room.messages || [];
      roomViewCacheRef.current.set(room.id, {
        room,
        messages: roomMessages,
        insights: room.insights || [],
        hasMoreBefore: false,
        firstItemIndex: VIRT_BASE_INDEX,
        xiaoceRun: room.active_xiaoce_run || null,
        stats: null,
      });
      setRooms((current) => [room, ...current.filter((item) => item.id !== room.id)]);
      setSiderTab("chats");
      selectRoom(room.id);
      message.success("小策任务已创建");
    } catch (error: any) {
      message.error(error?.response?.data?.error || "创建小策任务失败");
    } finally {
      setCreatingXiaoce(false);
    }
  };
```

- [ ] **Step 5: Generalize rename state from active group to an exact room ID**

Replace `openRenameModal` and `handleRenameGroup` with room-aware functions:

```typescript
  const openRenameModal = (room: CollabRoom | null = activeRoom) => {
    if (!room) return;
    setRenameTargetId(room.id);
    setRenameTitle((room.title || "").trim());
    setRenameOpen(true);
  };

  const handleRenameRoom = async () => {
    const roomId = renameTargetId;
    const target = rooms.find((room) => room.id === roomId) || (
      activeRoom?.id === roomId ? activeRoom : null
    );
    if (!roomId || !target) return;
    const next = renameTitle.trim();
    if (!next) {
      message.warning("会话名称不能为空");
      return;
    }
    if (next === (target.title || "").trim()) {
      setRenameOpen(false);
      return;
    }
    setRenaming(true);
    try {
      const room = await updateCollabRoom(roomId, { title: next });
      setRooms((current) => current.map((item) => (
        item.id === roomId ? { ...item, ...room, messages: undefined, insights: undefined } : item
      )));
      if (activeId === roomId) {
        setActiveRoom((current) => current ? { ...current, ...room } : room);
      }
      if (activeId === roomId && room.messages?.length) {
        const last = room.messages[room.messages.length - 1];
        setMessages((current) => (
          current.some((messageRow) => messageRow.id === last.id)
            ? current
            : [...current, last]
        ));
      }
      const cached = roomViewCacheRef.current.get(roomId);
      if (cached) {
        roomViewCacheRef.current.set(roomId, {
          ...cached,
          room: { ...cached.room, ...room },
        });
      }
      setRenameOpen(false);
      message.success(isXiaoceRoom(target) ? "任务名称已更新" : "群名已更新");
    } catch (error: any) {
      message.error(error?.response?.data?.error || "修改会话名称失败");
    } finally {
      setRenaming(false);
    }
  };
```

Wire the page-heading edit button for both open groups and Xiaoce rooms. Keep the label `修改群名` for a group and use `修改任务名称` for Xiaoce. Wrap both React and Ant Design callbacks so event objects are never mistaken for rooms:

```tsx
onClick={() => openRenameModal(activeRoom)}
```

```typescript
onClick: () => openRenameModal(activeRoom)
```

- [ ] **Step 6: Make deletion target-aware, cancellation-aware, and cache-safe**

Change `handleDeleteRoom` to resolve the full target from `rooms` or `activeRoom`. For Xiaoce tasks, set confirmation strings exactly as follows:

```typescript
    const xiaoceTask = isXiaoceRoom(target);
    const running = target.active_xiaoce_run?.status === "running";
    const title = xiaoceTask ? "删除这个小策任务？" : "删除此会话？";
    const content = xiaoceTask
      ? running
        ? "将永久删除该任务及全部聊天记录，正在处理的任务也会停止。"
        : "将永久删除该任务及全部聊天记录。"
      : "将彻底删除该会话及全部聊天记录，所有成员都不可再访问。";
```

Only after `deleteCollabRoom(id)` succeeds, remove room-scoped caches and pick the next Xiaoce task when needed:

```typescript
          const remaining = rooms.filter((room) => room.id !== id);
          setRooms(remaining);
          if (activeId === id) {
            const nextTask = xiaoceTask
              ? remaining.find((room) => isXiaoceRoom(room)) || null
              : null;
            if (nextTask) {
              selectRoom(nextTask.id);
            } else {
              setActiveId(null);
              setActiveRoom(null);
              setMessages([]);
              setInsights([]);
              setActiveXiaoceRun(null);
            }
          }
          roomComposerCacheRef.current.delete(id);
          roomViewCacheRef.current.delete(id);
```

- [ ] **Step 7: Render the Xiaoce group before the unchanged other conversations**

Inside the chats tab, render:

```tsx
          <div className="collab-room-list">
            <XiaoceTaskList
              tasks={xiaoceTasks}
              activeId={activeId}
              creating={creatingXiaoce}
              canRename={(task) => Boolean(
                me && task.participants.some((participant) => participant.id === me.id),
              )}
              canDelete={(task) => Boolean(
                me?.is_staff || task.participants.some((participant) => participant.id === me?.id),
              )}
              onCreate={() => void handleCreateXiaoceTask()}
              onSelect={selectRoom}
              onRename={openRenameModal}
              onDelete={(task) => handleDeleteRoom(task.id)}
            />
            <div className="collab-contact-section-title">其他对话</div>
            {otherRooms.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={loadingRooms ? "加载中…" : "暂无其他对话"}
              />
            ) : null}
```

Before the existing `collab-room-list` closing tag, retain the current ordinary-room mapping body byte-for-byte and change its iterator line from:

```tsx
rooms.map((room) => {
```

to:

```tsx
otherRooms.map((room) => {
```

This preserves the existing avatar, risk, unread, and delete presentation without introducing another component in this task.

- [ ] **Step 8: Generalize the rename modal copy and submit handler**

Derive the target and render neutral or specific copy:

```typescript
  const renameTarget = rooms.find((room) => room.id === renameTargetId) || null;
  const renamingXiaoce = isXiaoceRoom(renameTarget);
```

Use `handleRenameRoom` on submit, title `修改任务名称` for Xiaoce and `修改群名` otherwise, and placeholder `输入新的任务名称` for Xiaoce and `输入新的群名称` otherwise.

- [ ] **Step 9: Run frontend tests and build**

Run:

```bash
cd frontend
npm test
npm run build
```

Expected: all Node tests pass and the production build exits 0 with no TypeScript errors.

- [ ] **Step 10: Commit page integration**

```bash
git add frontend/src/pages/CollabRisk.tsx frontend/tests/xiaoceChat.test.ts
git commit -m "feat: enable multiple xiaoce task conversations"
```

---

### Task 5: Full regression and browser acceptance

**Files:**
- Verify only; modify earlier files only when a failing check proves an in-scope defect.

**Interfaces:**
- Verifies all API, state, accessibility, concurrency, and regression requirements from the design spec.

- [ ] **Step 1: Run the full collaboration backend suite**

Run:

```bash
'/Users/lhlforever/Documents/Yiran Agent SAAS、/backend/.venv/bin/python' backend/manage.py test apps.collab.tests.test_xiaoce_progress apps.collab.tests.test_xiaoce_runs apps.collab.tests.test_xiaoce_api -v 2
'/Users/lhlforever/Documents/Yiran Agent SAAS、/backend/.venv/bin/python' backend/manage.py check
```

Expected: all collaboration tests pass and Django reports no system-check issues.

- [ ] **Step 2: Run the complete frontend suite and source audit**

Run:

```bash
cd frontend
npm test
npm run audit:dark
npm run build
```

Expected: all tests pass, dark-mode audit reports no violations, and the production build exits 0.

- [ ] **Step 3: Verify the API acceptance flow**

Using the Django tests or an authenticated local session, verify these exact outcomes:

1. Two calls to `POST /api/collab/xiaoce-tasks/` return different UUIDs.
2. Both rooms appear in `GET /api/collab/rooms/` with their own `display_title`.
3. Two different rooms can each expose `active_xiaoce_run.status = running` for the same user.
4. Renaming one UUID changes only that room.
5. Deleting a running room removes it and no later answer appears.
6. Calling ordinary direct-message creation twice still returns the same ordinary room.

- [ ] **Step 4: Run browser acceptance on light and dark themes**

Verify in `/collab`:

1. The sidebar shows `小策bot 任务` with a keyboard-focusable plus button and `其他对话` below it.
2. Create two tasks and rename them `小策bot（GMV运算处理任务）` and `小策bot（库存分析任务）`.
3. Start a long GMV task, switch to inventory, and submit a second task while GMV remains running.
4. Switch back and confirm each room retains its own messages, progress card, draft, attachments, and reply target.
5. Refresh and confirm both rooms and server-side active states recover.
6. Delete a completed task and then a running task; verify the running-task warning mentions stopping work.
7. Confirm ordinary direct messages and groups still open, rename, show unread counts, and delete as before.
8. Repeat the list, menu, modal, running-state, and focus checks in light and dark themes at desktop and narrow widths.

- [ ] **Step 5: Inspect the final diff and commits**

Run:

```bash
git status --short
git diff --check HEAD~4..HEAD
git log -5 --oneline --decorate
```

Expected: no unintended files, no whitespace errors, and focused commits for API creation, lifecycle safety, frontend primitives, and page integration.
