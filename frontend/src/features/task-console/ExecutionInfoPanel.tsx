import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, Typography } from "antd";
import {
  ApiOutlined, CheckOutlined, CloseOutlined, DownOutlined, EditOutlined,
} from "@ant-design/icons";
import {
  executionFieldDisplayValue,
  isExecutionFieldPending,
  type ExecutionField,
  type ExecutionFieldStatus,
} from "./executionFields";

interface Props {
  fields: ExecutionField[];
  onChange: (fields: ExecutionField[]) => void;
}

const STATUS_LABELS: Record<ExecutionFieldStatus, string> = {
  recognized: "AI 已识别",
  default: "使用默认值",
  needs_confirmation: "需要确认",
  missing: "必填缺失",
};

export default function ExecutionInfoPanel({ fields, onChange }: Props) {
  const pendingCount = useMemo(() => fields.filter(isExecutionFieldPending).length, [fields]);
  const [expanded, setExpanded] = useState(pendingCount > 0);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");

  useEffect(() => {
    setExpanded(pendingCount > 0);
    setEditingKey(null);
  }, [fields.map((field) => field.key).join("|"), pendingCount]);

  const summary = pendingCount > 0
    ? `已识别 ${fields.length - pendingCount} 项，还有 ${pendingCount} 项需要确认`
    : `已确认 ${fields.length} 项执行信息，无需补充`;

  const startEditing = (field: ExecutionField) => {
    setExpanded(true);
    setEditingKey(field.key);
    setDraftValue(field.value);
  };

  const confirmEditing = (field: ExecutionField) => {
    const value = draftValue.trim();
    onChange(fields.map((item) => item.key === field.key ? {
      ...item,
      value,
      source: "user",
      status: value ? "recognized" : "missing",
    } : item));
    setEditingKey(null);
  };

  return (
    <section className="task-sop-fields task-execution-info">
      <button
        type="button"
        className="task-execution-info-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="task-section-icon"><ApiOutlined /></span>
        <span className="task-execution-info-title">
          <Typography.Text strong>执行信息确认</Typography.Text>
          <Typography.Text type="secondary">{expanded ? "AI 已根据你的指令自动识别以下信息，请确认后开始执行。" : summary}</Typography.Text>
        </span>
        <DownOutlined className={expanded ? "is-expanded" : ""} />
      </button>

      {expanded && (
        <div className="task-execution-info-body">
          <div className="task-execution-field-list">
            {fields.map((field) => {
              const editing = editingKey === field.key;
              return (
                <div className={`task-execution-field status-${field.status}`} key={field.key}>
                  <div className="task-execution-field-copy">
                    <div className="task-execution-field-label">
                      <span>{field.label}</span>
                      <span className={`execution-field-status status-${field.status}`}>
                        {STATUS_LABELS[field.status]}
                      </span>
                    </div>
                    {editing ? (
                      field.options ? (
                        <Select
                          value={draftValue || undefined}
                          placeholder={`请选择${field.label}`}
                          options={field.options}
                          onChange={setDraftValue}
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <Input
                          type={field.type === "date" ? "date" : field.backendType === "number" ? "number" : "text"}
                          value={draftValue}
                          placeholder={`请输入${field.label}`}
                          onChange={(event) => setDraftValue(event.target.value)}
                        />
                      )
                    ) : (
                      <div className={`task-execution-field-value ${!field.value ? "is-placeholder" : ""}`}>
                        {executionFieldDisplayValue(field)}
                      </div>
                    )}
                  </div>
                  <div className="task-execution-field-actions">
                    {editing ? (
                      <>
                        <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => confirmEditing(field)}>确认</Button>
                        <Button type="link" size="small" icon={<CloseOutlined />} onClick={() => setEditingKey(null)}>取消</Button>
                      </>
                    ) : (
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => startEditing(field)}>修改</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className={`task-execution-info-summary ${pendingCount ? "has-pending" : ""}`}>
            系统已自动识别 {fields.length - pendingCount} 项信息{pendingCount ? `，还有 ${pendingCount} 项需要确认。` : "，无需补充。"}
          </div>
        </div>
      )}
    </section>
  );
}
