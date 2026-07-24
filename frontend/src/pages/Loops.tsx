import { App, Button, Space, Typography } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMetricContracts,
  listKnowledgeBases,
  type KnowledgeBaseItem,
} from "../api/client";
import LoopForceGraph from "../components/LoopForceGraph";
import { enrichAllLoopsAndBind } from "../loopsHierarchy/cpdBulkEnrich";
import type { MetricContractOption } from "../loopsHierarchy/cpdAutoBind";

export default function Loops() {
  const nav = useNavigate();
  const { message, modal } = App.useApp();
  const [graphKey, setGraphKey] = useState(0);
  const [enriching, setEnriching] = useState(false);

  const runBulkEnrich = async () => {
    const ok = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: "一键充实全部回路并接入数据？",
        content: "将为公司层与各层经营回路：补齐关联存量、标注店铺/仓库/SKU 分析维度，并自动绑定 DataLake 指标 / 吉客云 / 金蝶 / 知识库。已有绑定会被覆盖。",
        okText: "开始执行",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok || enriching) return;

    setEnriching(true);
    const hide = message.loading("正在充实全部回路并接入数据…", 0);
    try {
      const [contractRes, kbRes] = await Promise.all([
        getMetricContracts().catch(() => ({ results: [] as MetricContractOption[] })),
        listKnowledgeBases().catch(() => [] as KnowledgeBaseItem[]),
      ]);
      const rows = Array.isArray(contractRes)
        ? contractRes
        : (contractRes as { results?: MetricContractOption[] })?.results || [];
      const metrics: MetricContractOption[] = rows.map((row) => ({
        id: Number((row as MetricContractOption).id) || 0,
        metric_id: String((row as MetricContractOption).metric_id || ""),
        name: String((row as MetricContractOption).name || (row as MetricContractOption).metric_id || ""),
        unit: (row as MetricContractOption).unit ? String((row as MetricContractOption).unit) : undefined,
        version: (row as MetricContractOption).version ? String((row as MetricContractOption).version) : undefined,
      })).filter((row) => row.metric_id);

      const report = enrichAllLoopsAndBind({
        metrics,
        knowledgeBases: Array.isArray(kbRes) ? kbRes : [],
        overwriteBind: true,
      });
      setGraphKey((k) => k + 1);
      modal.success({
        title: "已完成一键充实与接入",
        content: (
          <div>
            <p>
              处理回路 <b>{report.loops}</b> 条；新增关联存量 <b>{report.nodesAdded}</b>；绑定节点 <b>{report.nodesBound}</b>。
            </p>
            <p style={{ color: "#64748b", fontSize: 12 }}>可在侧栏点 🖊 查看单条回路的节点数据源。</p>
          </div>
        ),
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "执行失败");
    } finally {
      hide();
      setEnriching(false);
    }
  };

  return (
    <div className="loops-kg-page">
      <header>
        <Space align="center" style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>回路图谱</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              公司经营回路 · 点右侧条目看清因果路径
            </Typography.Text>
          </div>
          <Space wrap size={6}>
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={enriching}
              onClick={() => void runBulkEnrich()}
            >
              {enriching ? "充实中…" : "一键充实并接入数据"}
            </Button>
            <Button size="small" type="text" onClick={() => nav("/loops")}>Loops 列表</Button>
            <Button size="small" type="text" onClick={() => nav("/commerce/loops/library")}>因果库</Button>
            <Button size="small" type="text" onClick={() => nav("/commerce/loops/diy")}>DIY</Button>
          </Space>
        </Space>
      </header>

      <LoopForceGraph key={graphKey} />

      <style>{`
        .loops-kg-page {
          width: 100%;
          max-width: none;
          min-height: calc(100vh - 120px);
          padding: 4px 4px 16px;
        }
        .loops-kg-page > header {
          margin-bottom: 6px;
        }
      `}</style>
    </div>
  );
}
