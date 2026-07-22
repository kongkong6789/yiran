import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Input, Select, Tag, Typography } from "antd";
import {
  CheckOutlined, CloseOutlined, DownOutlined, EditOutlined,
} from "@ant-design/icons";
import TaskStepHeader from "./TaskStepHeader";
import {
  executionFieldDisplayValue,
  isExecutionFieldPending,
  pendingFieldHint,
  type ExecutionField,
  type ExecutionFieldStatus,
} from "./executionFields";

interface Props {
  fields: ExecutionField[];
  onChange: (fields: ExecutionField[]) => void;
  embedded?: boolean;
}

const STATUS_LABELS: Record<ExecutionFieldStatus, string> = {
  recognized: "AI 已识别",
  default: "使用默认值",
  needs_confirmation: "需要确认",
  missing: "必填缺失",
};

export default function ExecutionInfoPanel({ fields, onChange, embedded = false }: Props) {
  const pendingCount = useMemo(() => fields.filter(isExecutionFieldPending).length, [fields]);
  const fieldKeys = useMemo(() => fields.map((field) => field.key).join("|"), [fields]);
  const contentId = useId();
  const [expanded, setExpanded] = useState(pendingCount > 0);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<string | string[]>("");
  const previousPendingCount = useRef(pendingCount);

  useEffect(() => {
    setExpanded(pendingCount > 0);
    setEditingKey(null);
    previousPendingCount.current = pendingCount;
  }, [fieldKeys]);

  useEffect(() => {
    if (previousPendingCount.current === 0 && pendingCount > 0) {
      setExpanded(true);
    }
    previousPendingCount.current = pendingCount;
  }, [pendingCount]);

  useEffect(() => {
    if (editingKey && !fields.some((field) => field.key === editingKey)) {
      setEditingKey(null);
    }
  }, [editingKey, fields]);

  if (fields.length === 0) return null;

  const summary = pendingCount > 0
    ? `还有${pendingCount}项待确认`
    : `已确认${fields.length}项执行信息`;

  const startEditing = (field: ExecutionField) => {
    setExpanded(true);
    setEditingKey(field.key);
    setDraftValue(field.value);
  };

  const confirmEditing = (field: ExecutionField) => {
    const value = Array.isArray(draftValue) ? draftValue : draftValue.trim();
    const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value);
    onChange(fields.map((item) => item.key === field.key ? {
      ...item,
      value,
      source: "user",
      status: hasValue ? "recognized" : (field.required ? "missing" : "default"),
    } : item));
    setEditingKey(null);
  };

  return (
    <section className={`task-execution-info${embedded ? " is-embedded" : " task-step-section"}`}>
      <button
        type="button"
        className="task-execution-info-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <TaskStepHeader
          step={embedded ? undefined : 3}
          title={embedded ? "AI 识别的任务配置" : "确认执行信息"}
          description={expanded
            ? "AI 已根据任务指令识别以下信息，只需确认不确定的内容。"
            : summary}
          extra={pendingCount > 0 ? (
            <Tag color="warning" className="task-step-badge">{summary}</Tag>
          ) : undefined}
        />
        <span className="task-execution-info-toggle-label" aria-hidden="true">
          <span>{expanded ? "收起" : "展开"}</span>
          <DownOutlined className={`task-execution-info-chevron${expanded ? " is-expanded" : ""}`} />
        </span>
      </button>

      {expanded && (
        <div id={contentId} className="task-step-body task-execution-info-body">
          <div className="task-execution-field-list">
            {fields.map((field) => {
              const editing = editingKey === field.key;
              const pending = isExecutionFieldPending(field);
              return (
                <div
                  className={`task-execution-field status-${field.status}${pending ? " is-pending" : ""}${editing ? " is-editing" : ""}`}
                  key={field.key}
                >
                  <div className="task-execution-field-copy">
                    <div className="task-execution-field-label">
                      <span>{field.label}</span>
                      {!editing && (
                        <span className={`execution-field-status status-${field.status}`}>
                          {STATUS_LABELS[field.status]}
                        </span>
                      )}
                    </div>
                    {editing ? (
                      <>
                        {field.options ? (
                          <Select
                            mode={field.multiple ? "multiple" : undefined}
                            className="task-execution-field-control"
                            value={(Array.isArray(draftValue) ? draftValue : draftValue || undefined) as string | string[] | undefined}
                            placeholder={`请选择${field.label}`}
                            options={field.options}
                            onChange={(value) => setDraftValue(value)}
                            style={{ width: "100%" }}
                            getPopupContainer={(node) => node.parentElement || document.body}
                          />
                        ) : (
                          <Input
                            className="task-execution-field-control"
                            type={field.type === "date" ? "date" : field.backendType === "number" ? "number" : "text"}
                            value={Array.isArray(draftValue) ? draftValue.join(",") : draftValue}
                            placeholder={`请输入${field.label}`}
                            onChange={(event) => setDraftValue(event.target.value)}
                          />
                        )}
                        <div className="task-execution-field-actions-inline">
                          <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => confirmEditing(field)}>确认</Button>
                          <Button type="link" size="small" icon={<CloseOutlined />} onClick={() => setEditingKey(null)}>取消</Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={`task-execution-field-value ${!field.value ? "is-placeholder" : ""}`}>
                          {executionFieldDisplayValue(field)}
                        </div>
                        {pending && (
                          <Typography.Text type="danger" className="task-execution-field-hint">
                            {pendingFieldHint(field)}
                          </Typography.Text>
                        )}
                      </>
                    )}
                  </div>
                  {!editing && (
                    <div className="task-execution-field-actions">
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => startEditing(field)}>修改</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
