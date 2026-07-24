import { useCallback, useMemo, useState } from "react";
import { Badge, Button, Empty, Popover, Skeleton, Tag, Typography } from "antd";
import {
  CheckCircleOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { listWeComTodos, type WorkTodoItem } from "../api/client";

const PRIORITY_META: Record<string, { label: string; color: string }> = {
  urgent: { label: "紧急", color: "error" },
  high: { label: "高", color: "warning" },
  normal: { label: "普通", color: "default" },
};

function dueLabel(value?: string | null) {
  if (!value) return "未设置截止时间";
  const due = new Date(value);
  if (!Number.isFinite(due.getTime())) return "未设置截止时间";
  return due.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CollabTodoPreview() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<WorkTodoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  const loadTodos = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listWeComTodos({
        view: "assigned",
        status: "pending",
        page: 1,
        pageSize: 6,
      });
      setItems(result.results || []);
      setTotal(result.count || 0);
      setLoaded(true);
    } catch {
      setError("待办暂时无法加载");
    } finally {
      setLoading(false);
    }
  }, []);

  const goTodos = useCallback(() => {
    setOpen(false);
    navigate("/work?tab=todos");
  }, [navigate]);

  const content = useMemo(() => (
    <section className="collab-todo-preview" aria-label="我的待办预览">
      <header className="collab-todo-preview-head">
        <span className="collab-todo-preview-mark"><CheckSquareOutlined /></span>
        <span>
          <strong>我的待办</strong>
          <small>{total ? `还有 ${total} 项待处理` : "集中查看当前待处理事项"}</small>
        </span>
      </header>
      <div className="collab-todo-preview-list" aria-live="polite">
        {loading && !loaded ? <Skeleton active paragraph={{ rows: 3 }} title={false} /> : null}
        {!loading && error ? (
          <div className="collab-todo-preview-error">
            <Typography.Text type="secondary">{error}</Typography.Text>
            <Button type="link" size="small" onClick={() => void loadTodos()}>重试</Button>
          </div>
        ) : null}
        {!loading && !error && loaded && !items.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="当前没有待处理事项"
          />
        ) : null}
        {!error ? items.map((item) => {
          const priority = PRIORITY_META[item.priority || "normal"] || PRIORITY_META.normal;
          return (
            <article key={item.id} className="collab-todo-preview-item">
              <span className="collab-todo-preview-check"><CheckCircleOutlined /></span>
              <span className="collab-todo-preview-copy">
                <span className="collab-todo-preview-title">
                  <strong>{item.title}</strong>
                  {item.priority !== "normal" ? (
                    <Tag color={priority.color}>{priority.label}</Tag>
                  ) : null}
                </span>
                {item.description ? <small>{item.description}</small> : null}
                <span className="collab-todo-preview-meta">
                  <ClockCircleOutlined />
                  {dueLabel(item.dueAt)}
                  {item.assigneeNames?.length ? ` · ${item.assigneeNames.join("、")}` : ""}
                </span>
              </span>
            </article>
          );
        }) : null}
      </div>
      <Button className="collab-todo-preview-all" type="text" onClick={goTodos}>
        打开待办中心 <RightOutlined />
      </Button>
    </section>
  ), [error, goTodos, items, loadTodos, loaded, loading, total]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !loaded && !loading) void loadTodos();
      }}
      content={content}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      overlayClassName="collab-todo-popover"
    >
      <Badge count={total} size="small" overflowCount={99}>
        <Button
          type="text"
          className={`collab-panel-toggle collab-todo-trigger${open ? " is-active" : ""}`}
          icon={<CheckSquareOutlined />}
          aria-label="预览待办"
          aria-expanded={open}
        />
      </Badge>
    </Popover>
  );
}
