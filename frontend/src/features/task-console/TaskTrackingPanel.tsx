import { useEffect, useMemo, useState } from "react";
import {
  ClockCircleOutlined, EllipsisOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined, UserOutlined,
} from "@ant-design/icons";
import {
  App, Avatar, Button, Dropdown, Empty, Input, Pagination, Progress, Select,
  Skeleton, Space, Tabs, Typography,
} from "antd";
import { getPublishedTasks, type PublishedTask, type TaskView } from "./mockTasks";
import TaskDetailView from "./TaskDetailView";
import TaskStatusBadge from "./TaskStatusBadge";
import { authenticatedAvatarUrl } from "../../utils/avatar";

const PAGE_SIZE = 10;
const fmtTime = (value?: string | null) => value
  ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  : "未设置";

type StatusFilter = "pending" | "running" | "sent" | "completed" | "all";

function groupLabel(task: PublishedTask) {
  const deadline = task.deadline ? new Date(task.deadline) : null;
  if (!deadline) return "更早";
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(todayEnd);
  weekEnd.setDate(weekEnd.getDate() + 7);
  if (deadline < now && !["completed", "partial"].includes(task.status)) return "已逾期";
  if (deadline <= todayEnd) return "今天";
  if (deadline <= weekEnd) return "本周";
  return "更早";
}

export default function TaskTrackingPanel({
  view,
  onCreate,
  onDetailChange,
}: {
  view: TaskView;
  onCreate?: () => void;
  onDetailChange?: (open: boolean) => void;
}) {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<PublishedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PublishedTask | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(view === "sent" ? "sent" : "pending");
  const [keyword, setKeyword] = useState("");
  const [assignee, setAssignee] = useState<string>();
  const [taskType, setTaskType] = useState<string>();
  const [timeRange, setTimeRange] = useState<string>("all");
  const [page, setPage] = useState(1);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setTasks(await getPublishedTasks(view));
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "加载任务失败");
      setTasks([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    onDetailChange?.(false);
    setStatusFilter(view === "sent" ? "sent" : "pending");
    setPage(1);
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 5000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const openTask = (task: PublishedTask) => {
    setSelected(task);
    onDetailChange?.(true);
  };

  const closeTask = () => {
    setSelected(null);
    onDetailChange?.(false);
  };

  const assigneeOptions = useMemo(() => (
    [...new Set(tasks.flatMap((task) => task.assignees))].map((name) => ({ label: name, value: name }))
  ), [tasks]);
  const typeOptions = useMemo(() => (
    [...new Set(tasks.map((task) => task.sopId || "通用任务"))].map((type) => ({ label: type, value: type }))
  ), [tasks]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeDays = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 0;
    return tasks.filter((task) => {
      if (statusFilter === "pending" && task.status !== "pending") return false;
      if (statusFilter === "running" && task.status !== "running") return false;
      if (statusFilter === "completed" && !["completed", "partial"].includes(task.status)) return false;
      if (statusFilter === "sent" && task.taskSource !== "sent") return false;
      if (keyword && !`${task.title} ${task.sender} ${task.assignees.join(" ")}`.toLowerCase().includes(keyword.toLowerCase())) return false;
      if (assignee && !task.assignees.includes(assignee)) return false;
      if (taskType && (task.sopId || "通用任务") !== taskType) return false;
      if (rangeDays && now - new Date(task.updatedAt).getTime() > rangeDays * 86400000) return false;
      return true;
    });
  }, [assignee, keyword, statusFilter, taskType, tasks, timeRange, view]);

  const counts = {
    pending: tasks.filter((task) => task.status === "pending").length,
    running: tasks.filter((task) => task.status === "running").length,
    completed: tasks.filter((task) => ["completed", "partial"].includes(task.status)).length,
  };
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const groups = ["已逾期", "今天", "本周", "更早"].map((label) => ({
    label,
    tasks: pageRows.filter((task) => groupLabel(task) === label),
  })).filter((group) => group.tasks.length > 0);

  if (selected) {
    return (
      <TaskDetailView
        task={selected}
        view={view}
        onBack={closeTask}
        onCreate={onCreate}
      />
    );
  }

  return (
    <div className="task-center-view">
      <Tabs
        className="task-center-tabs"
        activeKey={statusFilter}
        onChange={(key) => { setStatusFilter(key as StatusFilter); setPage(1); }}
        items={[
          { key: "pending", label: <span>待我处理 <b>{counts.pending}</b></span> },
          { key: "running", label: <span>进行中 <b>{counts.running}</b></span> },
          { key: "sent", label: "我发起的" },
          { key: "completed", label: <span>已完成 <b>{counts.completed}</b></span> },
          { key: "all", label: "全部" },
        ]}
      />

      <div className="task-center-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索任务名称、内容或负责人"
          value={keyword}
          onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
          className="task-center-search"
        />
        <Select
          allowClear
          placeholder="全部负责人"
          value={assignee}
          options={assigneeOptions}
          onChange={(value) => { setAssignee(value); setPage(1); }}
        />
        <Select
          allowClear
          placeholder="全部类型"
          value={taskType}
          options={typeOptions}
          onChange={(value) => { setTaskType(value); setPage(1); }}
        />
        <Select
          value={timeRange}
          onChange={(value) => { setTimeRange(value); setPage(1); }}
          options={[
            { value: "all", label: "全部时间" },
            { value: "7d", label: "最近 7 天" },
            { value: "30d", label: "最近 30 天" },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
      </div>

      {loading ? (
        <div className="task-center-skeleton">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} active avatar paragraph={{ rows: 1 }} />)}
        </div>
      ) : groups.length ? (
        <div className="task-center-groups">
          {groups.map((group) => (
            <section className={`task-center-group is-${group.label === "已逾期" ? "overdue" : "regular"}`} key={group.label}>
              <div className="task-center-group-heading">
                <span>{group.label}</span>
                <small>{group.tasks.length} 项</small>
              </div>
              <div className="task-center-list">
                {group.tasks.map((task) => {
                  const overdue = group.label === "已逾期";
                  const primaryLabel = task.status === "pending" ? "开始处理" : "查看详情";
                  return (
                    <div
                      className="task-center-item"
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openTask(task)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") openTask(task);
                      }}
                    >
                      <span className={`task-center-item-mark is-${task.status}`} />
                      <div className="task-center-item-main">
                        <div className="task-center-item-title">
                          <Typography.Text strong>{task.title}</Typography.Text>
                          <span>{task.sopId || "通用任务"}</span>
                        </div>
                        <div className="task-center-item-meta">
                          <span>
                            <Avatar.Group size={20} max={{ count: 3 }}>
                              {(task.assigneeMembers || []).map((member) => (
                                <Avatar key={member.id} src={authenticatedAvatarUrl(member.avatarUrl)} icon={!member.avatarUrl ? <UserOutlined /> : undefined} />
                              ))}
                              {!task.assigneeMembers?.length && <Avatar icon={<UserOutlined />} />}
                            </Avatar.Group>{" "}
                            {task.assignees.join("、") || "未指定负责人"}
                          </span>
                          <span className={overdue ? "is-overdue" : ""}><ClockCircleOutlined /> {fmtTime(task.deadline)}</span>
                          <span>来源：{task.taskSource === "received" ? task.sender : "我发起"}</span>
                          {task.notificationStatus === "accepted" && <span className="task-center-wecom-synced">已同步企业微信</span>}
                        </div>
                      </div>
                      <TaskStatusBadge status={task.status} label={task.statusLabel} />
                      <div className="task-center-progress">
                        <Progress
                          percent={task.progress}
                          size="small"
                          showInfo={false}
                          status={task.status === "failed" ? "exception" : task.status === "completed" ? "success" : "normal"}
                        />
                        <span>{task.progress}%</span>
                      </div>
                      <Space className="task-center-item-actions" onClick={(event) => event.stopPropagation()}>
                        <Button type={task.status === "pending" ? "primary" : "default"} size="small" onClick={() => openTask(task)}>
                          {primaryLabel}
                        </Button>
                        <Dropdown menu={{ items: [
                          { key: "detail", label: "查看任务配置" },
                          { key: "copy", label: "复制任务 ID" },
                        ], onClick: ({ key }) => {
                          if (key === "detail") openTask(task);
                          if (key === "copy") void navigator.clipboard.writeText(task.traceId).then(() => message.success("任务 ID 已复制"));
                        } }}>
                          <Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="更多操作" />
                        </Dropdown>
                      </Space>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="task-center-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <div>
                <strong>当前条件下没有任务</strong>
                <span>调整筛选条件，或创建一个新任务交给 AI 处理。</span>
              </div>
            )}
          >
            {onCreate && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新建任务</Button>}
          </Empty>
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="task-center-pagination">
          <span>共 {filtered.length} 项任务</span>
          <Pagination current={page} pageSize={PAGE_SIZE} total={filtered.length} showSizeChanger={false} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
