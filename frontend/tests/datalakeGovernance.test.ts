import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../src/features/knowledge/EnterpriseData.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
const knowledgeSource = readFileSync(new URL("../src/pages/Knowledge.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("data lake exposes the governed sales-ledger workflow in the existing page", () => {
  for (const label of ["新建映射", "上传销售账", "完成对账", "组合补货 Snapshot"]) {
    assert.match(pageSource, new RegExp(label));
  }
  assert.match(pageSource, /yiran_governed_raw_manifest_v1/);
  assert.match(pageSource, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(pageSource, /row\.reconciliation_status === "pending"/);
});

test("data lake client keeps every mutation under the Django api boundary", () => {
  for (const route of [
    "/datalake/reference-mappings/",
    "/datalake/raw-imports/sales-ledger/",
    "/datalake/snapshots/compose/",
  ]) {
    assert.match(clientSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(pageSource, /127\.0\.0\.1:2024|127\.0\.0\.1:3000/);
});

test("a composite snapshot can launch inventory analysis in the existing work page", () => {
  assert.match(pageSource, /source_system === "composite_inventory_sales"/);
  assert.match(pageSource, /\/work\?intent=inventory-reorder&snapshot_id=/);
  assert.match(pageSource, /发起补货分析/);
});

test("enterprise data lives inside knowledge and the legacy route only redirects", () => {
  assert.match(knowledgeSource, /tab"\) === "enterprise-data"/);
  assert.match(knowledgeSource, /<EnterpriseData \/>/);
  assert.match(knowledgeSource, /文档知识/);
  assert.match(knowledgeSource, /企业数据/);
  assert.match(appSource, /path="datalake" element={<Navigate to="\/knowledge\?tab=enterprise-data" replace \/>}/);
  assert.doesNotMatch(appSource, /import DataLake/);
});
