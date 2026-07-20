import type { OntGraph, OntObject } from "../api/client";

/** 经营图谱关心的对象类型（与 CompanyHierarchyDiagram 一致） */
export const COMMERCE_OTYPES = new Set([
  "公司",
  "品牌",
  "平台",
  "店铺",
  "链接",
  "商品",
  "SKU",
  "指标定义",
  "指标快照",
  "销售明细",
  "店铺日汇总",
  "商品日汇总",
  "异常预警",
]);

const SYSTEM_TABLE_PREFIXES = ["auth.", "authtoken.", "django."];

export function isCommerceObject(object: OntObject): boolean {
  if (COMMERCE_OTYPES.has(object.otype)) return true;
  const table = String(object.attributes?._table || "");
  if (SYSTEM_TABLE_PREFIXES.some((prefix) => table.startsWith(prefix))) return false;
  if (table.startsWith("lake.")) return true;
  return false;
}

export function filterCommerceObjects(objects: OntObject[]): OntObject[] {
  return objects.filter(isCommerceObject);
}

export function summarizeCommerceGraph(graph: OntGraph | null) {
  if (!graph) {
    return { objects: 0, relations: 0, commerceObjects: [] as OntObject[] };
  }
  const commerceObjects = filterCommerceObjects(graph.objects);
  const commerceIds = new Set(commerceObjects.map((object) => object.id));
  const relations = graph.relations.filter(
    (relation) => commerceIds.has(relation.source) && commerceIds.has(relation.target),
  );
  return {
    objects: commerceObjects.length,
    relations: relations.length,
    commerceObjects,
  };
}
