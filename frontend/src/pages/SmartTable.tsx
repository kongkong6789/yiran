import {
  AppstoreOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FilterOutlined,
  FormOutlined,
  HolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  SortAscendingOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createSmartAutomation,
  createSmartColumn,
  createSmartRow,
  createSmartSheet,
  createSmartView,
  deleteSmartAutomation,
  deleteSmartColumn,
  deleteSmartRow,
  deleteSmartSheet,
  exportSmartSheetCsv,
  getSmartSheet,
  importSmartSheetCsv,
  listSmartSheets,
  updateSmartAutomation,
  updateSmartColumn,
  updateSmartRow,
  updateSmartSheet,
  updateSmartView,
  type SmartAutomation,
  type SmartColumn,
  type SmartFieldType,
  type SmartRow,
  type SmartSheetDetail,
  type SmartSheetListItem,
  type SmartViewType,
} from "../api/client";

const FIELD_LABELS: Record<SmartFieldType, string> = {
  text: "文本",
  number: "数字",
  select: "单选",
  multi_select: "多选",
  checkbox: "勾选",
  date: "日期",
  person: "人员",
};

const TAG_COLORS = ["blue", "green", "orange", "purple", "cyan", "magenta", "gold", "red"] as const;

function tagColor(label: string) {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) h = (h + label.charCodeAt(i) * (i + 1)) % TAG_COLORS.length;
  return TAG_COLORS[h];
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

export default function SmartTable() {
  const [sheets, setSheets] = useState<SmartSheetListItem[]>([]);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SmartSheetDetail | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [sortKey, setSortKey] = useState<string>("");
  const [sortAsc, setSortAsc] = useState(true);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [formDraft, setFormDraft] = useState<Record<string, unknown>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const activeView = useMemo(
    () => sheet?.views.find((v) => v.id === viewId) || sheet?.views[0] || null,
    [sheet, viewId],
  );

  const loadList = useCallback(async () => {
    const data = await listSmartSheets();
    setSheets(data.results || []);
    return data.results || [];
  }, []);

  const loadSheet = useCallback(async (id: number) => {
    const detail = await getSmartSheet(id);
    setSheet(detail);
    setSheetId(detail.id);
    setViewId((prev) => {
      if (prev && detail.views.some((v) => v.id === prev)) return prev;
      return detail.views[0]?.id ?? null;
    });
    return detail;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loadList();
      const prefer = sheetId && list.some((s) => s.id === sheetId) ? sheetId : list[0]?.id;
      if (prefer) await loadSheet(prefer);
      else setSheet(null);
    } catch (err: unknown) {
      message.error((err as Error)?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadList, loadSheet, sheetId]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    let list = [...(sheet?.rows || [])];
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter((row) =>
        Object.values(row.values || {}).some((v) => cellText(v).toLowerCase().includes(q)),
      );
    }
    if (sortKey) {
      list.sort((a, b) => {
        const av = cellText(a.values?.[sortKey]);
        const bv = cellText(b.values?.[sortKey]);
        const cmp = av.localeCompare(bv, "zh");
        return sortAsc ? cmp : -cmp;
      });
    }
    return list;
  }, [sheet, filterText, sortKey, sortAsc]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || (err as Error)?.message
        || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const onCreateSheet = () => {
    let name = "未命名表格";
    Modal.confirm({
      title: "新建数据表",
      content: (
        <Input
          defaultValue={name}
          placeholder="表格名称"
          onChange={(e) => {
            name = e.target.value;
          }}
        />
      ),
      onOk: () => withBusy(async () => {
        const created = await createSmartSheet({ name: name.trim() || "未命名表格" });
        await loadList();
        await loadSheet(created.id);
        message.success("已创建");
      }),
    });
  };

  const onAddRow = () => withBusy(async () => {
    if (!sheet) return;
    await createSmartRow(sheet.id, {});
    await loadSheet(sheet.id);
  });

  const onPatchCell = (row: SmartRow, key: string, value: unknown) => withBusy(async () => {
    if (!sheet) return;
    await updateSmartRow(sheet.id, row.id, { values: { [key]: value } });
    await loadSheet(sheet.id);
  });

  const onAddColumn = (field_type: SmartFieldType) => withBusy(async () => {
    if (!sheet) return;
    await createSmartColumn(sheet.id, {
      title: FIELD_LABELS[field_type],
      field_type,
      options: field_type === "select" || field_type === "multi_select" ? ["选项A", "选项B"] : [],
    });
    await loadSheet(sheet.id);
    setFieldOpen(false);
  });

  const onAddView = (view_type: SmartViewType) => withBusy(async () => {
    if (!sheet) return;
    const names: Record<SmartViewType, string> = { grid: "表格视图", kanban: "看板视图", form: "表单视图" };
    const selectCol = sheet.columns.find((c) => c.field_type === "select");
    const created = await createSmartView(sheet.id, {
      name: names[view_type],
      view_type,
      config: view_type === "kanban" ? { kanban_field: selectCol?.key || "" } : {},
    });
    const detail = await loadSheet(sheet.id);
    setViewId(created.id || detail.views[detail.views.length - 1]?.id || null);
  });

  const onExport = () => withBusy(async () => {
    if (!sheet) return;
    const blob = await exportSmartSheetCsv(sheet.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.name || "sheet"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const onImportFile = async (file: File) => {
    if (!sheet) return;
    const text = await file.text();
    await withBusy(async () => {
      const res = await importSmartSheetCsv(sheet.id, text);
      await loadSheet(sheet.id);
      message.success(`已导入 ${res.created} 条记录`);
    });
  };

  if (loading && !sheet) {
    return (
      <div className="st-root st-center">
        <Spin size="large" />
        <style>{css}</style>
      </div>
    );
  }

  return (
    <div className="st-root">
      <aside className="st-side">
        <div className="st-side-head">
          <Typography.Text strong>数据表</Typography.Text>
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={onCreateSheet} />
        </div>
        <div className="st-side-list">
          {sheets.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`st-side-item${s.id === sheetId ? " is-active" : ""}`}
              onClick={() => void withBusy(async () => { await loadSheet(s.id); })}
            >
              <TableOutlined />
              <span className="st-side-name">{s.name}</span>
              <span className="st-side-meta">{s.row_count}</span>
            </button>
          ))}
          {!sheets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无表格" /> : null}
        </div>
        <div className="st-side-foot">
          <Typography.Text type="secondary">仪表盘</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0", fontSize: 12 }}>
            后续版本支持图表看板
          </Typography.Paragraph>
        </div>
      </aside>

      <section className="st-main">
        {!sheet ? (
          <div className="st-center">
            <Empty description="创建一张数据表开始">
              <Button type="primary" icon={<PlusOutlined />} onClick={onCreateSheet}>新建数据表</Button>
            </Empty>
          </div>
        ) : (
          <>
            <header className="st-top">
              <div className="st-crumb">
                <Typography.Title
                  level={5}
                  editable={{
                    onChange: (name) => void withBusy(async () => {
                      await updateSmartSheet(sheet.id, { name });
                      await loadList();
                      await loadSheet(sheet.id);
                    }),
                  }}
                  style={{ margin: 0 }}
                >
                  {sheet.name}
                </Typography.Title>
                <Typography.Text type="secondary">{sheet.rows.length} 条记录</Typography.Text>
              </div>
              <Space wrap>
                <Tooltip title="刷新">
                  <Button icon={<ReloadOutlined />} loading={busy} onClick={() => void refresh()} />
                </Tooltip>
                <Button icon={<DownloadOutlined />} onClick={() => void onExport()}>导出</Button>
                <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>导入</Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void onImportFile(f);
                  }}
                />
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    Modal.confirm({
                      title: `删除「${sheet.name}」？`,
                      onOk: () => withBusy(async () => {
                        await deleteSmartSheet(sheet.id);
                        setSheetId(null);
                        await refresh();
                      }),
                    });
                  }}
                />
              </Space>
            </header>

            <div className="st-tabs">
              {(sheet.views || []).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`st-tab${v.id === activeView?.id ? " is-active" : ""}`}
                  onClick={() => setViewId(v.id)}
                >
                  {v.view_type === "kanban" ? <AppstoreOutlined /> : v.view_type === "form" ? <FormOutlined /> : <TableOutlined />}
                  {v.name}
                </button>
              ))}
              <Dropdown
                menu={{
                  items: [
                    { key: "grid", label: "表格视图", onClick: () => void onAddView("grid") },
                    { key: "kanban", label: "看板视图", onClick: () => void onAddView("kanban") },
                    { key: "form", label: "表单视图", onClick: () => void onAddView("form") },
                  ],
                }}
              >
                <Button type="text" size="small" icon={<PlusOutlined />} />
              </Dropdown>
            </div>

            <div className="st-toolbar">
              <Space wrap>
                {activeView?.view_type !== "form" ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => void onAddRow()}>添加记录</Button>
                ) : null}
                <Button icon={<SettingOutlined />} onClick={() => setFieldOpen(true)}>字段配置</Button>
                <Input
                  allowClear
                  prefix={<FilterOutlined />}
                  placeholder="筛选内容"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  style={{ width: 180 }}
                />
                <Select
                  allowClear
                  placeholder="排序字段"
                  style={{ width: 140 }}
                  value={sortKey || undefined}
                  onChange={(v) => setSortKey(v || "")}
                  options={sheet.columns.map((c) => ({ value: c.key, label: c.title }))}
                />
                <Button
                  icon={<SortAscendingOutlined />}
                  onClick={() => setSortAsc((x) => !x)}
                >
                  {sortAsc ? "升序" : "降序"}
                </Button>
                <Button icon={<ThunderboltOutlined />} onClick={() => setAutoOpen(true)}>自动化</Button>
              </Space>
              {activeView?.view_type === "kanban" ? (
                <Select
                  style={{ width: 160 }}
                  placeholder="看板分组字段"
                  value={String(activeView.config?.kanban_field || "") || undefined}
                  options={sheet.columns.filter((c) => c.field_type === "select").map((c) => ({ value: c.key, label: c.title }))}
                  onChange={(key) => void withBusy(async () => {
                    await updateSmartView(sheet.id, activeView.id, {
                      config: { ...activeView.config, kanban_field: key },
                    });
                    await loadSheet(sheet.id);
                  })}
                />
              ) : null}
            </div>

            <div className="st-body">
              {activeView?.view_type === "kanban" ? (
                <KanbanBoard
                  columns={sheet.columns}
                  rows={rows}
                  groupKey={String(activeView.config?.kanban_field || "")}
                  onMove={(row, value) => void onPatchCell(row, String(activeView.config?.kanban_field || ""), value)}
                  onDelete={(row) => void withBusy(async () => {
                    await deleteSmartRow(sheet.id, row.id);
                    await loadSheet(sheet.id);
                  })}
                />
              ) : activeView?.view_type === "form" ? (
                <FormPane
                  columns={sheet.columns}
                  draft={formDraft}
                  setDraft={setFormDraft}
                  onSubmit={() => withBusy(async () => {
                    await createSmartRow(sheet.id, formDraft);
                    setFormDraft({});
                    await loadSheet(sheet.id);
                    message.success("已提交");
                  })}
                />
              ) : (
                <GridTable
                  columns={sheet.columns}
                  rows={rows}
                  onChange={onPatchCell}
                  onReorderColumns={(ordered) => void withBusy(async () => {
                    // Persist new column order as contiguous positions.
                    await Promise.all(
                      ordered.map((col, index) =>
                        updateSmartColumn(sheet.id, col.id, { position: index }),
                      ),
                    );
                    await loadSheet(sheet.id);
                  })}
                  onDeleteRow={(row) => void withBusy(async () => {
                    await deleteSmartRow(sheet.id, row.id);
                    await loadSheet(sheet.id);
                  })}
                />
              )}
            </div>
          </>
        )}
      </section>

      <Modal
        title="字段配置"
        open={fieldOpen}
        onCancel={() => setFieldOpen(false)}
        footer={null}
        width={640}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          {(Object.keys(FIELD_LABELS) as SmartFieldType[]).map((ft) => (
            <Button key={ft} size="small" onClick={() => void onAddColumn(ft)}>
              + {FIELD_LABELS[ft]}
            </Button>
          ))}
        </Space>
        <div className="st-field-list">
          {(sheet?.columns || []).map((col) => (
            <div key={col.id} className="st-field-row">
              <Input
                value={col.title}
                onBlur={(e) => {
                  const title = e.target.value.trim();
                  if (!sheet || !title || title === col.title) return;
                  void withBusy(async () => {
                    await updateSmartColumn(sheet.id, col.id, { title });
                    await loadSheet(sheet.id);
                  });
                }}
                onChange={(e) => {
                  setSheet((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      columns: prev.columns.map((c) => (c.id === col.id ? { ...c, title: e.target.value } : c)),
                    };
                  });
                }}
              />
              <Tag>{FIELD_LABELS[col.field_type]}</Tag>
              {(col.field_type === "select" || col.field_type === "multi_select") ? (
                <Input
                  placeholder="选项，逗号分隔"
                  defaultValue={(col.options || []).join(",")}
                  onBlur={(e) => {
                    if (!sheet) return;
                    const options = e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
                    void withBusy(async () => {
                      await updateSmartColumn(sheet.id, col.id, { options });
                      await loadSheet(sheet.id);
                    });
                  }}
                />
              ) : <span />}
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => void withBusy(async () => {
                  if (!sheet) return;
                  await deleteSmartColumn(sheet.id, col.id);
                  await loadSheet(sheet.id);
                })}
              />
            </div>
          ))}
        </div>
      </Modal>

      <AutomationModal
        open={autoOpen}
        sheet={sheet}
        onClose={() => setAutoOpen(false)}
        onRefresh={() => { if (sheet) return loadSheet(sheet.id); }}
      />

      <style>{css}</style>
    </div>
  );
}

function GridTable({
  columns,
  rows,
  onChange,
  onReorderColumns,
  onDeleteRow,
}: {
  columns: SmartColumn[];
  rows: SmartRow[];
  onChange: (row: SmartRow, key: string, value: unknown) => void;
  onReorderColumns: (ordered: SmartColumn[]) => void;
  onDeleteRow: (row: SmartRow) => void;
}) {
  const [ordered, setOrdered] = useState(columns);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const resizingRef = useRef<{ id: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    setOrdered(columns);
  }, [columns]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cur = resizingRef.current;
      if (!cur) return;
      const next = Math.max(120, Math.min(480, cur.startW + (e.clientX - cur.startX)));
      setWidths((prev) => ({ ...prev, [cur.id]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.body.classList.remove("st-resizing");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const moveColumn = (fromId: number, toId: number) => {
    if (fromId === toId) return ordered;
    const next = [...ordered];
    const from = next.findIndex((c) => c.id === fromId);
    const to = next.findIndex((c) => c.id === toId);
    if (from < 0 || to < 0) return ordered;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  return (
    <div className="st-grid-wrap">
      <table className="st-grid">
        <thead>
          <tr>
            <th className="st-idx">#</th>
            {ordered.map((col) => (
              <th
                key={col.id}
                className={[
                  "st-col-head",
                  dragId === col.id ? "is-dragging" : "",
                  overId === col.id && dragId !== col.id ? "is-drop-target" : "",
                ].filter(Boolean).join(" ")}
                style={{ width: widths[col.id] || 168, minWidth: widths[col.id] || 168 }}
                draggable
                onDragStart={(e) => {
                  setDragId(col.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(col.id));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overId !== col.id) setOverId(col.id);
                }}
                onDragLeave={() => {
                  if (overId === col.id) setOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromId = Number(e.dataTransfer.getData("text/plain") || dragId || 0);
                  const next = moveColumn(fromId, col.id);
                  setOrdered(next);
                  setDragId(null);
                  setOverId(null);
                  onReorderColumns(next);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
              >
                <div className="st-col-head-inner">
                  <span className="st-drag-handle" title="拖动调整列顺序" aria-label={`拖动列 ${col.title}`}>
                    <HolderOutlined />
                  </span>
                  <span className="st-col-title">{col.title}</span>
                  <span className="st-col-type">{FIELD_LABELS[col.field_type]}</span>
                </div>
                <span
                  className="st-col-resizer"
                  title="拖动调整列宽"
                  aria-label={`调整列宽 ${col.title}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const th = (e.currentTarget.parentElement as HTMLElement | null);
                    const startW = th?.getBoundingClientRect().width || widths[col.id] || 168;
                    resizingRef.current = { id: col.id, startX: e.clientX, startW };
                    document.body.classList.add("st-resizing");
                  }}
                  onDragStart={(e) => e.preventDefault()}
                />
              </th>
            ))}
            <th className="st-ops" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id}>
              <td className="st-idx">{idx + 1}</td>
              {ordered.map((col) => (
                <td
                  key={col.id}
                  style={{ width: widths[col.id] || 168, minWidth: widths[col.id] || 168 }}
                >
                  <CellEditor
                    column={col}
                    value={row.values?.[col.key]}
                    onCommit={(v) => onChange(row, col.key, v)}
                  />
                </td>
              ))}
              <td className="st-ops">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="删除记录"
                  onClick={() => onDeleteRow(row)}
                />
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={ordered.length + 2}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录，点击上方「添加记录」" />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function CellEditor({
  column,
  value,
  onCommit,
}: {
  column: SmartColumn;
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  if (column.field_type === "checkbox") {
    return (
      <Checkbox
        checked={Boolean(value)}
        onChange={(e) => onCommit(e.target.checked)}
      />
    );
  }
  if (column.field_type === "number") {
    return (
      <InputNumber
        controls={false}
        variant="borderless"
        className="st-cell-input"
        value={typeof value === "number" ? value : value == null || value === "" ? null : Number(value)}
        onChange={(v) => onCommit(v)}
      />
    );
  }
  if (column.field_type === "date") {
    return (
      <DatePicker
        variant="borderless"
        className="st-cell-input"
        value={value ? dayjs(String(value)) : null}
        onChange={(d) => onCommit(d ? d.format("YYYY-MM-DD") : "")}
      />
    );
  }
  if (column.field_type === "select") {
    return (
      <Select
        allowClear
        variant="borderless"
        className="st-cell-input"
        value={value ? String(value) : undefined}
        options={(column.options || []).map((o) => ({ value: o, label: <Tag color={tagColor(o)}>{o}</Tag> }))}
        onChange={(v) => onCommit(v || "")}
        optionLabelProp="label"
        popupMatchSelectWidth={false}
      />
    );
  }
  if (column.field_type === "multi_select") {
    const arr = Array.isArray(value) ? value.map(String) : [];
    return (
      <Select
        mode="multiple"
        allowClear
        variant="borderless"
        className="st-cell-input"
        value={arr}
        options={(column.options || []).map((o) => ({ value: o, label: o }))}
        onChange={(v) => onCommit(v)}
        tagRender={(props) => (
          <Tag color={tagColor(props.value as string)} closable={props.closable} onClose={props.onClose} style={{ marginInlineEnd: 4 }}>
            {props.label}
          </Tag>
        )}
      />
    );
  }
  return (
    <Input
      variant="borderless"
      className="st-cell-input"
      defaultValue={cellText(value)}
      key={`${column.key}:${cellText(value)}`}
      onBlur={(e) => {
        if (e.target.value !== cellText(value)) onCommit(e.target.value);
      }}
      onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
    />
  );
}

function KanbanBoard({
  columns,
  rows,
  groupKey,
  onMove,
  onDelete,
}: {
  columns: SmartColumn[];
  rows: SmartRow[];
  groupKey: string;
  onMove: (row: SmartRow, value: string) => void;
  onDelete: (row: SmartRow) => void;
}) {
  const groupCol = columns.find((c) => c.key === groupKey);
  const buckets = groupCol?.options?.length ? groupCol.options : ["未分组"];
  const titleCol = columns[0];

  if (!groupKey || !groupCol) {
    return <Empty description="请先在右上角选择看板分组字段（单选）" />;
  }

  return (
    <div className="st-kanban">
      {buckets.map((bucket) => {
        const items = rows.filter((r) => String(r.values?.[groupKey] || "") === bucket);
        return (
          <div key={bucket} className="st-kanban-col">
            <div className="st-kanban-head">
              <Tag color={tagColor(bucket)}>{bucket}</Tag>
              <span>{items.length}</span>
            </div>
            <div className="st-kanban-list">
              {items.map((row) => (
                <div key={row.id} className="st-kanban-card">
                  <div className="st-kanban-title">{cellText(row.values?.[titleCol?.key || ""]) || `记录 #${row.id}`}</div>
                  <Space wrap size={[4, 4]}>
                    {buckets.filter((b) => b !== bucket).map((b) => (
                      <Button key={b} size="small" type="link" onClick={() => onMove(row, b)}>{b}</Button>
                    ))}
                    <Button size="small" type="link" danger onClick={() => onDelete(row)}>删除</Button>
                  </Space>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FormPane({
  columns,
  draft,
  setDraft,
  onSubmit,
}: {
  columns: SmartColumn[];
  draft: Record<string, unknown>;
  setDraft: (v: Record<string, unknown>) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="st-form">
      <Typography.Title level={4}>填写表单</Typography.Title>
      <Form layout="vertical" onFinish={onSubmit}>
        {columns.map((col) => (
          <Form.Item key={col.id} label={col.title}>
            <CellEditor
              column={col}
              value={draft[col.key]}
              onCommit={(v) => setDraft({ ...draft, [col.key]: v })}
            />
          </Form.Item>
        ))}
        <Button type="primary" htmlType="submit">提交</Button>
      </Form>
    </div>
  );
}

function AutomationModal({
  open,
  sheet,
  onClose,
  onRefresh,
}: {
  open: boolean;
  sheet: SmartSheetDetail | null;
  onClose: () => void;
  onRefresh: () => Promise<SmartSheetDetail | void> | void;
}) {
  const [name, setName] = useState("新建时自动填状态");
  const [field, setField] = useState("");
  const [value, setValue] = useState("未开始");

  useEffect(() => {
    const first = sheet?.columns.find((c) => c.field_type === "select") || sheet?.columns[0];
    setField(first?.key || "");
  }, [sheet]);

  return (
    <Modal title="自动化" open={open} onCancel={onClose} footer={null} width={560}>
      <Typography.Paragraph type="secondary">
        当前支持：新增/更新记录时自动写入某个字段。
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        {(sheet?.automations || []).map((rule: SmartAutomation) => (
          <div key={rule.id} className="st-auto-row">
            <div>
              <Typography.Text strong>{rule.name}</Typography.Text>
              <div>
                <Tag>{rule.trigger === "row_created" ? "新增时" : "更新时"}</Tag>
                <Tag color={rule.enabled ? "green" : "default"}>{rule.enabled ? "启用" : "停用"}</Tag>
              </div>
            </div>
            <Space>
              <Button
                size="small"
                onClick={() => void (async () => {
                  if (!sheet) return;
                  await updateSmartAutomation(sheet.id, rule.id, { enabled: !rule.enabled });
                  await onRefresh();
                })()}
              >
                {rule.enabled ? "停用" : "启用"}
              </Button>
              <Button
                size="small"
                danger
                onClick={() => void (async () => {
                  if (!sheet) return;
                  await deleteSmartAutomation(sheet.id, rule.id);
                  await onRefresh();
                })()}
              >
                删除
              </Button>
            </Space>
          </div>
        ))}
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名称" />
        <Select
          style={{ width: "100%" }}
          value={field || undefined}
          options={(sheet?.columns || []).map((c) => ({ value: c.key, label: c.title }))}
          onChange={setField}
          placeholder="写入字段"
        />
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="写入值" />
        <Button
          type="primary"
          onClick={() => void (async () => {
            if (!sheet || !field) return;
            await createSmartAutomation(sheet.id, {
              name,
              trigger: "row_created",
              action: "set_field",
              config: { field, value },
              enabled: true,
            });
            await onRefresh();
            message.success("已添加自动化");
          })()}
        >
          添加规则
        </Button>
      </Space>
    </Modal>
  );
}

const css = `
  .st-root {
    --st-border: rgba(31, 35, 41, 0.12);
    --st-border-strong: rgba(31, 35, 41, 0.18);
    --st-bg: var(--lc-bg, #fff);
    --st-elev: #f5f6f7;
    --st-text: var(--lc-text, #1f2329);
    --st-muted: #646a73;
    --st-accent: #3370ff;
    --st-accent-soft: rgba(51, 112, 255, 0.08);
    --st-row-hover: rgba(31, 35, 41, 0.03);
    height: calc(100dvh - 64px);
    display: grid;
    grid-template-columns: 232px 1fr;
    background: var(--st-bg);
    color: var(--st-text);
    font-size: 13px;
  }
  .st-center {
    height: 100%;
    display: grid;
    place-items: center;
    gap: 12px;
  }
  .st-side {
    border-right: 1px solid var(--st-border);
    display: flex;
    flex-direction: column;
    background: #f8f9fa;
    min-width: 0;
  }
  .st-side-head, .st-side-foot {
    padding: 14px 14px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .st-side-foot {
    border-top: 1px solid var(--st-border);
    flex-direction: column;
    align-items: flex-start;
    padding-bottom: 16px;
  }
  .st-side-list { flex: 1; overflow: auto; padding: 4px 8px 12px; }
  .st-side-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    border-radius: 8px;
    padding: 9px 10px;
    cursor: pointer;
    color: inherit;
    text-align: left;
    transition: background 160ms ease, color 160ms ease;
  }
  .st-side-item:hover { background: rgba(31, 35, 41, 0.06); }
  .st-side-item.is-active {
    background: var(--st-accent-soft);
    color: var(--st-accent);
    font-weight: 600;
  }
  .st-side-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st-side-meta { color: var(--st-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .st-main { min-width: 0; display: flex; flex-direction: column; background: var(--st-bg); }
  .st-top {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 16px 10px; border-bottom: 1px solid var(--st-border);
  }
  .st-crumb { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .st-tabs {
    display: flex; align-items: center; gap: 2px; padding: 0 10px;
    border-bottom: 1px solid var(--st-border); overflow-x: auto;
    background: #fafbfc;
  }
  .st-tab {
    border: 0; background: transparent; cursor: pointer; color: var(--st-muted);
    display: inline-flex; align-items: center; gap: 6px;
    padding: 11px 12px; border-bottom: 2px solid transparent; white-space: nowrap;
    border-radius: 8px 8px 0 0; transition: color 160ms ease, background 160ms ease;
  }
  .st-tab:hover { color: var(--st-text); background: rgba(31,35,41,0.04); }
  .st-tab.is-active {
    color: var(--st-accent);
    border-bottom-color: var(--st-accent);
    font-weight: 600;
    background: var(--st-bg);
  }
  .st-toolbar {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 16px; border-bottom: 1px solid var(--st-border); flex-wrap: wrap;
    background: var(--st-bg);
  }
  .st-body { flex: 1; min-height: 0; overflow: auto; background: var(--st-bg); }
  .st-grid-wrap { overflow: auto; height: 100%; }
  .st-grid {
    border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%;
  }
  .st-grid th, .st-grid td {
    border-bottom: 1px solid var(--st-border);
    border-right: 1px solid var(--st-border);
    padding: 0; height: 38px; vertical-align: middle;
    background: var(--st-bg);
  }
  .st-grid tbody tr:hover td { background: var(--st-row-hover); }
  .st-grid th {
    position: sticky; top: 0; z-index: 2;
    background: #f5f6f7; text-align: left; font-weight: 600;
    box-shadow: inset 0 -1px 0 var(--st-border);
    user-select: none;
  }
  .st-col-head {
    position: relative;
    padding: 0 !important;
  }
  .st-col-head-inner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 6px;
    min-height: 38px;
    cursor: grab;
  }
  .st-col-head.is-dragging {
    opacity: 0.45;
  }
  .st-col-head.is-drop-target {
    box-shadow: inset 2px 0 0 var(--st-accent);
    background: var(--st-accent-soft) !important;
  }
  .st-drag-handle {
    color: #8f959e;
    display: inline-flex;
    width: 18px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    flex: 0 0 auto;
  }
  .st-col-head:hover .st-drag-handle { color: var(--st-text); background: rgba(31,35,41,0.06); }
  .st-col-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st-col-type {
    color: var(--st-muted);
    font-size: 11px;
    font-weight: 500;
    flex: 0 0 auto;
  }
  .st-col-resizer {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 3;
  }
  .st-col-resizer::after {
    content: "";
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: 2px;
    width: 2px;
    border-radius: 1px;
    background: transparent;
  }
  .st-col-head:hover .st-col-resizer::after,
  body.st-resizing .st-col-resizer::after { background: var(--st-accent); }
  body.st-resizing, body.st-resizing * { cursor: col-resize !important; user-select: none !important; }
  .st-idx, .st-ops {
    min-width: 44px !important; width: 44px; text-align: center;
    padding: 0 6px !important; color: var(--st-muted);
    font-variant-numeric: tabular-nums;
  }
  .st-idx { position: sticky; left: 0; z-index: 1; background: var(--st-bg); }
  .st-grid thead .st-idx { z-index: 3; background: #f5f6f7; }
  .st-grid tbody tr:hover .st-idx { background: #f0f1f2; }
  .st-cell-input { width: 100%; }
  .st-cell-input .ant-select-selector,
  .st-cell-input.ant-input,
  .st-cell-input.ant-input-number,
  .st-cell-input.ant-picker {
    width: 100% !important;
    border-radius: 0 !important;
    min-height: 36px;
  }
  .st-cell-input .ant-select-selector { padding-inline: 8px !important; }
  .st-cell-input.ant-input { padding-inline: 10px; }
  .st-kanban {
    display: flex; gap: 12px; padding: 16px; align-items: flex-start; overflow-x: auto; height: 100%;
    background: #f5f6f7;
  }
  .st-kanban-col {
    width: 268px; flex: 0 0 268px; background: #eef0f2;
    border: 1px solid transparent; border-radius: 10px; min-height: 240px;
  }
  .st-kanban-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 12px;
  }
  .st-kanban-list { padding: 0 10px 10px; display: grid; gap: 8px; }
  .st-kanban-card {
    background: var(--st-bg); border: 1px solid var(--st-border);
    border-radius: 8px; padding: 12px;
    box-shadow: 0 1px 2px rgba(31,35,41,0.04);
    transition: box-shadow 160ms ease, transform 160ms ease;
  }
  .st-kanban-card:hover { box-shadow: 0 4px 12px rgba(31,35,41,0.08); }
  .st-kanban-title { font-weight: 600; margin-bottom: 8px; line-height: 1.4; }
  .st-form {
    max-width: 560px; margin: 28px auto; padding: 24px;
    border: 1px solid var(--st-border); border-radius: 12px; background: var(--st-bg);
  }
  .st-field-list { display: grid; gap: 8px; }
  .st-field-row { display: grid; grid-template-columns: 1fr auto 1.2fr auto; gap: 8px; align-items: center; }
  .st-auto-row {
    display: flex; justify-content: space-between; gap: 12px; align-items: center;
    padding: 10px 12px; border: 1px solid var(--st-border); border-radius: 8px;
    background: #fafbfc;
  }
  @media (prefers-reduced-motion: reduce) {
    .st-side-item, .st-tab, .st-kanban-card { transition: none; }
  }
  @media (max-width: 900px) {
    .st-root { grid-template-columns: 1fr; }
    .st-side { display: none; }
    .st-field-row { grid-template-columns: 1fr; }
  }
`;
