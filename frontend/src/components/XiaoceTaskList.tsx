import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Badge, Button, Dropdown, Empty, Tag, Tooltip } from "antd";
import type { MenuProps } from "antd";
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
