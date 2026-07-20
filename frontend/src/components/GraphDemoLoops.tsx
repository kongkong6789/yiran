import { useEffect, useState } from "react";
import { Button, Empty, Space, Spin, Tag, Typography } from "antd";
import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { listLoops, type FeedbackLoop } from "../api/client";
import LoopRingDiagram from "./LoopRingDiagram";

const TYPE_COLOR: Record<string, string> = { R: "red", B: "blue", comp: "purple" };

type Props = {
  onOpenDetail?: (id: number) => void;
};

export default function GraphDemoLoops({ onOpenDetail }: Props) {
  const [loops, setLoops] = useState<FeedbackLoop[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listLoops({ includeMembers: true });
      const withMembers = list.results
        .filter((l) => (l.member_count || 0) > 0 && l.status !== "archived")
        .sort((a, b) => {
          const ad = a.code.startsWith("GRAPH-DEMO") ? 0 : 1;
          const bd = b.code.startsWith("GRAPH-DEMO") ? 0 : 1;
          if (ad !== bd) return ad - bd;
          return (b.updated_at || "").localeCompare(a.updated_at || "");
        });
      setLoops(withMembers.filter((l) => (l.members || []).length > 0));
      setActive(0);
    } catch {
      setLoops([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin tip="加载闭环…" />
      </div>
    );
  }

  if (!loops.length) {
    return (
      <Empty
        description="暂无带因果成员的闭环。可运行 seed_graph_loops 或在图谱标边后手工创建。"
        style={{ padding: 32 }}
      >
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>重新加载</Button>
      </Empty>
    );
  }

  const current = loops[active] || loops[0];

  return (
    <div style={{ padding: "4px 4px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <Typography.Text strong>全部闭环 · 共 {loops.length} 条</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", fontSize: 12 }}>
            点击标签打开详情弹窗（含闭环环图）。
          </Typography.Paragraph>
        </div>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
      </div>

      <Space wrap style={{ marginBottom: 12 }}>
        {loops.map((l, i) => (
          <Button
            key={l.id}
            type={i === active ? "primary" : "default"}
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setActive(i);
              onOpenDetail?.(l.id);
            }}
          >
            <Tag color={TYPE_COLOR[l.loop_type]} style={{ marginInlineEnd: 6 }}>{l.loop_type}</Tag>
            {l.code || l.name}
          </Button>
        ))}
      </Space>

      {/* 预览缩略；点图也进详情 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail?.(current.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpenDetail?.(current.id);
        }}
        style={{ cursor: "pointer" }}
        title="点击打开详情"
      >
        <LoopRingDiagram loop={current} compact />
      </div>
    </div>
  );
}
