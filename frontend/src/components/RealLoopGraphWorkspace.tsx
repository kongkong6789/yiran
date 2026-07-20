import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApartmentOutlined, AppstoreOutlined, BranchesOutlined, CheckCircleFilled, ClockCircleOutlined, CompressOutlined,
  FilterOutlined, FullscreenOutlined, ReloadOutlined, SearchOutlined, SyncOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import {
  App, Button, Empty, Input, Segmented, Skeleton, Space, Tag, Typography,
} from "antd";
import {
  confirmLoop, getGraph, getLoop, listLoops, type FeedbackLoop, type LoopMember, type OntGraph,
} from "../api/client";
import CompanyOperatingLoopCanvas, {
  COMPANY_DOMAIN_META, COMPANY_STATUS_META, summarizeCompanyOperatingGraph,
  type CompanyNodeDatum,
} from "./CompanyOperatingLoopCanvas";
import LoopCycleCanvas from "./LoopCycleCanvas";
import { semanticSoftColor, useVisualizationTheme } from "../theme/visualization";

type LoopStatus = "all" | FeedbackLoop["status"];
type LoopType = "all" | FeedbackLoop["loop_type"];

const TYPE_META: Record<FeedbackLoop["loop_type"], { label: string; color: string; soft: string }> = {
  R: { label: "增强回路", color: "#7c3aed", soft: "#f3efff" },
  B: { label: "调节回路", color: "#2563eb", soft: "#eef5ff" },
  comp: { label: "复合回路", color: "#b76b12", soft: "#fff6e9" },
};

const STATUS_META: Record<FeedbackLoop["status"], { label: string; color: string }> = {
  candidate: { label: "待确认", color: "gold" },
  confirmed: { label: "已确认", color: "green" },
  archived: { label: "已归档", color: "default" },
};

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function RealLoopGraphWorkspace() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const visualTheme = useVisualizationTheme();
  const canvasShellRef = useRef<HTMLElement | null>(null);
  const [loops, setLoops] = useState<FeedbackLoop[]>([]);
  const [graph, setGraph] = useState<OntGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<LoopStatus>("all");
  const [type, setType] = useState<LoopType>("all");
  const [keyword, setKeyword] = useState("");
  const [viewMode, setViewMode] = useState<"company" | "loop">("company");
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedLoopId, setSelectedLoopId] = useState<number | null>(null);
  const [showAllConnections, setShowAllConnections] = useState(true);
  const [selectedNode, setSelectedNode] = useState<CompanyNodeDatum | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadGraph = useCallback(async () => {
    setGraphLoading(true);
    try {
      const g = await getGraph({ scope: "all" }).catch(() => getGraph({ scope: "all" }).catch(() => null));
      setGraph(g);
    } finally {
      setGraphLoading(false);
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await listLoops();
      const active = result.results.filter((loop) => loop.status !== "archived" && loop.member_count > 0);
      const detailed = await Promise.all(active.map((loop) => getLoop(loop.id)));
      setLoops(detailed);
      setSelectedLoopId((current) => (
        detailed.some((loop) => loop.id === current) ? current : detailed[0]?.id || null
      ));
    } catch (error: any) {
      setLoops([]);
      message.error(error?.response?.data?.error || "回路库数据加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // 图谱数据较大且偶发较慢：独立加载，不再阻塞骨架屏
    void loadGraph();
  }, [message, loadGraph]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelectedNode(null); }, [viewMode]);
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === canvasShellRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const filteredLoops = useMemo(() => loops.filter((loop) => {
    if (status !== "all" && loop.status !== status) return false;
    if (type !== "all" && loop.loop_type !== type) return false;
    if (keyword && !`${loop.code} ${loop.name} ${loop.description}`.toLowerCase().includes(keyword.toLowerCase())) {
      return false;
    }
    return true;
  }), [keyword, loops, status, type]);

  useEffect(() => {
    if (!filteredLoops.some((loop) => loop.id === selectedLoopId)) {
      setSelectedLoopId(filteredLoops[0]?.id || null);
    }
  }, [filteredLoops, selectedLoopId]);

  const selectedLoop = useMemo(
    () => loops.find((loop) => loop.id === selectedLoopId) || null,
    [loops, selectedLoopId],
  );

  const companyGraphStats = useMemo(() => summarizeCompanyOperatingGraph(graph), [graph]);

  const nodeDetail = useMemo(() => {
    if (!selectedNode || !graph) return null;
    const ids = new Set(selectedNode.objectIds);
    const objects = graph.objects.filter((o) => ids.has(o.id));
    const relations = graph.relations.filter((r) => ids.has(r.source) || ids.has(r.target));
    const attrRows: { label: string; value: string }[] = [];
    const seen = new Set<string>();
    const skip = new Set(["_db_key", "_table", "x", "y", "source_id", "数据来源"]);
    objects.forEach((o) => {
      Object.entries(o.attributes || {}).forEach(([k, v]) => {
        if (skip.has(k) || k.startsWith("_") || v == null || v === "") return;
        const value = String(v);
        if (value.length > 40 || seen.has(k)) return;
        seen.add(k);
        if (attrRows.length < 6) attrRows.push({ label: k, value });
      });
    });
    return { objects, relations, attrRows, count: objects.length };
  }, [selectedNode, graph]);

  const stats = useMemo(() => {
    const confirmed = loops.filter((loop) => loop.status === "confirmed").length;
    const candidates = loops.filter((loop) => loop.status === "candidate").length;
    const relations = new Set(
      loops.flatMap((loop) => (loop.members || []).map((member) => member.relation.id)),
    ).size;
    return {
      total: loops.length,
      confirmed,
      candidates,
      relations,
      rate: loops.length ? Math.round((confirmed / loops.length) * 100) : 0,
    };
  }, [loops]);

  const handleConfirm = async () => {
    if (!selectedLoop || selectedLoop.status !== "candidate") return;
    setConfirming(true);
    try {
      const updated = await confirmLoop(selectedLoop.id);
      setLoops((current) => current.map((loop) => (
        loop.id === updated.id ? { ...loop, ...updated } : loop
      )));
      message.success("回路已确认");
    } catch (error: any) {
      message.error(error?.response?.data?.error || "确认回路失败");
    } finally {
      setConfirming(false);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await canvasShellRef.current?.requestFullscreen();
    } catch {
      message.warning("当前浏览器不支持全屏图谱");
    }
  };

  if (loading) {
    return <div className="real-loop-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>;
  }

  return (
    <div className="real-loop-workspace">
      <div className="real-loop-main">
        <aside className="real-loop-control-panel">
          <div className="real-loop-panel-heading">
            <div><strong>回路视图</strong><small>选择要查看的闭环</small></div>
            <FilterOutlined />
          </div>
          <div className="real-loop-view-buttons">
            <button type="button" className={status === "all" ? "is-active" : ""} onClick={() => setStatus("all")}>
              <ApartmentOutlined /><span>全部回路</span><b>{stats.total}</b>
            </button>
            <button type="button" className={status === "confirmed" ? "is-active" : ""} onClick={() => setStatus("confirmed")}>
              <CheckCircleFilled /><span>已确认</span><b>{stats.confirmed}</b>
            </button>
            <button type="button" className={status === "candidate" ? "is-active" : ""} onClick={() => setStatus("candidate")}>
              <ClockCircleOutlined /><span>待确认</span><b>{stats.candidates}</b>
            </button>
          </div>
          <div className="real-loop-filter-block">
            <span>图谱范围</span>
            <div className="lg-view-toggle is-block" role="tablist">
              <button type="button" role="tab" aria-selected={viewMode === "company"} className={viewMode === "company" ? "is-on" : ""} onClick={() => setViewMode("company")}>公司全景</button>
              <button type="button" role="tab" aria-selected={viewMode === "loop"} className={viewMode === "loop" ? "is-on" : ""} onClick={() => setViewMode("loop")}>单条回路</button>
            </div>
          </div>
          <div className="real-loop-filter-block">
            <span>回路类型</span>
            <Segmented
              block
              size="small"
              value={type}
              onChange={(value) => setType(value as LoopType)}
              options={[
                { value: "all", label: "全部" },
                { value: "R", label: "增强" },
                { value: "B", label: "调节" },
                { value: "comp", label: "复合" },
              ]}
            />
          </div>
          <div className="real-loop-filter-block">
            <span>关系图例</span>
            {viewMode === "company" ? (
              <div className="real-loop-legend">
                <i className="is-ready" /> 已识别数据
                <i className="is-partial" /> 部分接入
                <i className="is-pending" /> 待接入
                <i className="is-master-loop" /> 公司经营总循环
                <i className="is-all-loops" /> 全部回路聚合
                <i className="is-hypothesis" /> 当前单条回路
              </div>
            ) : (
              <div className="real-loop-legend">
                <i className="is-node" /> 经营对象
                <i className="is-positive" /> 正向促进
                <i className="is-negative" /> 负向抑制
                <i className="is-focus" /> 回路起点
              </div>
            )}
          </div>
          <div className="real-loop-filter-block real-loop-data-note">
            <span>{viewMode === "company" ? "公司经营骨架" : "当前回路库"}</span>
            {viewMode === "company" ? (
              <>
                <strong>{companyGraphStats.ready} 个系统已识别数据</strong>
                <strong>{companyGraphStats.partial} 个部分接入 · {companyGraphStats.pending} 个待接入</strong>
                <small>浅色线汇总全部回路；彩色实线来自右侧当前回路。</small>
              </>
            ) : (
              <>
                <strong>{stats.total} 个已保存回路</strong>
                <strong>{stats.relations} 条因果关系</strong>
                <small>单条回路展示回路库中已保存的因果链，预置内容会标记为演示。</small>
              </>
            )}
          </div>
        </aside>

        <section className="real-loop-canvas-shell" ref={canvasShellRef}>
          <div className="real-loop-canvas-toolbar">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              value={keyword}
              placeholder="搜索回路名称或描述"
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Space>
              {viewMode === "company" && (
                <Button
                  type={showAllConnections ? "primary" : "default"}
                  icon={<BranchesOutlined />}
                  onClick={() => setShowAllConnections((current) => !current)}
                >
                  全部连线
                </Button>
              )}
              <div className="lg-view-toggle" role="tablist">
                <button type="button" role="tab" aria-selected={viewMode === "company"} className={viewMode === "company" ? "is-on" : ""} onClick={() => setViewMode("company")}>公司全景</button>
                <button type="button" role="tab" aria-selected={viewMode === "loop"} className={viewMode === "loop" ? "is-on" : ""} onClick={() => setViewMode("loop")}>单条回路</button>
              </div>
              <Button icon={fullscreen ? <CompressOutlined /> : <FullscreenOutlined />} onClick={() => void toggleFullscreen()}>
                {fullscreen ? "退出全屏" : "全屏图谱"}
              </Button>
              <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void load(true)}>
                刷新数据
              </Button>
              <Button type="primary" icon={<AppstoreOutlined />} onClick={() => nav("/commerce/bench")}>
                经营工作台
              </Button>
            </Space>
          </div>
          <div className={`real-loop-canvas ${viewMode === "company" ? "is-company-canvas" : "is-flow-canvas"}`}>
            {viewMode === "company" ? (
              graph ? (
                <div className="real-loop-company-stage">
                <CompanyOperatingLoopCanvas
                  graph={graph}
                  loops={filteredLoops}
                  showAllConnections={showAllConnections}
                  selectedLoop={selectedLoop}
                  selectedNodeKey={selectedNode?.key || null}
                  onSelectNode={setSelectedNode}
                />
                </div>
              ) : graphLoading ? (
                <div className="real-loop-graph-loading">
                  <Skeleton active paragraph={{ rows: 6 }} />
                  <span className="real-loop-graph-loading-hint"><SyncOutlined spin /> 正在加载公司全景图谱…</span>
                </div>
              ) : (
                <div className="real-loop-onboarding">
                  <span className="real-loop-onboarding-icon"><ApartmentOutlined /></span>
                  <strong>公司全景图谱暂未取到</strong>
                  <p>经营图谱接口可能超时或暂无数据，点下方按钮重新载入即可。</p>
                  <Button type="primary" icon={<ReloadOutlined />} loading={graphLoading} onClick={() => void loadGraph()}>
                    重新载入图谱
                  </Button>
                </div>
              )
            ) : selectedLoop ? (
              <div className="real-loop-flow-stage">
                <div className="real-loop-flow-heading">
                  <div>
                    <Typography.Title level={4}>{selectedLoop.name}</Typography.Title>
                    <Typography.Text type="secondary">
                      按因果顺序连接，最后一条关系返回起点，构成完整闭环
                    </Typography.Text>
                  </div>
                  <Space size={6} wrap>
                    <Tag color={STATUS_META[selectedLoop.status].color}>{STATUS_META[selectedLoop.status].label}</Tag>
                    <Tag>{TYPE_META[selectedLoop.loop_type].label}</Tag>
                    <Tag>{selectedLoop.member_count} 个环节</Tag>
                  </Space>
                </div>
                <div className="real-loop-flow-canvas">
                  <LoopCycleCanvas loop={selectedLoop} />
                </div>
              </div>
            ) : loops.length === 0 ? (
              <div className="real-loop-onboarding">
                <span className="real-loop-onboarding-icon"><ApartmentOutlined /></span>
                <strong>回路库还没有已保存的回路</strong>
                <p>先在经营图谱中标注因果关系，再运行闭环检测并保存。</p>
                <Button type="primary" onClick={() => { window.location.href = "/ontology"; }}>
                  前往经营图谱
                </Button>
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前筛选下没有回路"
              >
                <Button onClick={() => { setStatus("all"); setType("all"); setKeyword(""); }}>清除筛选</Button>
              </Empty>
            )}
          </div>
          <div className="real-loop-canvas-footer">
            <span>
              {viewMode === "company"
                ? "灰线为系统归属，紫色虚线为公司总循环，浅色线汇总全部回路，彩色线高亮当前回路"
                : "箭头表示因果方向；红色边为负向抑制，其余为正向促进"}
            </span>
            <span>
              {viewMode === "company"
                ? `${companyGraphStats.total} 个经营系统 · ${showAllConnections ? `已汇总 ${filteredLoops.length} 条回路` : "已隐藏全部回路底图"}`
                : (selectedLoop ? `当前闭环 ${selectedLoop.member_count} 个环节` : "未选择回路")}
            </span>
          </div>
        </section>

        <aside className="real-loop-detail-panel">
          <div className="real-loop-panel-heading">
            <div>
              <strong>{selectedNode ? "系统详情" : viewMode === "company" ? "公司框架" : "回路详情"}</strong>
              <small>{selectedNode
                ? "画布中选中的公司经营系统"
                : viewMode === "company" ? "公司级经营骨架与数据覆盖" : "当前选中的已保存回路"}</small>
            </div>
            {selectedNode && (
              <Button size="small" type="text" onClick={() => setSelectedNode(null)}>返回回路</Button>
            )}
          </div>
          {selectedNode && nodeDetail ? (
            <>
              <div className="real-loop-detail-title">
                <span style={{
                  color: COMPANY_DOMAIN_META[selectedNode.key].color,
                  background: semanticSoftColor(COMPANY_DOMAIN_META[selectedNode.key].color, visualTheme.mode, COMPANY_DOMAIN_META[selectedNode.key].soft),
                }}>
                  {COMPANY_DOMAIN_META[selectedNode.key].icon}
                </span>
                <div>
                  <Typography.Title level={5}>{selectedNode.name}</Typography.Title>
                  <Typography.Text type="secondary">{selectedNode.sub}</Typography.Text>
                </div>
              </div>
              <div className="real-loop-detail-grid">
                <div><span>数据状态</span><strong>{COMPANY_STATUS_META[selectedNode.status].label}</strong></div>
                <div><span>映射对象</span><strong>{nodeDetail.count}</strong></div>
                <div><span>数据来源</span><strong>{selectedNode.sources.length}</strong></div>
                <div><span>待补数据</span><strong>{selectedNode.missing.length}</strong></div>
              </div>
              <div className="company-operating-detail-block">
                <div className="real-loop-subheading"><strong>已识别来源</strong><span>{selectedNode.sources.length}</span></div>
                {selectedNode.sources.length ? (
                  <div className="company-operating-source-list">
                    {selectedNode.sources.map((source) => <code key={source}>{source}</code>)}
                  </div>
                ) : <Typography.Text type="secondary">尚未识别到对应数据表</Typography.Text>}
              </div>
              <div className="company-operating-detail-block">
                <div className="real-loop-subheading"><strong>后续需补充</strong><span>{selectedNode.missing.length}</span></div>
                <div className="company-operating-missing-list">
                  {selectedNode.missing.map((item) => <span key={item}>{item}</span>)}
                </div>
              </div>
              {nodeDetail.attrRows.length > 0 && (
                <div className="real-loop-relations">
                  <div className="real-loop-subheading"><strong>节点信息</strong><span>{nodeDetail.attrRows.length}</span></div>
                  <div className="real-loop-attr-grid">
                    {nodeDetail.attrRows.map((row) => (
                      <div className="real-loop-attr" key={row.label}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="real-loop-relations">
                <div className="real-loop-subheading"><strong>连接关系</strong><span>{nodeDetail.relations.length}</span></div>
                {nodeDetail.relations.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>该节点暂无记录的因果/归属关系</Typography.Text>
                ) : (
                  nodeDetail.relations.slice(0, 8).map((rel) => (
                    <div className="real-loop-relation" key={rel.id}>
                      <i className={rel.polarity === "-" ? "is-negative" : "is-positive"} />
                      <div>
                        <span>{rel.polarity || "+"} {rel.label || "关系"}</span>
                        <strong>{nodeDetail.objects.some((o) => o.id === rel.source) ? "指向下游" : "来自上游"}</strong>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : viewMode === "company" ? (
            <div className="company-operating-overview">
              <div className="real-loop-detail-title">
                <span style={{
                  color: COMPANY_DOMAIN_META.company.color,
                  background: semanticSoftColor(COMPANY_DOMAIN_META.company.color, visualTheme.mode, COMPANY_DOMAIN_META.company.soft),
                }}>
                  {COMPANY_DOMAIN_META.company.icon}
                </span>
                <div>
                  <Typography.Title level={5}>公司经营系统</Typography.Title>
                  <Typography.Text type="secondary">先搭骨架，后续按数据状态逐步计算</Typography.Text>
                </div>
              </div>
              <div className="real-loop-detail-grid">
                <div><span>经营系统</span><strong>{companyGraphStats.total}</strong></div>
                <div><span>已识别</span><strong>{companyGraphStats.ready}</strong></div>
                <div><span>部分接入</span><strong>{companyGraphStats.partial}</strong></div>
                <div><span>待接入</span><strong>{companyGraphStats.pending}</strong></div>
              </div>
              <Typography.Paragraph className="real-loop-description">
                当前只展示公司级业务模型，不生成虚构指标。点击画布中的经营系统可查看已识别数据来源和待补字段。
              </Typography.Paragraph>
            </div>
          ) : selectedLoop ? (
            <>
              <div className="real-loop-detail-title">
                <span style={{
                  color: TYPE_META[selectedLoop.loop_type].color,
                  background: semanticSoftColor(TYPE_META[selectedLoop.loop_type].color, visualTheme.mode, TYPE_META[selectedLoop.loop_type].soft),
                }}>
                  {selectedLoop.loop_type}
                </span>
                <div>
                  <Typography.Title level={5}>{selectedLoop.name}</Typography.Title>
                  <Typography.Text type="secondary">{selectedLoop.code || `Loop #${selectedLoop.id}`}</Typography.Text>
                </div>
              </div>
              {selectedLoop.description && (
                <Typography.Paragraph className="real-loop-description">{selectedLoop.description}</Typography.Paragraph>
              )}
              {selectedLoop.code?.startsWith("GRAPH-DEMO") && (
                <div className="company-operating-demo-note">
                  <Tag color="purple">业务模型预置</Tag>
                  <span>该回路用于展示结构，尚未由连续真实数据计算验证。</span>
                </div>
              )}
              <div className="real-loop-detail-grid">
                <div><span>置信度</span><strong>{selectedLoop.confidence}%</strong></div>
                <div><span>更新时间</span><strong>{formatTime(selectedLoop.updated_at)}</strong></div>
                <div><span>确认人</span><strong>{selectedLoop.confirmed_by || "尚未确认"}</strong></div>
                <div><span>确认时间</span><strong>{formatTime(selectedLoop.confirmed_at)}</strong></div>
              </div>
              <div className="real-loop-relations">
                <div className="real-loop-subheading"><strong>闭环顺序</strong><span>{selectedLoop.members?.length || 0}</span></div>
                {[...(selectedLoop.members || [])]
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((member: LoopMember, index) => (
                    <div className="real-loop-relation" key={member.id}>
                      <b className="real-loop-relation-index">{index + 1}</b>
                      <i className={member.relation.polarity === "-" ? "is-negative" : "is-positive"} />
                      <div>
                        <strong>{member.relation.source_name}</strong>
                        <span>{member.relation.polarity || "+"} {member.relation.label || "影响"}</span>
                        <strong>{member.relation.target_name}</strong>
                      </div>
                    </div>
                  ))}
              </div>
              {selectedLoop.status === "candidate" && (
                <Button type="primary" block loading={confirming} onClick={() => void handleConfirm()}>
                  确认此回路
                </Button>
              )}
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择一个回路查看详情" />
          )}
          <div className="real-loop-list">
            <div className="real-loop-subheading"><strong>回路列表</strong><span>{filteredLoops.length}</span></div>
            {filteredLoops.map((loop) => (
              <button
                type="button"
                key={loop.id}
                className={selectedLoopId === loop.id ? "is-active" : ""}
                onClick={() => { setSelectedLoopId(loop.id); setSelectedNode(null); }}
              >
                <i style={{ background: TYPE_META[loop.loop_type].color }} />
                <span><strong>{loop.name}</strong><small>{loop.code || `Loop #${loop.id}`} · {loop.member_count} 个环节</small></span>
                {loop.code?.startsWith("GRAPH-DEMO")
                  ? <Tag color="purple">演示</Tag>
                  : <Tag color={STATUS_META[loop.status].color}>{STATUS_META[loop.status].label}</Tag>}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
