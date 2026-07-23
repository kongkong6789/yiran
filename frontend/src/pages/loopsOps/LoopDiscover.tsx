import { Button, Input, Space, Spin, message } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createOpsLoopFromCandidate,
  discoverOpsLoops,
  type OpsDiscoverCandidate,
  type OpsDiscoverResult,
} from "../../api/opsLoops";
import "./loopsOps.css";

export default function LoopDiscover() {
  const nav = useNavigate();
  const [query, setQuery] = useState("利润 库存 广告 客户流失 SOP");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [result, setResult] = useState<OpsDiscoverResult | null>(null);

  async function analyze() {
    setLoading(true);
    try {
      const data = await discoverOpsLoops({ query });
      setResult(data);
      message.success(`发现 ${data.candidates?.length || 0} 个候选闭环`);
    } catch (error) {
      console.error(error);
      message.error("AI 分析失败");
    } finally {
      setLoading(false);
    }
  }

  async function createFrom(candidate: OpsDiscoverCandidate) {
    setCreating(candidate.title);
    try {
      const loop = await createOpsLoopFromCandidate(candidate);
      message.success(`已生成草案：${loop.name}`);
      nav(`/loops/${loop.id}/design`);
    } catch (error) {
      console.error(error);
      const data = (error as { response?: { data?: Record<string, unknown>; status?: number } })?.response;
      const body = data?.data;
      const detail =
        (typeof body?.message === "string" && body.message)
        || (typeof body?.error === "string" && body.error)
        || (typeof body?.detail === "string" && body.detail)
        || (data?.status === 404
          ? "接口不存在，请重启后端并确认已执行 migrate"
          : data?.status === 500
            ? "服务端创建失败（常见原因：未 migrate 或后端未重启）"
            : "生成草案失败");
      message.error(detail);
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="loops-ops-page">
      <div className="ops-topbar">
        <div>
          <h1>AI 创建 Loop</h1>
          <p>根据企业现有知识，发现可自动化业务闭环</p>
        </div>
        <Button onClick={() => nav("/loops")}>返回列表</Button>
      </div>
      <div className="ops-main" style={{ maxWidth: 980, margin: "0 auto", width: "100%" }}>
        <div className="ops-card">
          <h3>开始分析</h3>
          <p style={{ color: "var(--ops-muted)", marginTop: 0 }}>
            系统会检索知识库 SOP / 规则片段，再用 LLM 结构化生成 OODA 草案。
          </p>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入关注的业务主题"
              onPressEnter={() => void analyze()}
            />
            <Button type="primary" loading={loading} onClick={() => void analyze()}>
              开始分析
            </Button>
          </Space.Compact>
        </div>

        {loading ? (
          <div className="ops-card" style={{ textAlign: "center", padding: 40 }}>
            <Spin tip="AI 正在分析企业知识与数据…" />
          </div>
        ) : null}

        {result ? (
          <>
            <div className="ops-card">
              <h3>分析进度</h3>
              <p style={{ margin: 0, color: "var(--ops-muted)" }}>
                已读取约 {result.analysis?.documents_read ?? 0} 份文档痕迹 ·
                识别 {result.analysis?.rules_found ?? 0} 条规则片段 ·
                发现 {result.candidates?.length ?? 0} 个潜在闭环
                {result.llm_used ? " · LLM 已启用" : " · LLM 未配置，使用启发式候选"}
              </p>
              {result.analysis?.summary ? (
                <p style={{ marginTop: 10 }}>{result.analysis.summary}</p>
              ) : null}
            </div>
            <div className="ops-candidate-grid">
              {(result.candidates || []).map((candidate) => (
                <div key={candidate.title} className="ops-candidate">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <h3 style={{ margin: 0 }}>{candidate.title}</h3>
                    <div className="ops-score">{candidate.score}%</div>
                  </div>
                  <p style={{ color: "var(--ops-muted)", margin: "10px 0 0" }}>{candidate.rationale}</p>
                  <div className="ops-meta">
                    <span>数据完整度 {candidate.data_completeness ?? "-"}%</span>
                    <span>执行可行性 {candidate.execution_feasibility ?? "-"}%</span>
                    <span>{candidate.object_count ?? 0} 个业务对象</span>
                  </div>
                  <Button
                    type="primary"
                    style={{ marginTop: 14 }}
                    loading={creating === candidate.title}
                    onClick={() => void createFrom(candidate)}
                  >
                    选择并生成 Loop
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
