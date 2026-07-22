import { useEffect, useRef, useState } from "react";
import {
  Card, Table, Tag, Row, Col, Statistic, Space, Typography, Button, message,
  Modal, Input, Select, Upload, Alert, Empty, Checkbox, Drawer, Spin,
} from "antd";
import {
  DatabaseOutlined, CloudSyncOutlined, UploadOutlined, PlusOutlined, MergeCellsOutlined,
  SafetyCertificateOutlined, RobotOutlined,
  ArrowRightOutlined,
  EyeOutlined, AuditOutlined, ContainerOutlined, ImportOutlined, CloseOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import "./enterprise-data.css";
import {
  composeInventorySalesSnapshot, confirmReferenceMapping, createReferenceMapping,
  getTables, getMetrics, getAnomalies, getDataAssetPreview, getImportContracts, getMetricContracts, getRawImports,
  getReferenceMappings, getSourceSnapshots, publishDataAsset, reconcileRawImport, syncJackyun, uploadSalesLedger,
} from "../../api/client";

type EnterpriseDataProps = {
  onBackToDocuments?: () => void;
};

function formatDrawerDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function EnterpriseData({ onBackToDocuments }: EnterpriseDataProps) {
  const navigate = useNavigate();
  const [tables, setTables] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [rawImports, setRawImports] = useState<any[]>([]);
  const [importContracts, setImportContracts] = useState<any[]>([]);
  const [referenceMappings, setReferenceMappings] = useState<any[]>([]);
  const [source, setSource] = useState<string>("");
  const [path, setPath] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingDraft, setMappingDraft] = useState({ key: "", kind: "channel" as "channel" | "product" | "warehouse", json: "{}" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ledgerFile, setLedgerFile] = useState<File | null>(null);
  const [ledgerDraft, setLedgerDraft] = useState({ contractId: 0, channelMappingId: 0, productMappingId: 0, start: "", end: "" });
  const [composeOpen, setComposeOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composeDraft, setComposeDraft] = useState({ inventorySnapshotId: 0, salesSnapshotId: 0 });
  const [activeSection, setActiveSection] = useState("assets");
  const [trustOpen, setTrustOpen] = useState(false);
  const [trustSaving, setTrustSaving] = useState(false);
  const [trustAsset, setTrustAsset] = useState<{ table: string; key: string; name: string } | null>(null);
  const [trustDraft, setTrustDraft] = useState({ asOf: new Date().toISOString(), confirmed: false });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<{ table: string; key: string; name: string; category: string; description: string } | null>(null);
  const [assetDetail, setAssetDetail] = useState<any>(null);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const initialLoadRef = useRef(false);

  const reload = async () => {
    setAssetsLoading(true);
    const [tableResult, snapshotResult] = await Promise.allSettled([getTables(), getSourceSnapshots()]);
    if (tableResult.status === "fulfilled") {
      setTables(tableResult.value.tables || []);
      setSource(tableResult.value.source || "");
      setPath(tableResult.value.path || "");
    } else {
      message.error("业务数据资产加载失败");
    }
    if (snapshotResult.status === "fulfilled") setSnapshots(snapshotResult.value.results || []);
    setAssetsLoading(false);

    // 首屏先返回资产与可信状态，其余页签数据随后加载，避免争抢数据库连接。
    const secondary = await Promise.allSettled([
      getMetrics(), getAnomalies(), getMetricContracts(), getRawImports(), getImportContracts(), getReferenceMappings(),
    ]);
    if (secondary[0].status === "fulfilled") setMetrics(secondary[0].value.results || []);
    if (secondary[1].status === "fulfilled") setAnomalies(secondary[1].value.results || []);
    if (secondary[2].status === "fulfilled") setContracts(secondary[2].value.results || []);
    if (secondary[3].status === "fulfilled") setRawImports(secondary[3].value.results || []);
    if (secondary[4].status === "fulfilled") setImportContracts(secondary[4].value.results || []);
    if (secondary[5].status === "fulfilled") setReferenceMappings(secondary[5].value.results || []);
  };

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    void reload();
  }, []);

  const doSync = async () => {
    setSyncing(true);
    try {
      const res = await syncJackyun();
      if (!res.ok) {
        message.error(res.error || "同步失败");
        return;
      }
      const w = res.written || {};
      message.success(
        `吉客云已写入 ${w.backend}:商品 ${w.products ?? 0} / 销售 ${w.sales ?? 0}` +
        (res.configured ? " (live)" : " (fixture)")
      );
      reload();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const saveMapping = async () => {
    setMappingSaving(true);
    try {
      const mappings = JSON.parse(mappingDraft.json);
      if (!mappingDraft.key.trim() || !mappings || Array.isArray(mappings) || typeof mappings !== "object") {
        throw new Error("请填写映射名称和 JSON 对象");
      }
      await createReferenceMapping({
        mapping_key: mappingDraft.key.trim(), kind: mappingDraft.kind, version: "v1", mappings,
      });
      message.success("映射候选已创建，请由企业管理员确认");
      setMappingOpen(false);
      setMappingDraft({ key: "", kind: "channel", json: "{}" });
      reload();
    } catch (error: any) {
      message.error(error?.response?.data?.error || error?.message || "映射创建失败");
    } finally {
      setMappingSaving(false);
    }
  };

  const confirmMapping = async (id: number) => {
    try {
      await confirmReferenceMapping(id);
      message.success("映射已确认，可以用于 governed Raw 导入");
      reload();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "映射确认失败");
    }
  };

  const sha256 = async (file: File) => {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  };

  const uploadLedger = async () => {
    if (!ledgerFile || !ledgerDraft.contractId || !ledgerDraft.channelMappingId || !ledgerDraft.productMappingId
      || !ledgerDraft.start || !ledgerDraft.end) {
      message.error("请选择文件、契约、两类映射和统计窗口");
      return;
    }
    setUploading(true);
    try {
      const contract = importContracts.find((row) => row.id === ledgerDraft.contractId);
      const form = new FormData();
      form.append("file", ledgerFile);
      form.append("contract_id", String(ledgerDraft.contractId));
      form.append("channel_mapping_id", String(ledgerDraft.channelMappingId));
      form.append("product_mapping_id", String(ledgerDraft.productMappingId));
      form.append("manifest", JSON.stringify({
        schema: "yiran_governed_raw_manifest_v1",
        schema_version: "sales-ledger-v1",
        content_sha256: await sha256(ledgerFile),
        contract_hash: contract?.contract_hash,
        window: { start: ledgerDraft.start, end: ledgerDraft.end },
      }));
      await uploadSalesLedger(form);
      message.success("销售账已完成安全试算，请检查隔离与窗口覆盖后再对账");
      setUploadOpen(false);
      setLedgerFile(null);
      reload();
    } catch (error: any) {
      message.error(error?.response?.data?.error || error?.message || "销售账导入失败");
    } finally {
      setUploading(false);
    }
  };

  const reconcileImport = (row: any) => {
    Modal.confirm({
      title: "确认完成外部业务对账？",
      content: "只有窗口完整、无隔离行且重复嫌疑已核清时才会通过；该操作不会写入 ERP。",
      okText: "确认对账",
      onOk: async () => {
        try {
          await reconcileRawImport(row.id, row.reconciliation_hash);
          message.success("对账通过，已生成销售 Snapshot");
          reload();
        } catch (error: any) {
          message.error(error?.response?.data?.error || "对账被门禁阻断");
          throw error;
        }
      },
    });
  };

  const composeSnapshot = async () => {
    if (!composeDraft.inventorySnapshotId || !composeDraft.salesSnapshotId) {
      message.error("请选择库存 Snapshot 和已对账销售 Snapshot");
      return;
    }
    setComposing(true);
    try {
      const result = await composeInventorySalesSnapshot({
        inventory_snapshot_id: composeDraft.inventorySnapshotId,
        sales_snapshot_id: composeDraft.salesSnapshotId,
      });
      message.success(`补货分析 Snapshot 已生成：${result.id}`);
      setComposeOpen(false);
      reload();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "Snapshot 组合失败");
    } finally {
      setComposing(false);
    }
  };

  const openTrustAsset = (table: string, key: string, name: string) => {
    setTrustAsset({ table, key, name });
    setTrustDraft({ asOf: new Date().toISOString(), confirmed: false });
    setTrustOpen(true);
  };

  const publishTrustedAsset = async () => {
    if (!trustAsset || !trustDraft.confirmed) {
      message.error("请先确认当前数据范围完整");
      return;
    }
    setTrustSaving(true);
    try {
      const result = await publishDataAsset({
        table: trustAsset.table,
        asset_key: trustAsset.key,
        display_name: trustAsset.name,
        as_of: trustDraft.asOf,
        confirm_complete: true,
      });
      message.success(result.reused ? "该内容已经有可信版本" : "可信数据版本已发布，可以供 AI 任务使用");
      setTrustOpen(false);
      reload();
      if (selectedAsset?.table === trustAsset.table) {
        setAssetDetail(await getDataAssetPreview(trustAsset.table));
      }
    } catch (error: any) {
      message.error(error?.response?.data?.error || "可信数据发布失败");
    } finally {
      setTrustSaving(false);
    }
  };

  // 按建模分层给表分组上色
  const iconTone = (table: string, category: string) => {
    if (["anomaly", "error_book", "ads_anomaly"].includes(table) || category === "质量记录" || category === "治理记录") return "quality";
    if (category === "指标口径") return "metric-def";
    if (category === "指标数据") return "metric-data";
    if (category === "动作留痕") return "event";
    if (category === "基础档案" || category === "维度" || table.startsWith("dim_")) return "dimension";
    if (category.includes("销售") || table.includes("sales")) return "sales";
    if (category.includes("本体")) return "ontology";
    return "default";
  };

  const layerOf = (t: string) =>
    t.startsWith("dim_") ? "维度" :
    t.startsWith("dwd_") ? "明细" :
    t.startsWith("dws_") ? "汇总" :
    t.startsWith("ads_") ? "应用" :
    t.startsWith("ont_") ? "本体镜像" :
    t === "biz_object_event" ? "动作留痕" : "其他";
  const governedSnapshots = snapshots.filter((row) => row.governance_status === "governed" && row.source_complete);
  const pendingMappings = referenceMappings.filter((row) => row.status === "candidate").length;
  const pendingImports = rawImports.filter((row) => row.reconciliation_status === "pending").length;

  const assetMeta = (table: string) => {
    const known: Record<string, { name: string; key: string; description: string; category: string }> = {
      ads_anomaly: { name: "数据质量异常", key: "unove.quality.anomalies", description: "经营指标触发的数据质量与业务异常记录。", category: "质量记录" },
      ads_metric_def: { name: "指标口径定义", key: "unove.metric.definitions", description: "统一维护指标名称、公式、单位和计算口径。", category: "指标口径" },
      ads_metric_snapshot: { name: "经营指标快照", key: "unove.metric.snapshots", description: "按日期和业务维度保存的经营指标计算结果。", category: "指标数据" },
      biz_object_event: { name: "业务动作记录", key: "unove.business.events", description: "记录业务对象发生的动作及闸机处理结果。", category: "动作留痕" },
      dim_date: { name: "日期维度", key: "unove.dim.date", description: "用于统一自然日、周、月、季度及活动日期口径。", category: "基础档案" },
      dim_product: { name: "商品档案", key: "unove.dim.products", description: "企业商品、SKU、品牌、品类及价格基础信息。", category: "基础档案" },
      dim_shop: { name: "店铺档案", key: "unove.dim.shops", description: "企业店铺、平台、品牌及负责人基础信息。", category: "基础档案" },
      dim_sku_inventory_map: { name: "SKU 库存映射", key: "unove.inventory.sku_mapping", description: "销售 SKU 与库存货号、条码之间的对应关系。", category: "字段映射" },
      dwd_sales_detail: { name: "销售业务明细", key: "unove.sales.details", description: "经过清洗的店铺、SKU、销售与退款明细事实。", category: "销售事实" },
      dws_sales_shop_daily: { name: "店铺日销售汇总", key: "unove.sales.shop_daily", description: "按店铺和日期汇总的销售额、订单与退款结果。", category: "销售汇总" },
      dws_sales_sku_daily: { name: "SKU 日销售汇总", key: "unove.sales.sku_daily", description: "按 SKU 和日期汇总的销量、销售额与退款结果。", category: "销售汇总" },
      ont_object_snapshot: { name: "本体对象镜像", key: "unove.ontology.objects", description: "供分析层使用的企业业务对象结构化镜像。", category: "本体数据" },
      ont_relation_snapshot: { name: "本体关系镜像", key: "unove.ontology.relations", description: "供分析层使用的业务对象关系结构化镜像。", category: "本体数据" },
      daily_sales: {
        name: "UNOVE 销售数据",
        key: "unove.sales",
        description: "按日沉淀的销售事实，可用于经营分析与后续 AI 任务取数。",
        category: "销售事实",
      },
      metric_snapshot: {
        name: "经营指标结果",
        key: "unove.metrics",
        description: "按统一口径计算的经营指标及环比结果。",
        category: "指标数据",
      },
      anomaly: {
        name: "数据质量异常",
        key: "unove.data_quality",
        description: "记录触发质量规则的数据问题，处理后才能放心用于分析。",
        category: "质量记录",
      },
      error_book: {
        name: "数据修正记录",
        key: "unove.corrections",
        description: "保留问题修正与复核记录，便于追踪数据变化。",
        category: "治理记录",
      },
    };
    return known[table] || {
      name: table,
      key: table,
      description: "已接入企业数据层的结构化数据表。",
      category: layerOf(table),
    };
  };

  const openAssetDetail = async (table: string) => {
    const meta = assetMeta(table);
    setSelectedAsset({ table, ...meta });
    setAssetDetail(null);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setAssetDetail(await getDataAssetPreview(table));
    } catch (error: any) {
      message.error(error?.response?.data?.error || "数据资产详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const assetRows = tables.map((table) => {
    const meta = assetMeta(table.table);
    return {
      ...table,
      ...meta,
      trustedVersion: governedSnapshots.find((row) => row.scope?.table === table.table),
    };
  });

  const snapshotColumns = [
    { title: "数据版本", dataIndex: "snapshot_key", ellipsis: true },
    { title: "来源", dataIndex: "source_system" },
    { title: "数据截至", dataIndex: "as_of" },
    {
      title: "可信状态", dataIndex: "governance_status",
      render: (value: string) => <Tag color={value === "governed" ? "green" : "default"}>{value === "governed" ? "已治理" : "待治理"}</Tag>,
    },
    {
      title: "数据完整", dataIndex: "source_complete",
      render: (value: boolean) => <Tag color={value ? "green" : "orange"}>{value ? "完整" : "不完整"}</Tag>,
    },
    { title: "数据量", dataIndex: "row_count", render: (value: number) => `${value || 0} 行` },
    {
      title: "操作",
      render: (_: unknown, row: any) => row.source_system === "composite_inventory_sales" ? (
        <Button size="small" type="link" onClick={() => navigate(`/work?intent=inventory-reorder&snapshot_id=${row.id}`)}>
          发起补货分析
        </Button>
      ) : null,
    },
  ];

  const pendingImportCount = pendingMappings + pendingImports;
  const workspaceTabs = [
    { key: "assets", label: "数据资产" },
    { key: "imports", label: "数据接入", badge: pendingImportCount || undefined },
    { key: "trusted", label: "可用数据" },
    { key: "quality", label: "数据质量", badge: anomalies.length || undefined, badgeTone: "alert" as const },
  ];

  return (
    <Space className="enterprise-data-page" direction="vertical" size={16} style={{ width: "100%" }}>
      <nav className="enterprise-data-breadcrumb" aria-label="面包屑">
        {onBackToDocuments ? (
          <button type="button" onClick={onBackToDocuments}>知识库</button>
        ) : (
          <span>知识库</span>
        )}
        <span>/</span>
        <strong>企业数据</strong>
      </nav>

      <Card className="enterprise-data-guide" bordered={false}>
        <div className="enterprise-data-guide-title">企业数据会怎样被使用？</div>
        <div className="enterprise-data-guide-flow">
          <div className="enterprise-data-guide-step">
            <span className="enterprise-data-guide-step-icon is-blue"><ImportOutlined /></span>
            <strong>接入数据</strong>
            <small>连接业务系统或上传文件</small>
          </div>
          <div className="enterprise-data-guide-arrow"><ArrowRightOutlined /></div>
          <div className="enterprise-data-guide-step">
            <span className="enterprise-data-guide-step-icon is-purple"><AuditOutlined /></span>
            <strong>数据治理</strong>
            <small>清洗、标准化与质量校验</small>
          </div>
          <div className="enterprise-data-guide-arrow"><ArrowRightOutlined /></div>
          <div className="enterprise-data-guide-step">
            <span className="enterprise-data-guide-step-icon is-teal"><ContainerOutlined /></span>
            <strong>发布可用版本</strong>
            <small>对外发布并生成可用版本</small>
          </div>
          <div className="enterprise-data-guide-arrow"><ArrowRightOutlined /></div>
          <div className="enterprise-data-guide-step">
            <span className="enterprise-data-guide-step-icon is-orange"><RobotOutlined /></span>
            <strong>智能任务使用</strong>
            <small>AI 应用与智能体调用数据</small>
          </div>
        </div>
      </Card>

      {governedSnapshots.length === 0 && tables.length > 0 && (
        <Alert
          className="enterprise-data-status-alert"
          type="warning"
          showIcon
          message="企业数据已经接入，但还没有可直接供 AI 任务使用的可信数据版本"
          description="现有 UNOVE 数据不需要重新上传；在“数据资产”中确认范围并发布可信版本后，AI 即可据此生成任务产物。"
          action={<Button size="small" onClick={() => setActiveSection("assets")}>选择数据资产</Button>}
        />
      )}

      <Card className="enterprise-data-workspace" bordered={false}>
        <div className="enterprise-data-tabbar">
          <div className="enterprise-data-tabbar-track" role="tablist" aria-label="企业数据分区">
            {workspaceTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeSection === tab.key}
                className={`enterprise-data-tab${activeSection === tab.key ? " is-active" : ""}`}
                onClick={() => setActiveSection(tab.key)}
              >
                <span>{tab.label}</span>
                {tab.badge ? (
                  <span className={`enterprise-data-tab-badge${tab.badgeTone === "alert" ? " is-alert" : ""}${activeSection === tab.key ? " is-active" : ""}`}>
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="enterprise-data-tabpanel">
          {activeSection === "assets" && (
                <div className="enterprise-data-section">
                  <div className="enterprise-data-section-heading">
                    <div>
                      <Typography.Title level={5}>业务数据资产</Typography.Title>
                      <Typography.Text type="secondary">展示企业已拥有的数据资产，以及它们能否被 AI 任务使用。</Typography.Text>
                    </div>
                    <Button className="enterprise-data-btn-create" type="primary" icon={<PlusOutlined />} onClick={() => setActiveSection("imports")}>
                      新建数据资产
                    </Button>
                  </div>
                  {tables.length ? (
                    <Table
                      className="enterprise-data-assets-table"
                      rowKey="table"
                      size="middle"
                      loading={assetsLoading}
                      dataSource={assetRows}
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      onRow={(row) => ({ onClick: () => void openAssetDetail(row.table) })}
                      columns={[
                        {
                          title: "数据资产", key: "asset", width: "38%",
                          render: (_: unknown, row: any) => {
                            const tone = iconTone(row.table, row.category);
                            return (
                              <div className="enterprise-data-list-name">
                                <span className={`enterprise-data-list-icon is-${tone}`}>
                                  {tone === "quality" ? <SafetyCertificateOutlined /> : <DatabaseOutlined />}
                                </span>
                                <span>
                                  <Space size={6} wrap>
                                    <Typography.Text strong>{row.name}</Typography.Text>
                                    <Tag className="enterprise-data-tag-category">{row.category}</Tag>
                                  </Space>
                                  <Typography.Text type="secondary">{row.description}</Typography.Text>
                                </span>
                              </div>
                            );
                          },
                        },
                        { title: "数据标识", dataIndex: "key", render: (value: string) => <code>{value}</code> },
                        { title: "数据量", dataIndex: "rows", width: 110, render: (value: number) => `${value || 0} 行` },
                        { title: "接入状态", key: "connected", width: 110, render: () => <Tag className="enterprise-data-tag-success">已接入</Tag> },
                        {
                          title: "AI 使用", key: "ai", width: 110,
                          render: (_: unknown, row: any) => (
                            row.trustedVersion
                              ? <Tag className="enterprise-data-tag-success">可用</Tag>
                              : <Tag className="enterprise-data-tag-muted">未发布</Tag>
                          ),
                        },
                        {
                          title: "操作", key: "action", width: 120,
                          render: (_: unknown, row: any) => (
                            <Space onClick={(event) => event.stopPropagation()}>
                              <Button className="enterprise-data-action-link" size="small" type="link" icon={<EyeOutlined />} onClick={() => void openAssetDetail(row.table)}>
                                查看详情
                              </Button>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  ) : <Empty description="还没有企业数据，请先连接数据源或导入文件" />}
                  <div className="enterprise-data-source-note">
                    <DatabaseOutlined /> 当前来源：{source === "postgres" ? "PostgreSQL 企业主库" : "DuckDB 本地数据文件"}
                    {path && <Typography.Text type="secondary" ellipsis>{path}</Typography.Text>}
                  </div>
                </div>
          )}

          {activeSection === "imports" && (
                    <div className="enterprise-data-section">
                      <div className="enterprise-data-section-heading">
                        <div><Typography.Title level={5}>接入新的企业数据</Typography.Title><Typography.Text type="secondary">通过业务系统连接器持续同步数据；销售账文件是现有的专项模板，不是唯一接入方式。</Typography.Text></div>
                        <Space wrap>
                          <Button icon={<CloudSyncOutlined />} loading={syncing} onClick={doSync}>同步已配置吉客云</Button>
                          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/connectors")}>管理数据连接</Button>
                        </Space>
                      </div>
                      <Alert
                        type="info"
                        showIcon
                        message="已有数据无需重复导入"
                        description="如果数据已经出现在“数据资产”中，直接使用“设为可信数据”即可。只有新增文件来源时才需要使用下方导入模板。"
                        action={<Button size="small" onClick={() => setActiveSection("assets")}>查看已有资产</Button>}
                      />
                      <div className="enterprise-data-template-toolbar">
                        <div><Typography.Text strong>专项文件模板</Typography.Text><Typography.Text type="secondary">当前已提供销售明细账的字段校验、映射和对账流程。</Typography.Text></div>
                        <Space wrap><Button icon={<PlusOutlined />} onClick={() => setMappingOpen(true)}>新建映射</Button><Button icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传销售账模板</Button></Space>
                      </div>
                  <Typography.Title level={5} className="enterprise-data-table-title">导入批次</Typography.Title>
                  <Table rowKey={(r) => `raw-${r.id}`} size="small" pagination={{ pageSize: 5 }} dataSource={rawImports} locale={{ emptyText: "暂无导入批次" }} columns={[
                    { title: "批次", dataIndex: "import_key", ellipsis: true },
                    { title: "处理状态", dataIndex: "status", render: (value: string) => <Tag>{value}</Tag> },
                    { title: "原始数据", dataIndex: "row_count", render: (value: number) => `${value || 0} 行` },
                    { title: "已接纳", dataIndex: "accepted_row_count", render: (value: number) => `${value || 0} 行` },
                    { title: "时间范围", dataIndex: "boundary_covered", render: (value: boolean) => <Tag color={value ? "green" : "red"}>{value ? "完整" : "不完整"}</Tag> },
                    { title: "对账", dataIndex: "reconciliation_status" },
                    { title: "操作", render: (_: unknown, row: any) => row.reconciliation_status === "pending" ? <Button size="small" onClick={() => void reconcileImport(row)}>完成对账</Button> : <Typography.Text type="secondary">已生成数据版本 {row.snapshot_id || ""}</Typography.Text> },
                  ]} />
                  <Typography.Title level={5} className="enterprise-data-table-title">字段映射</Typography.Title>
                  <Table rowKey={(r) => `mapping-${r.id}`} size="small" pagination={{ pageSize: 5 }} dataSource={referenceMappings} locale={{ emptyText: "暂无字段映射" }} columns={[
                    { title: "映射名称", dataIndex: "mapping_key" },
                    { title: "业务对象", dataIndex: "kind" },
                    { title: "版本", dataIndex: "version" },
                    { title: "映射数量", dataIndex: "entry_count", render: (value: number) => `${value || 0} 项` },
                    { title: "确认状态", dataIndex: "status", render: (value: string) => <Tag color={value === "confirmed" ? "green" : "orange"}>{value === "confirmed" ? "已确认" : "待确认"}</Tag> },
                    { title: "操作", render: (_: unknown, row: any) => row.status === "candidate" ? <Button size="small" onClick={() => void confirmMapping(row.id)}>管理员确认</Button> : null },
                  ]} />
                </div>
          )}

          {activeSection === "trusted" && (
                <div className="enterprise-data-section">
                  <div className="enterprise-data-section-heading">
                    <div><Typography.Title level={5}>可追溯的数据版本</Typography.Title><Typography.Text type="secondary">每个版本都记录来源、数据截至时间、完整度和口径，供任务稳定复用。</Typography.Text></div>
                    <Button icon={<MergeCellsOutlined />} onClick={() => setComposeOpen(true)}>组合分析数据</Button>
                  </div>
                  <Row gutter={[12, 12]} className="enterprise-data-inline-stats">
                    <Col xs={12} md={6}><Statistic title="数据版本" value={snapshots.length} /></Col>
                    <Col xs={12} md={6}><Statistic title="已通过治理" value={governedSnapshots.length} /></Col>
                    <Col xs={12} md={6}><Statistic title="指标口径" value={contracts.length} /></Col>
                    <Col xs={12} md={6}><Statistic title="指标结果" value={metrics.length} /></Col>
                  </Row>
                  <Table rowKey={(r) => `snapshot-${r.id}`} size="small" pagination={{ pageSize: 5 }} dataSource={snapshots} locale={{ emptyText: "还没有可信数据版本" }} columns={snapshotColumns} />
                  <Typography.Title level={5} className="enterprise-data-table-title">经营指标</Typography.Title>
                  <Table rowKey={(r) => `${r.metric}-${r.dim}-${r.dt}`} size="small" pagination={{ pageSize: 8 }} dataSource={metrics} locale={{ emptyText: "暂无指标结果" }} columns={[
                    { title: "日期", dataIndex: "dt" }, { title: "指标", dataIndex: "metric" }, { title: "维度", dataIndex: "dim" },
                    { title: "数值", dataIndex: "value", render: (v: number) => typeof v === "number" ? +v.toFixed(4) : v },
                    { title: "环比", dataIndex: "mom", render: (v: number | null) => v == null ? <Tag>—</Tag> : <Tag color={v >= 0 ? "green" : "red"}>{(v * 100).toFixed(1)}%</Tag> },
                    { title: "计算口径", dataIndex: "formula", render: (v: string) => v ? <code className="enterprise-data-formula">{v}</code> : "—" },
                  ]} />
                </div>
          )}

          {activeSection === "quality" && (
                <div className="enterprise-data-section">
                  <div className="enterprise-data-section-heading"><div><Typography.Title level={5}>数据质量问题</Typography.Title><Typography.Text type="secondary">这里集中展示影响数据可信度的问题和触发规则。</Typography.Text></div></div>
                  <Table rowKey={(r) => `${r.scope}-${r.metric}-${r.dt}`} size="small" pagination={{ pageSize: 8 }} dataSource={anomalies} locale={{ emptyText: "当前没有数据质量异常" }} columns={[
                    { title: "日期", dataIndex: "dt" }, { title: "数据范围", dataIndex: "scope" }, { title: "指标", dataIndex: "metric" },
                    { title: "级别", dataIndex: "level", render: (v: string) => <Tag color={v === "critical" ? "red" : v === "warning" ? "orange" : "blue"}>{v === "critical" ? "严重" : v === "warning" ? "警告" : "提示"}</Tag> },
                    { title: "问题说明", dataIndex: "detail" },
                    { title: "触发规则", dataIndex: "rule", render: (v: string) => v ? <code className="enterprise-data-formula">{v}</code> : "—" },
                  ]} />
                </div>
          )}
        </div>
      </Card>

      <Drawer
        rootClassName="enterprise-data-detail-drawer"
        placement="right"
        width="min(760px, 92vw)"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        destroyOnClose
        closable={false}
        title={null}
        footer={selectedAsset && !assetDetail?.trusted_versions?.length ? (
          <div className="enterprise-data-detail-footer">
            <Button onClick={() => setDetailOpen(false)}>关闭</Button>
            <Button type="primary" className="enterprise-data-btn-create" onClick={() => openTrustAsset(selectedAsset.table, selectedAsset.key, selectedAsset.name)}>
              发布为可信数据
            </Button>
          </div>
        ) : (
          <div className="enterprise-data-detail-footer is-single">
            <Button type="primary" className="enterprise-data-btn-create" onClick={() => setDetailOpen(false)}>完成</Button>
          </div>
        )}
      >
        <div className="enterprise-data-detail-shell">
          <header className="enterprise-data-detail-header">
            <div>
              <span className="enterprise-data-detail-kicker">数据资产详情</span>
              {selectedAsset ? (
                <div className="enterprise-data-detail-title-row">
                  <h3>{selectedAsset.name}</h3>
                  <Tag className="enterprise-data-tag-category">{selectedAsset.category}</Tag>
                </div>
              ) : (
                <h3>加载中…</h3>
              )}
              {selectedAsset ? <p>{selectedAsset.description}</p> : null}
            </div>
            <button type="button" className="enterprise-data-detail-close" aria-label="关闭" onClick={() => setDetailOpen(false)}>
              <CloseOutlined />
            </button>
          </header>

          <Spin spinning={detailLoading}>
            {selectedAsset && (
              <div className="enterprise-data-detail-body">
                <div className="enterprise-data-detail-hero">
                  <span className={`enterprise-data-list-icon is-${iconTone(selectedAsset.table, selectedAsset.category)}`}>
                    {iconTone(selectedAsset.table, selectedAsset.category) === "quality"
                      ? <SafetyCertificateOutlined />
                      : <DatabaseOutlined />}
                  </span>
                  <div className="enterprise-data-detail-hero-copy">
                    <strong>{selectedAsset.key}</strong>
                    <span>{selectedAsset.table}</span>
                  </div>
                </div>

                <div className="enterprise-data-detail-meta">
                  <div className="enterprise-data-detail-meta-item">
                    <span>数据标识</span>
                    <code>{selectedAsset.key}</code>
                  </div>
                  <div className="enterprise-data-detail-meta-item">
                    <span>物理表</span>
                    <code>{selectedAsset.table}</code>
                  </div>
                  <div className="enterprise-data-detail-meta-item">
                    <span>数据来源</span>
                    <strong>{assetDetail?.source === "postgres" ? "PostgreSQL 企业主库" : "DuckDB 本地数据"}</strong>
                  </div>
                  <div className="enterprise-data-detail-meta-item">
                    <span>数据量</span>
                    <strong>{assetDetail?.row_count ?? 0} 行</strong>
                  </div>
                  <div className="enterprise-data-detail-meta-item">
                    <span>可信状态</span>
                    {assetDetail?.trusted_versions?.length ? (
                      <Tag className="enterprise-data-tag-success">已发布 {assetDetail.trusted_versions.length} 个版本</Tag>
                    ) : (
                      <Tag className="enterprise-data-tag-muted">未发布</Tag>
                    )}
                  </div>
                  <div className="enterprise-data-detail-meta-item">
                    <span>当前预览</span>
                    <strong>{assetDetail?.preview_count ?? 0} 行</strong>
                  </div>
                </div>

                <section className="enterprise-data-detail-panel">
                  <div className="enterprise-data-detail-panel-head">
                    <h4>字段结构</h4>
                    <span>{assetDetail?.columns?.length ?? 0} 个字段</span>
                  </div>
                  <div className="enterprise-data-detail-fields">
                    {assetDetail?.columns?.length ? assetDetail.columns.map((column: string) => (
                      <span key={column} className="enterprise-data-detail-field-chip">{column}</span>
                    )) : <Typography.Text type="secondary">暂无字段信息</Typography.Text>}
                  </div>
                </section>

                <section className="enterprise-data-detail-panel">
                  <div className="enterprise-data-detail-panel-head">
                    <h4>数据预览</h4>
                    <span>最多显示前 50 行，只读</span>
                  </div>
                  <Table
                    className="enterprise-data-detail-preview-table"
                    rowKey="__preview_key"
                    size="small"
                    scroll={{ x: "max-content" }}
                    pagination={false}
                    dataSource={(assetDetail?.rows || []).map((row: any, index: number) => ({ ...row, __preview_key: index }))}
                    columns={(assetDetail?.columns || []).map((column: string) => ({
                      title: column,
                      dataIndex: column,
                      key: column,
                      ellipsis: true,
                      width: column === "detail" ? 220 : 120,
                      render: (value: unknown) => value != null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "—"),
                    }))}
                    locale={{ emptyText: "该资产暂无可预览数据" }}
                  />
                </section>

                <section className="enterprise-data-detail-panel">
                  <div className="enterprise-data-detail-panel-head">
                    <h4>可用版本</h4>
                    <span>{assetDetail?.trusted_versions?.length ?? 0} 个版本</span>
                  </div>
                  <Table
                    className="enterprise-data-detail-versions-table"
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={assetDetail?.trusted_versions || []}
                    columns={[
                      { title: "版本", dataIndex: "snapshot_key", ellipsis: true },
                      {
                        title: "数据截至",
                        dataIndex: "as_of",
                        width: 168,
                        render: (value: string) => formatDrawerDateTime(value),
                      },
                      { title: "数据量", dataIndex: "row_count", width: 90, render: (value: number) => `${value || 0} 行` },
                      {
                        title: "状态",
                        width: 110,
                        render: () => <Tag className="enterprise-data-tag-success"><RobotOutlined /> AI 可用</Tag>,
                      },
                    ]}
                    locale={{ emptyText: "尚未发布可用版本" }}
                  />
                </section>
              </div>
            )}
          </Spin>
        </div>
      </Drawer>

      <Modal
        title="发布为可信数据"
        open={trustOpen}
        onCancel={() => setTrustOpen(false)}
        onOk={() => void publishTrustedAsset()}
        confirmLoading={trustSaving}
        okText="发布可信版本"
        okButtonProps={{ disabled: !trustDraft.confirmed }}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={trustAsset ? `${trustAsset.name}（${trustAsset.key}）` : "当前数据资产"}
            description="系统将读取当前数据、计算内容 Hash，并保存不可变版本。后续 AI 任务会引用这个版本，不会直接读取持续变化的物理表。"
          />
          <label className="enterprise-data-field">
            <Typography.Text strong>数据截至时间</Typography.Text>
            <Input
              type="datetime-local"
              value={trustDraft.asOf.slice(0, 16)}
              onChange={(event) => setTrustDraft((value) => ({
                ...value,
                asOf: event.target.value ? new Date(event.target.value).toISOString() : "",
              }))}
            />
          </label>
          <Checkbox
            checked={trustDraft.confirmed}
            onChange={(event) => setTrustDraft((value) => ({ ...value, confirmed: event.target.checked }))}
          >
            我已确认当前数据范围完整，来源和更新时间准确
          </Checkbox>
          <Typography.Text type="secondary">
            发布不会修改或删除原始数据；当数据更新后，可以再次发布新的可信版本。
          </Typography.Text>
        </Space>
      </Modal>

      <Modal
        title="新建企业映射候选"
        open={mappingOpen}
        onCancel={() => setMappingOpen(false)}
        onOk={() => void saveMapping()}
        confirmLoading={mappingSaving}
        okText="创建候选"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert type="info" showIcon message="候选映射创建后，必须由企业管理员确认才能参与销售账导入。" />
          <Input
            placeholder="映射名称，例如 unove.channel.v1"
            value={mappingDraft.key}
            onChange={(event) => setMappingDraft((value) => ({ ...value, key: event.target.value }))}
          />
          <Select
            style={{ width: "100%" }}
            value={mappingDraft.kind}
            onChange={(kind) => setMappingDraft((value) => ({ ...value, kind }))}
            options={[
              { value: "channel", label: "渠道映射" },
              { value: "product", label: "商品映射" },
              { value: "warehouse", label: "仓库映射" },
            ]}
          />
          <Input.TextArea
            rows={10}
            value={mappingDraft.json}
            onChange={(event) => setMappingDraft((value) => ({ ...value, json: event.target.value }))}
            placeholder={'渠道示例：{"天猫旗舰店":{"order_class":"天猫"}}\n商品示例：{"原始SKU":{"sku_id":"SKU-1","product_type":"正装"}}'}
          />
        </Space>
      </Modal>

      <Modal
        title="上传受治理销售账"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={() => void uploadLedger()}
        confirmLoading={uploading}
        okText="安全试算"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="本操作不会发布业务 Fact，也不会写入 ERP。异常、退款、未知映射和不完整窗口会被门禁阻断。"
          />
          <Upload
            accept=".xlsx"
            maxCount={1}
            beforeUpload={(file) => { setLedgerFile(file); return false; }}
            onRemove={() => { setLedgerFile(null); }}
          >
            <Button icon={<UploadOutlined />}>选择 XLSX</Button>
          </Upload>
          <Select
            placeholder="导入契约"
            style={{ width: "100%" }}
            value={ledgerDraft.contractId || undefined}
            onChange={(contractId) => setLedgerDraft((value) => ({ ...value, contractId }))}
            options={importContracts.filter((row) => row.signoff_status === "confirmed").map((row) => ({
              value: row.id, label: `${row.contract_key}@${row.version}`,
            }))}
          />
          <Select
            placeholder="已确认渠道映射"
            style={{ width: "100%" }}
            value={ledgerDraft.channelMappingId || undefined}
            onChange={(channelMappingId) => setLedgerDraft((value) => ({ ...value, channelMappingId }))}
            options={referenceMappings.filter((row) => row.kind === "channel" && row.status === "confirmed").map((row) => ({
              value: row.id, label: `${row.mapping_key}@${row.version}`,
            }))}
          />
          <Select
            placeholder="已确认商品映射"
            style={{ width: "100%" }}
            value={ledgerDraft.productMappingId || undefined}
            onChange={(productMappingId) => setLedgerDraft((value) => ({ ...value, productMappingId }))}
            options={referenceMappings.filter((row) => row.kind === "product" && row.status === "confirmed").map((row) => ({
              value: row.id, label: `${row.mapping_key}@${row.version}`,
            }))}
          />
          <Space style={{ width: "100%" }}>
            <Input type="date" value={ledgerDraft.start} onChange={(event) => setLedgerDraft((value) => ({ ...value, start: event.target.value }))} />
            <Typography.Text>至</Typography.Text>
            <Input type="date" value={ledgerDraft.end} onChange={(event) => setLedgerDraft((value) => ({ ...value, end: event.target.value }))} />
          </Space>
        </Space>
      </Modal>

      <Modal
        title="组合补货 Snapshot"
        open={composeOpen}
        onCancel={() => setComposeOpen(false)}
        onOk={() => void composeSnapshot()}
        confirmLoading={composing}
        okText="生成组合 Snapshot"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert type="info" showIcon message="组合结果只保留 SKU、可用库存、在途库存、窗口销量和两端 lineage/hash。" />
          <Select
            placeholder="库存 Snapshot"
            style={{ width: "100%" }}
            value={composeDraft.inventorySnapshotId || undefined}
            onChange={(inventorySnapshotId) => setComposeDraft((value) => ({ ...value, inventorySnapshotId }))}
            options={snapshots.filter((row) => row.source_complete && !["jackyun_sales_ledger_export", "composite_inventory_sales"].includes(row.source_system)).map((row) => ({
              value: row.id, label: `${row.id} · ${row.source_system} · ${row.as_of}`,
            }))}
          />
          <Select
            placeholder="已对账销售 Snapshot"
            style={{ width: "100%" }}
            value={composeDraft.salesSnapshotId || undefined}
            onChange={(salesSnapshotId) => setComposeDraft((value) => ({ ...value, salesSnapshotId }))}
            options={snapshots.filter((row) => row.source_system === "jackyun_sales_ledger_export" && row.reconciliation_status === "passed").map((row) => ({
              value: row.id, label: `${row.id} · ${row.scope?.window_start || ""} 至 ${row.scope?.window_end || ""}`,
            }))}
          />
        </Space>
      </Modal>
    </Space>
  );
}
