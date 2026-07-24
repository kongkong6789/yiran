import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agentsPage = readFileSync(new URL("../src/pages/Agents.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../src/pages/AgentDashboard.tsx", import.meta.url), "utf8");
const apiClient = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");

test("agent directory renders only API-backed agents", () => {
  assert.doesNotMatch(agentsPage, /DEMO_AGENTS/);
  assert.match(agentsPage, /setAgents\(data\.results\)/);
  assert.match(agentsPage, /setPermissions\(data\.permissions\)/);
  assert.match(agentsPage, /permissions\.can_create/);
  assert.match(agentsPage, /agent\.can_manage/);
  assert.match(agentsPage, /agents-directory-workspace/);
});

test("agent dashboard loads a real agent detail and has no fake profile fallback", () => {
  assert.doesNotMatch(dashboardPage, /FALLBACK_AGENT/);
  assert.match(dashboardPage, /getAgent\(requestedId\)/);
  assert.match(dashboardPage, /智能体不存在、已归档或你没有访问权限/);
  assert.match(dashboardPage, /selectedAgent\.created_by\?\.display_name/);
  assert.match(dashboardPage, /selectedAgent\.organization_name/);
  assert.match(dashboardPage, /selectedAgent\.owner\?\.display_name/);
  assert.doesNotMatch(dashboardPage, /quota_(?:limit|used|remaining)/);
  assert.match(dashboardPage, /selectedAgent\?\.sops\.map/);
  assert.doesNotMatch(dashboardPage, /agent-dashboard-profile-facts/);
  assert.doesNotMatch(dashboardPage, /agent-dashboard-sop-bindings/);
  assert.match(dashboardPage, /agent-dashboard-hero-actions/);
  assert.match(dashboardPage, /agent-dashboard-hero-metrics/);
  assert.match(dashboardPage, /knowledgeCount}<\/strong> 知识库/);
  assert.doesNotMatch(dashboardPage, /knowledgeCount}<\/strong> 资料/);
  assert.match(dashboardPage, /className="is-knowledge"/);
  assert.match(dashboardPage, /className="is-skill"/);
  assert.match(dashboardPage, /className="is-sop"/);
  assert.match(dashboardPage, /className="is-scheduled"/);
  assert.match(dashboardPage, /kind: "绑定 SOP"/);
  assert.match(dashboardPage, /kind: "启用技能"/);
  assert.match(dashboardPage, /kind: "绑定知识库"/);
  assert.match(dashboardPage, /kind: "创建智能体"/);
});

test("agent API normalizes enterprise ownership and lifecycle fields", () => {
  assert.match(apiClient, /export const getAgent =/);
  assert.match(apiClient, /organization_name:/);
  assert.match(apiClient, /employee_code:/);
  assert.match(apiClient, /lifecycle_status:/);
  assert.match(apiClient, /can_manage:/);
  assert.match(apiClient, /sop_keys:/);
  assert.match(apiClient, /sops:/);
  assert.doesNotMatch(apiClient, /quota_(?:limit|used|remaining)/);
});

test("agent editor binds published SOPs as an independent capability", () => {
  assert.match(agentsPage, /listSops\(\)/);
  assert.match(agentsPage, /name="sop_keys"/);
  assert.match(agentsPage, /暂无已发布 SOP/);
  assert.match(agentsPage, /agent\.sop_keys\.length/);
  assert.doesNotMatch(agentsPage, /capability_instructions\\.trim\\(\\).*label: "SOP"/);
});
