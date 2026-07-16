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
            <Typography.Paragraph type="secondary" style={{ margin: "6px 0 12px", maxWidth: 760 }}>
              六层经营动力学图谱。其他融合能力见{" "}
              <a onClick={() => nav("/commerce")}>经营首页</a>
              {" "}或{" "}
              <a onClick={() => nav("/commerce/bench")}>经营工作台</a>。
            </Typography.Paragraph>
          </div>
          <Button size="small" onClick={() => nav("/commerce")}>经营分类首页</Button>
        </Space>
      </header>

      <LoopForceGraph />

      <style>{`
        .loops-kg-page { width: 100%; max-width: none; }
        .loop-kg-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 8px;
          padding: 10px 14px;
          background: linear-gradient(180deg, #f8fafc, #f3f6fb);
          border: 1px solid #e6ecf4;
          border-radius: 12px;
        }
        .loop-kg-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 10px;
          font-size: 12px;
          color: #5c6b84;
        }
        .loop-kg-leg-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .loop-kg-leg-item i {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
        }
        .loop-kg-leg-item.is-btn {
          border: 1px solid transparent;
          background: transparent;
          cursor: pointer;
          padding: 2px 8px;
          border-radius: 999px;
        }
        .loop-kg-leg-item.is-btn:hover,
        .loop-kg-leg-item.is-btn.is-active {
          background: rgba(196, 146, 74, 0.12);
          border-color: rgba(184, 134, 59, 0.35);
        }
        .loop-kg-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 280px;
          gap: 14px;
          align-items: stretch;
        }
        .loop-kg-canvas {
          position: relative;
          height: calc(100vh - 240px);
          min-height: 480px;
          border: 1px solid #e6ecf4;
          border-radius: 14px;
          background:
            radial-gradient(ellipse at 30% 20%, rgba(196,146,74,0.08), transparent 50%),
            radial-gradient(ellipse at 70% 80%, rgba(11,33,68,0.06), transparent 45%),
            #f5f7fb;
          overflow: hidden;
        }
        .loop-kg-vignette {
          pointer-events: none;
          position: absolute;
          inset: 0;
          z-index: 1;
          background: radial-gradient(ellipse at center, transparent 55%, rgba(11,33,68,0.08) 100%);
        }
        .loop-kg-flash {
          pointer-events: none;
          position: absolute;
          left: 50%;
          top: 18%;
          transform: translate(-50%, -50%) scale(0.92);
          z-index: 3;
          padding: 10px 18px;
          border-radius: 999px;
          background: rgba(11, 33, 68, 0.88);
          color: #fff;
          font-weight: 650;
          font-size: 14px;
          letter-spacing: 0.02em;
          box-shadow: 0 12px 40px rgba(11, 33, 68, 0.25);
          opacity: 0;
          transition: opacity .2s, transform .35s cubic-bezier(.2,.9,.2,1);
        }
        .loop-kg-flash.is-on {
          transform: translate(-50%, -50%) scale(1);
        }
        .loop-kg-hint {
          position: absolute;
          left: 12px;
          bottom: 10px;
          z-index: 2;
          font-size: 11px;
          pointer-events: none;
        }
        .loop-kg-side {
          border: 1px solid #e6ecf4;
          border-radius: 14px;
          background: #fff;
          padding: 12px 14px;
          max-height: calc(100vh - 240px);
          overflow: auto;
        }
        .loop-kg-map {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .loop-kg-map-row {
          display: grid;
          grid-template-columns: 48px 56px 1fr;
          gap: 6px;
          font-size: 12px;
          align-items: center;
        }
        .loop-kg-map-row.is-btn {
          border: 1px solid #eef2f7;
          background: #f8fafc;
          border-radius: 8px;
          padding: 6px 8px;
          cursor: pointer;
          text-align: left;
          transition: border-color .15s, background .15s, transform .15s;
        }
        .loop-kg-map-row.is-btn:hover {
          border-color: #C4924A;
          transform: translateX(2px);
        }
        .loop-kg-map-row.is-btn.is-active {
          border-color: #C4924A;
          background: rgba(196, 146, 74, 0.1);
        }
        .loop-kg-map-lv { color: #5c6b84; }
        .loop-kg-map-ot { font-weight: 650; color: #0B2144; }
        .loop-kg-map-key {
          color: #8b96a8;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
        }
        .loop-kg-detail ul {
          margin: 8px 0 0;
          padding-left: 18px;
          font-size: 12px;
          color: #5c6b84;
        }
        .loop-kg-loops {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
        }
        .loop-kg-loop {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          text-align: left;
          border: 1px solid #eef2f7;
          background: #f8fafc;
          border-radius: 10px;
          padding: 8px 10px;
          cursor: pointer;
        }
        .loop-kg-loop.is-active {
          border-color: #C4924A;
          background: rgba(196, 146, 74, 0.08);
        }
        .loop-kg-loop-name {
          font-size: 13px;
          font-weight: 600;
          color: #172033;
        }
        .loop-kg-loop-path {
          font-size: 11px;
          color: #8b96a8;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        @media (max-width: 960px) {
          .loop-kg-body { grid-template-columns: 1fr; }
          .loop-kg-canvas { height: 520px; }
          .loop-kg-side { max-height: none; }
        }
      `}</style>
    </div>
  );
}
