import { Button, Checkbox, Typography } from "antd";
import { DatabaseOutlined, SyncOutlined } from "@ant-design/icons";

interface Props {
  syncing: boolean;
  lastSyncAt: Date | null;
  autoSync: boolean;
  onAutoSyncChange: (value: boolean) => void;
  onSync: () => void;
}

function formatSyncTime(value: Date | null) {
  if (!value) return "尚未同步";
  return value.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DataPreparation({
  syncing,
  lastSyncAt,
  autoSync,
  onAutoSyncChange,
  onSync,
}: Props) {
  return (
    <section className="task-data-prep">
      <div className="task-data-prep-head">
        <DatabaseOutlined />
        <div>
          <Typography.Text strong>数据准备</Typography.Text>
          <Typography.Text type="secondary">从吉客云同步最新数据至 DataLake</Typography.Text>
        </div>
      </div>
      <div className="task-data-prep-body">
        <div className="task-data-prep-status">
          <span>数据状态：{lastSyncAt ? "已同步" : "待同步"}</span>
          <span>最后同步：{formatSyncTime(lastSyncAt)}</span>
        </div>
        <div className="task-data-prep-actions">
          <Button
            size="small"
            icon={<SyncOutlined spin={syncing} />}
            loading={syncing}
            onClick={onSync}
          >
            {lastSyncAt ? "重新同步" : "同步业务数据"}
          </Button>
          <Checkbox checked={autoSync} onChange={(event) => onAutoSyncChange(event.target.checked)}>
            执行前自动同步最新数据
          </Checkbox>
        </div>
      </div>
    </section>
  );
}
