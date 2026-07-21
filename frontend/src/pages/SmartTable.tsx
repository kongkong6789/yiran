import {
  AppstoreOutlined,
  BarChartOutlined,
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
  importSmartSheetNew,
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

function tagColor(label: unknown) {
  const text = label == null ? "" : String(label);
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h + text.charCodeAt(i) * (i + 1)) % TAG_COLORS.length;
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
  const importFileRef = useRef<HTMLInputElement>(null);

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
      const data = (err as { response?: { data?: { detail?: string; error?: string } } })?.response?.data;
      message.error(data?.error || data?.detail || (err as Error)?.message || "操作失败");
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
    const names: Record<SmartViewType, string> = {
      grid: "表格视图",
      kanban: "看板视图",
      form: "表单视图",
      dashboard: "仪表盘",
    };
    const selectCol = sheet.columns.find((c) => c.field_type === "select");
    const created = await createSmartView(sheet.id, {
      name: names[view_type],
      view_type,
      config: view_type === "kanban" ? { kanban_field: selectCol?.key || "" } : {},
    });
    const detail = await loadSheet(sheet.id);
    setViewId(created.id || detail.views[detail.views.length - 1]?.id || null);
  });

  const openOrCreateDashboard = () => withBusy(async () => {
    if (!sheet) return;
    const existing = (sheet.views || []).find((v) => v.view_type === "dashboard");
    if (existing) {
      setViewId(existing.id);
      return;
    }
    await onAddView("dashboard");
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
    const defaultName = file.name.replace(/\.(xlsx|xlsm|xls|csv|txt)$/i, "").trim() || "导入表格";
    let sheetName = defaultName;
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: "导入为新数据表",
        content: (
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <Typography.Text type="secondary">将按第一行表头新建一张表，列类型默认文本，可稍后在字段配置中修改。</Typography.Text>
            <Input
              defaultValue={defaultName}
              placeholder="新表格名称"
              onChange={(e) => { sheetName = e.target.value; }}
            />
          </div>
        ),
        okText: "导入",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;

    await withBusy(async () => {
      const created = await importSmartSheetNew(file, sheetName.trim() || defaultName);
      await loadList();
      setSheet(created);
      setSheetId(created.id);
      setViewId(created.views[0]?.id ?? null);
      const meta = created.import_meta;
      const kind = meta?.source === "xlsx" ? "Excel" : meta?.source === "xls" ? "Excel(.xls)" : "CSV";
      message.success(`已从${kind}新建「${created.name}」：${meta?.row_count ?? created.rows.length} 行 · ${meta?.column_count ?? created.columns.length} 列`);
    });
  };

  const triggerImport = () => importFileRef.current?.click();

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
          <Space size={2}>
            <Tooltip title="导入 Excel/CSV 为新表">
              <Button type="text" size="small" icon={<UploadOutlined />} onClick={triggerImport} />
            </Tooltip>
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={onCreateSheet} />
          </Space>
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
              <span className="st-side-name">
                {s.name}
                {s.owner_name && !s.is_mine ? (
                  <span className="st-side-owner"> · {s.owner_name}</span>
                ) : null}
              </span>
              <span className="st-side-meta">{s.row_count}</span>
            </button>
          ))}
          {!sheets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无表格" /> : null}
        </div>
        <div className="st-side-foot">
          <button type="button" className="st-dash-entry" onClick={() => void openOrCreateDashboard()} disabled={!sheet}>
            <BarChartOutlined />
            <span>
              <strong>仪表盘</strong>
              <small>{sheet ? "按当前表字段生成图表" : "先选择数据表"}</small>
            </span>
          </button>
        </div>
      </aside>

      <section className="st-main">
        {!sheet ? (
          <div className="st-center">
            <Empty description="创建或导入一张数据表开始">
              <Space>
                <Button type="primary" icon={<PlusOutlined />} onClick={onCreateSheet}>新建数据表</Button>
                <Button icon={<UploadOutlined />} onClick={triggerImport}>导入 Excel/CSV</Button>
              </Space>
            </Empty>
          </div>
        ) : (
          <>
            <header className="st-top">
              <div className="st-crumb">
                <Typography.Title
                  level={5}
                  editable={sheet.can_manage !== false ? {
                    onChange: (name) => void withBusy(async () => {
                      await updateSmartSheet(sheet.id, { name });
                      await loadList();
                      await loadSheet(sheet.id);
                    }),
                  } : false}
                  style={{ margin: 0 }}
                >
                  {sheet.name}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {sheet.rows.length} 条记录
                  {sheet.owner_name ? ` · ${sheet.is_mine ? "我创建的" : sheet.owner_name}` : ""}
                  {sheet.organization_id ? " · 组织内共享" : ""}
                </Typography.Text>
              </div>
              <Space wrap>
                <Tooltip title="刷新">
                  <Button icon={<ReloadOutlined />} loading={busy} onClick={() => void refresh()} />
                </Tooltip>
                <Button icon={<DownloadOutlined />} onClick={() => void onExport()}>导出</Button>
                {sheet.can_manage !== false ? (
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
                ) : null}
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
                  {v.view_type === "kanban" ? <AppstoreOutlined /> : v.view_type === "form" ? <FormOutlined /> : v.view_type === "dashboard" ? <BarChartOutlined /> : <TableOutlined />}
                  {v.name}
                </button>
              ))}
              <Dropdown
                menu={{
                  items: [
                    { key: "grid", label: "表格视图", onClick: () => void onAddView("grid") },
                    { key: "kanban", label: "看板视图", onClick: () => void onAddView("kanban") },
                    { key: "form", label: "表单视图", onClick: () => void onAddView("form") },
                    { key: "dashboard", label: "仪表盘", onClick: () => void onAddView("dashboard") },
                  ],
                }}
              >
                <Button type="text" size="small" icon={<PlusOutlined />} />
              </Dropdown>
            </div>

            <div className="st-toolbar">
              <Space wrap>
                {activeView?.view_type !== "form" && activeView?.view_type !== "dashboard" ? (
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
              ) : activeView?.view_type === "dashboard" ? (
                <DashboardPane
                  columns={sheet.columns}
                  rows={rows}
                  sheetName={sheet.name}
                  charts={normalizeDashCharts(activeView.config?.charts)}
                  onChangeCharts={(charts) => void withBusy(async () => {
                    await updateSmartView(sheet.id, activeView.id, {
                      config: { ...activeView.config, charts },
                    });
                    await loadSheet(sheet.id);
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

      <input
        ref={importFileRef}
        type="file"
        accept=".csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onImportFile(f);
        }}
      />

      <style>{css}</style>
    </div>
  );
}

function filledRate(rows: SmartRow[], col: SmartColumn) {
  if (!rows.length) return 0;
  let filled = 0;
  for (const row of rows) {
    const value = row.values?.[col.key];
    if (col.field_type === "checkbox") {
      if (value === true || value === "true" || value === 1 || value === "1") filled += 1;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length) filled += 1;
    } else if (value != null && String(value).trim() !== "") {
      filled += 1;
    }
  }
  return filled / rows.length;
}

const CHART_PALETTE = ["#3370ff", "#34c724", "#ff8800", "#8b5cf6", "#14b8a6", "#ec4899", "#eab308", "#ef4444"];

type DashChartType = "bar" | "pie" | "line";
type DashAgg = "count" | "sum" | "avg";

type DashChart = {
  id: string;
  title: string;
  chart_type: DashChartType;
  category_field: string;
  value_field: string;
  agg: DashAgg;
};

type DashPoint = { label: string; value: number };

function normalizeDashCharts(raw: unknown): DashChart[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const chart_type = row.chart_type === "pie" || row.chart_type === "line" || row.chart_type === "bar"
      ? row.chart_type
      : "bar";
    const agg = row.agg === "sum" || row.agg === "avg" || row.agg === "count" ? row.agg : "count";
    return {
      id: String(row.id || `chart_${index + 1}`),
      title: String(row.title || ""),
      chart_type,
      category_field: String(row.category_field || ""),
      value_field: String(row.value_field || ""),
      agg,
    };
  });
}

function newDashChart(columns: SmartColumn[]): DashChart {
  const category = columns.find((c) =>
    ["select", "multi_select", "checkbox", "person", "date", "text"].includes(c.field_type),
  );
  const value = columns.find((c) => c.field_type === "number");
  return {
    id: `chart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: "",
    chart_type: "bar",
    category_field: category?.key || "",
    value_field: value?.key || "",
    agg: value ? "sum" : "count",
  };
}

function categoryBuckets(rows: SmartRow[], col: SmartColumn | undefined): string[] {
  if (!col) return [];
  const map = new Map<string, true>();
  const mark = (raw: unknown) => {
    const label = raw == null || raw === "" ? "空" : String(raw);
    map.set(label, true);
  };
  for (const row of rows) {
    const value = row.values?.[col.key];
    if (col.field_type === "multi_select") {
      const items = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
      if (!items.length) mark("");
      else items.forEach(mark);
    } else if (col.field_type === "checkbox") {
      mark(value === true || value === "true" || value === 1 || value === "1" ? "已勾选" : "未勾选");
    } else if (col.field_type === "date") {
      const text = value == null || value === "" ? "空" : String(value).slice(0, 10);
      map.set(text, true);
    } else {
      mark(value);
    }
  }
  const preferred = (col.options || []).map(String).filter(Boolean);
  const ordered: string[] = [];
  for (const opt of preferred) if (map.has(opt)) ordered.push(opt);
  for (const key of map.keys()) if (!ordered.includes(key)) ordered.push(key);
  if (col.field_type === "date") {
    return ordered.sort((a, b) => {
      if (a === "空") return 1;
      if (b === "空") return -1;
      return a.localeCompare(b);
    });
  }
  return ordered;
}

function rowMatchesCategory(row: SmartRow, col: SmartColumn, label: string): boolean {
  const value = row.values?.[col.key];
  if (col.field_type === "multi_select") {
    const items = Array.isArray(value) ? value.map(String) : value == null || value === "" ? [] : [String(value)];
    if (!items.length) return label === "空";
    return items.includes(label);
  }
  if (col.field_type === "checkbox") {
    const checked = value === true || value === "true" || value === 1 || value === "1";
    return label === (checked ? "已勾选" : "未勾选");
  }
  if (col.field_type === "date") {
    const text = value == null || value === "" ? "空" : String(value).slice(0, 10);
    return text === label;
  }
  const text = value == null || value === "" ? "空" : String(value);
  return text === label;
}

function buildChartSeries(
  rows: SmartRow[],
  columns: SmartColumn[],
  chart: DashChart,
): DashPoint[] {
  const categoryCol = columns.find((c) => c.key === chart.category_field);
  const valueCol = columns.find((c) => c.key === chart.value_field);
  if (!categoryCol) return [];
  const buckets = categoryBuckets(rows, categoryCol);
  return buckets.map((label) => {
    const matched = rows.filter((row) => rowMatchesCategory(row, categoryCol, label));
    if (chart.agg === "count" || !valueCol) {
      return { label, value: matched.length };
    }
    const nums = matched
      .map((row) => Number(row.values?.[valueCol.key]))
      .filter((n) => Number.isFinite(n));
    if (!nums.length) return { label, value: 0 };
    if (chart.agg === "avg") {
      return { label, value: nums.reduce((a, b) => a + b, 0) / nums.length };
    }
    return { label, value: nums.reduce((a, b) => a + b, 0) };
  });
}

function chartTitle(chart: DashChart, columns: SmartColumn[]) {
  if (chart.title.trim()) return chart.title.trim();
  const category = columns.find((c) => c.key === chart.category_field)?.title || "未选字段";
  const value = columns.find((c) => c.key === chart.value_field)?.title;
  if (chart.agg === "count" || !value) return `${category} · 计数`;
  const aggLabel = chart.agg === "sum" ? "求和" : "平均";
  return `${category} × ${value}（${aggLabel}）`;
}

function PieChartSvg({ points }: { points: DashPoint[] }) {
  const total = points.reduce((a, b) => a + Math.max(0, b.value), 0);
  if (!total) {
    return <div className="st-chart-empty">暂无数据</div>;
  }
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 68;
  let angle = -Math.PI / 2;
  const slices = points.map((p, idx) => {
    const ratio = Math.max(0, p.value) / total;
    const sweep = ratio * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return {
      ...p,
      color: CHART_PALETTE[idx % CHART_PALETTE.length],
      d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      ratio,
    };
  });
  return (
    <div className="st-chart-pie-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="st-chart-pie">
        {slices.map((s) => (
          <path key={s.label} d={s.d} fill={s.color}>
            <title>{`${s.label}: ${formatNum(s.value)} (${Math.round(s.ratio * 100)}%)`}</title>
          </path>
        ))}
        <circle cx={cx} cy={cy} r={34} fill="var(--st-bg, #fff)" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="st-chart-pie-total">{formatNum(total)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="st-chart-pie-sub">合计</text>
      </svg>
      <div className="st-chart-legend">
        {slices.map((s) => (
          <div key={s.label} className="st-chart-legend-item">
            <i style={{ background: s.color }} />
            <span title={s.label}>{s.label}</span>
            <em>{Math.round(s.ratio * 100)}%</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChartSvg({ points }: { points: DashPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  if (!points.length) return <div className="st-chart-empty">暂无数据</div>;
  return (
    <div className="st-chart-bars">
      {points.map((item, idx) => (
        <div key={item.label} className="st-dash-bar-row">
          <span className="st-dash-bar-label" title={item.label}>{item.label}</span>
          <div className="st-dash-bar-track">
            <div
              className="st-dash-bar-fill"
              style={{
                width: `${(Math.max(0, item.value) / max) * 100}%`,
                background: CHART_PALETTE[idx % CHART_PALETTE.length],
              }}
            />
          </div>
          <span className="st-dash-bar-val">{formatNum(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

function LineChartSvg({ points }: { points: DashPoint[] }) {
  if (!points.length) return <div className="st-chart-empty">暂无数据</div>;
  const w = 360;
  const h = 180;
  const padX = 28;
  const padY = 18;
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = Math.max(1e-6, max - min);
  const coords = points.map((p, i) => {
    const x = padX + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (w - padX * 2));
    const y = h - padY - ((p.value - min) / span) * (h - padY * 2);
    return { ...p, x, y };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const area = `${path} L ${coords[coords.length - 1].x.toFixed(1)} ${(h - padY).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(h - padY).toFixed(1)} Z`;
  return (
    <div className="st-chart-line-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="st-chart-line">
        <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} className="st-chart-axis" />
        <path d={area} className="st-chart-area" />
        <path d={path} className="st-chart-path" />
        {coords.map((c) => (
          <g key={c.label}>
            <circle cx={c.x} cy={c.y} r={3.5} className="st-chart-dot">
              <title>{`${c.label}: ${formatNum(c.value)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="st-chart-line-labels">
        {coords.map((c) => (
          <span key={c.label} title={c.label}>{c.label}</span>
        ))}
      </div>
    </div>
  );
}

function DashboardPane({
  columns,
  rows,
  sheetName,
  charts,
  onChangeCharts,
}: {
  columns: SmartColumn[];
  rows: SmartRow[];
  sheetName: string;
  charts: DashChart[];
  onChangeCharts: (charts: DashChart[]) => void;
}) {
  const [editing, setEditing] = useState<DashChart | null>(null);
  const categoryOptions = columns.filter((c) =>
    ["select", "multi_select", "checkbox", "person", "date", "text"].includes(c.field_type),
  );
  const valueOptions = columns.filter((c) => c.field_type === "number");
  const avgFill = columns.length
    ? columns.reduce((acc, col) => acc + filledRate(rows, col), 0) / columns.length
    : 0;

  const saveEditing = () => {
    if (!editing) return;
    if (!editing.category_field) {
      message.warning("请选择分类字段");
      return;
    }
    const next = charts.some((c) => c.id === editing.id)
      ? charts.map((c) => (c.id === editing.id ? editing : c))
      : [...charts, editing];
    onChangeCharts(next);
    setEditing(null);
  };

  return (
    <div className="st-dash">
      <div className="st-dash-hero">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{sheetName} · 仪表盘</Typography.Title>
          <Typography.Text type="secondary">基于当前筛选后的 {rows.length} 条记录；可自定义折线 / 饼图 / 柱状图</Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditing(newDashChart(columns))}
          disabled={!categoryOptions.length}
        >
          添加图表
        </Button>
      </div>

      <div className="st-dash-kpis">
        <div className="st-dash-kpi">
          <span>记录数</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="st-dash-kpi">
          <span>字段数</span>
          <strong>{columns.length}</strong>
        </div>
        <div className="st-dash-kpi">
          <span>平均填写率</span>
          <strong>{Math.round(avgFill * 100)}%</strong>
        </div>
        <div className="st-dash-kpi">
          <span>自定义图表</span>
          <strong>{charts.length}</strong>
        </div>
      </div>

      {!charts.length ? (
        <Empty
          description={categoryOptions.length ? "还没有图表，点击右上角添加" : "请先添加单选 / 日期 / 文本等可作为分类的字段"}
        >
          {categoryOptions.length ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(newDashChart(columns))}>
              添加图表
            </Button>
          ) : null}
        </Empty>
      ) : (
        <div className="st-dash-grid">
          {charts.map((chart) => {
            const series = buildChartSeries(rows, columns, chart);
            return (
              <section key={chart.id} className="st-dash-card">
                <header>
                  <div className="st-dash-card-title">
                    <strong>{chartTitle(chart, columns)}</strong>
                    <Tag>
                      {chart.chart_type === "pie" ? "饼图" : chart.chart_type === "line" ? "折线图" : "柱状图"}
                    </Tag>
                  </div>
                  <Space size={4}>
                    <Button type="text" size="small" onClick={() => setEditing({ ...chart })}>编辑</Button>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onChangeCharts(charts.filter((c) => c.id !== chart.id))}
                    />
                  </Space>
                </header>
                {chart.chart_type === "pie" ? (
                  <PieChartSvg points={series} />
                ) : chart.chart_type === "line" ? (
                  <LineChartSvg points={series} />
                ) : (
                  <BarChartSvg points={series} />
                )}
              </section>
            );
          })}
        </div>
      )}

      <Modal
        title={editing && charts.some((c) => c.id === editing.id) ? "编辑图表" : "添加图表"}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={saveEditing}
        okText="保存"
        destroyOnClose
      >
        {editing ? (
          <Form layout="vertical">
            <Form.Item label="标题（可选）">
              <Input
                value={editing.title}
                placeholder="留空则自动生成"
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="图表类型" required>
              <Select
                value={editing.chart_type}
                options={[
                  { value: "bar", label: "柱状图" },
                  { value: "pie", label: "饼图" },
                  { value: "line", label: "折线图" },
                ]}
                onChange={(chart_type: DashChartType) => setEditing({ ...editing, chart_type })}
              />
            </Form.Item>
            <Form.Item label="分类字段（X / 扇区）" required>
              <Select
                value={editing.category_field || undefined}
                placeholder="选择字段"
                options={categoryOptions.map((c) => ({
                  value: c.key,
                  label: `${c.title}（${FIELD_LABELS[c.field_type]}）`,
                }))}
                onChange={(category_field: string) => setEditing({ ...editing, category_field })}
              />
            </Form.Item>
            <Form.Item label="数值字段（可选）">
              <Select
                allowClear
                value={editing.value_field || undefined}
                placeholder="不选则按记录数统计"
                options={valueOptions.map((c) => ({ value: c.key, label: c.title }))}
                onChange={(value_field?: string) => setEditing({
                  ...editing,
                  value_field: value_field || "",
                  agg: value_field ? (editing.agg === "count" ? "sum" : editing.agg) : "count",
                })}
              />
            </Form.Item>
            <Form.Item label="聚合方式">
              <Select
                value={editing.value_field ? editing.agg : "count"}
                disabled={!editing.value_field}
                options={[
                  { value: "count", label: "计数" },
                  { value: "sum", label: "求和" },
                  { value: "avg", label: "平均" },
                ]}
                onChange={(agg: DashAgg) => setEditing({ ...editing, agg })}
              />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}

function formatNum(n: number) {
  if (!Number.isFinite(n)) return "-";
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
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
        options={(column.options || []).filter(Boolean).map((o) => ({ value: o, label: <Tag color={tagColor(o)}>{o}</Tag> }))}
        onChange={(v) => onCommit(v || "")}
        optionLabelProp="label"
        popupMatchSelectWidth={false}
      />
    );
  }
  if (column.field_type === "multi_select") {
    const opts = (column.options || []).filter(Boolean).map(String);
    const arr = (Array.isArray(value) ? value : []).map(String).filter(Boolean);
    return (
      <Select
        mode="multiple"
        allowClear
        variant="borderless"
        className="st-cell-input"
        value={arr}
        options={opts.map((o) => ({ value: o, label: o }))}
        onChange={(v) => onCommit(v)}
        tagRender={(props) => {
          const label = props.label ?? props.value;
          if (label == null || label === "") return <span />;
          return (
            <Tag color={tagColor(label)} closable={props.closable} onClose={props.onClose} style={{ marginInlineEnd: 4 }}>
              {label}
            </Tag>
          );
        }}
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
    align-items: stretch;
    padding: 12px 10px 16px;
  }
  .st-dash-entry {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    border: 1px solid var(--st-border);
    border-radius: 10px;
    background: #fff;
    padding: 10px 12px;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .st-dash-entry:hover { border-color: var(--st-accent); background: var(--st-accent-soft); }
  .st-dash-entry:disabled { opacity: 0.55; cursor: not-allowed; }
  .st-dash-entry .anticon { margin-top: 2px; color: var(--st-accent); font-size: 16px; }
  .st-dash-entry span { display: grid; gap: 2px; min-width: 0; }
  .st-dash-entry strong { font-size: 13px; }
  .st-dash-entry small { color: var(--st-muted); font-size: 12px; line-height: 1.35; }
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
  .st-dash {
    height: 100%;
    overflow: auto;
    padding: 16px 18px 28px;
    background: linear-gradient(180deg, #f7f8fa 0%, #fff 140px);
  }
  .st-dash-hero {
    margin-bottom: 14px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .st-dash-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .st-dash-card-title strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st-chart-empty {
    min-height: 120px;
    display: grid;
    place-items: center;
    color: var(--st-muted);
  }
  .st-chart-pie-wrap {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
  }
  .st-chart-pie { width: 180px; height: 180px; }
  .st-chart-pie-total {
    font-size: 16px;
    font-weight: 700;
    fill: var(--st-text, #1f2329);
  }
  .st-chart-pie-sub {
    font-size: 11px;
    fill: var(--st-muted, #646a73);
  }
  .st-chart-legend { display: grid; gap: 6px; }
  .st-chart-legend-item {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }
  .st-chart-legend-item i {
    width: 10px;
    height: 10px;
    border-radius: 999px;
  }
  .st-chart-legend-item span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st-chart-legend-item em {
    font-style: normal;
    color: var(--st-muted);
    font-variant-numeric: tabular-nums;
  }
  .st-chart-bars { display: grid; gap: 8px; }
  .st-chart-line-wrap { display: grid; gap: 6px; }
  .st-chart-line { width: 100%; height: 180px; }
  .st-chart-axis { stroke: rgba(31,35,41,0.16); stroke-width: 1; }
  .st-chart-area { fill: rgba(51, 112, 255, 0.12); }
  .st-chart-path { fill: none; stroke: #3370ff; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
  .st-chart-dot { fill: #3370ff; stroke: #fff; stroke-width: 1.5; }
  .st-chart-line-labels {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 4px;
    color: var(--st-muted);
    font-size: 11px;
  }
  .st-chart-line-labels span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  .st-dash-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .st-dash-kpi {
    border: 1px solid var(--st-border);
    border-radius: 12px;
    background: #fff;
    padding: 14px 16px;
    display: grid;
    gap: 6px;
  }
  .st-dash-kpi span { color: var(--st-muted); font-size: 12px; }
  .st-dash-kpi strong {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .st-dash-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }
  .st-dash-card {
    border: 1px solid var(--st-border);
    border-radius: 12px;
    background: #fff;
    padding: 14px 16px 16px;
    min-height: 180px;
  }
  .st-dash-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
  }
  .st-dash-bars { display: grid; gap: 8px; }
  .st-dash-bar-row {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr) 64px;
    gap: 8px;
    align-items: center;
  }
  .st-dash-bar-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--st-muted);
  }
  .st-dash-bar-track {
    height: 10px;
    border-radius: 999px;
    background: #eef0f3;
    overflow: hidden;
  }
  .st-dash-bar-fill {
    height: 100%;
    border-radius: inherit;
    min-width: 2px;
    transition: width 220ms ease;
  }
  .st-dash-bar-val {
    text-align: right;
    font-variant-numeric: tabular-nums;
    display: grid;
    justify-items: end;
    line-height: 1.15;
  }
  .st-dash-bar-val small { color: var(--st-muted); font-size: 11px; }
  .st-dash-num-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .st-dash-num-grid > div {
    border: 1px solid var(--st-border);
    border-radius: 10px;
    padding: 10px 12px;
    display: grid;
    gap: 4px;
    background: #fafbfc;
  }
  .st-dash-num-grid span { color: var(--st-muted); font-size: 12px; }
  .st-dash-num-grid strong {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
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
    .st-dash-kpis { grid-template-columns: 1fr 1fr; }
  }
`;
