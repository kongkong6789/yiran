import { Button, Space, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import LoopForceGraph from "../components/LoopForceGraph";

export default function Loops() {
  const nav = useNavigate();
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
            <Button size="small" type="text" onClick={() => nav("/loops")}>Loops 列表</Button>
            <Button size="small" type="text" onClick={() => nav("/commerce/loops/library")}>因果库</Button>
            <Button size="small" type="text" onClick={() => nav("/commerce/loops/diy")}>DIY</Button>
          </Space>
        </Space>
      </header>

      <LoopForceGraph />

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
