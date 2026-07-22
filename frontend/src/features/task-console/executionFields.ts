export type ExecutionFieldType = "text" | "date" | "select" | "user";
export type ExecutionFieldSource = "ai" | "default" | "user";
export type ExecutionFieldStatus = "recognized" | "default" | "needs_confirmation" | "missing";

export interface ExecutionField {
  key: string;
  label: string;
  value: string;
  type: ExecutionFieldType;
  required: boolean;
  editable: boolean;
  source: ExecutionFieldSource;
  status: ExecutionFieldStatus;
  backendType: string;
  options?: Array<{ label: string; value: string }>;
}

interface FieldMeta {
  label: string;
  type?: ExecutionFieldType;
  options?: Array<{ label: string; value: string }>;
}

const FIELD_META: Record<string, FieldMeta> = {
  dt: { label: "数据日期", type: "date" },
  scope: {
    label: "数据范围",
    type: "select",
    options: [
      { label: "全部平台", value: "all" },
      { label: "抖音", value: "douyin" },
      { label: "天猫", value: "tmall" },
      { label: "唯品会", value: "vip" },
    ],
  },
  brand_id: {
    label: "品牌",
    type: "select",
    options: [
      { label: "ARENCIA", value: "arencia" },
      { label: "LAUNDRYOU", value: "laundryou" },
    ],
  },
  output_type: {
    label: "输出方式",
    type: "select",
    options: [
      { label: "运营日报", value: "daily_report" },
      { label: "数据明细", value: "data_detail" },
      { label: "管理摘要", value: "management_summary" },
    ],
  },
  receiver_id: { label: "接收对象", type: "user" },
  sku: { label: "商品 SKU" },
  new_price: { label: "调整后价格" },
  shop: { label: "所属店铺" },
  qty: { label: "采购数量" },
  amount: { label: "采购金额" },
  supplier: { label: "供应商" },
  snapshot_id: { label: "补货分析 Snapshot ID" },
};

function yesterdayValue() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function createField(key: string, backendType: string): ExecutionField {
  const meta = FIELD_META[key] || { label: "补充执行信息" };
  return {
    key,
    label: meta.label,
    value: "",
    type: meta.type || (backendType === "date" ? "date" : "text"),
    required: true,
    editable: true,
    source: "user",
    status: "missing",
    backendType,
    options: meta.options,
  };
}

export function buildExecutionFields(schema: Record<string, string>): ExecutionField[] {
  const result = Object.entries(schema).map(([key, backendType]) => createField(key, backendType));

  const dateField = result.find((field) => field.key === "dt");
  if (dateField) Object.assign(dateField, { value: yesterdayValue(), source: "ai", status: "recognized" });

  const scopeField = result.find((field) => field.key === "scope");
  if (scopeField) Object.assign(scopeField, { value: "all", source: "default", status: "default" });

  if (dateField && scopeField) {
    result.push({
      ...createField("output_type", "str"),
      value: "daily_report",
      source: "ai",
      status: "recognized",
    });
    result.push({
      ...createField("brand_id", "str"),
      status: "needs_confirmation",
    });
  }

  return result;
}

export function isExecutionFieldPending(field: ExecutionField) {
  return field.required && (!field.value || field.status === "missing" || field.status === "needs_confirmation");
}

export function pendingFieldHint(field: ExecutionField): string {
  if (field.status === "missing" || !field.value) {
    return field.options?.length ? `请选择${field.label}` : `请填写${field.label}`;
  }
  if (field.status === "needs_confirmation") {
    return `请确认${field.label}`;
  }
  return "";
}

export function executionFieldDisplayValue(field: ExecutionField) {
  if (!field.value) return field.status === "missing" ? "尚未填写" : `请选择${field.label}`;
  const optionLabel = field.options?.find((option) => option.value === field.value)?.label;
  if (optionLabel) return optionLabel;
  if (field.type === "date") {
    const [year, month, day] = field.value.split("-");
    if (year && month && day) return `${year}年${Number(month)}月${Number(day)}日`;
  }
  return field.value;
}
