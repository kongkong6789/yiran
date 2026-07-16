import type { LoopLevel } from "./types";
import { LEVEL_LABEL } from "./types";

/** 与后端 commerce_schema.LOOP_LEVEL_OBJECT 对齐（知行一期） */
export const LOOP_LEVEL_ONTOLOGY: Record<
  LoopLevel,
  { typeKey: string; otype: string; description: string }
> = {
  company: {
    typeKey: "Organization",
    otype: "公司",
    description: "代理经营公司 / ERP 组织",
  },
  brand: {
    typeKey: "Brand",
    otype: "品牌",
    description: "品牌或产品线",
  },
  platform: {
    typeKey: "Channel",
    otype: "平台",
    description: "天猫 / 抖音 / 京东等销售平台",
  },
  channel: {
    typeKey: "Shop",
    otype: "店铺",
    description: "平台内具体店铺或账号",
  },
  link: {
    typeKey: "Product",
    otype: "链接",
    description: "商品详情页（多 SKU 组合）",
  },
  sku: {
    typeKey: "SKU",
    otype: "SKU",
    description: "可售规格编码",
  },
};

export const CONTAINMENT_LABELS: { from: LoopLevel; to: LoopLevel; label: string }[] = [
  { from: "company", to: "brand", label: "包含品牌" },
  { from: "brand", to: "platform", label: "包含平台" },
  { from: "platform", to: "channel", label: "包含店铺" },
  { from: "channel", to: "link", label: "包含链接" },
  { from: "link", to: "sku", label: "包含SKU" },
];

export function hubDisplayName(level: LoopLevel): string {
  const ont = LOOP_LEVEL_ONTOLOGY[level];
  return `${LEVEL_LABEL[level]}（${ont.otype}）`;
}
