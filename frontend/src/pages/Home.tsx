import { useNavigate } from "react-router-dom";

type Trigram = { name: string; sub: string; lines: number[] };

// 先天八卦顺序,从正上方顺时针:乾 兑 离 震 坤 艮 坎 巽
// lines 为从上到下三爻:1=阳(整),0=阴(断)
const TRIGRAMS: Trigram[] = [
  { name: "乾", sub: "技能", lines: [1, 1, 1] },
  { name: "兑", sub: "技能", lines: [1, 1, 0] },
  { name: "离", sub: "技能", lines: [1, 0, 1] },
  { name: "震", sub: "技能", lines: [1, 0, 0] },
  { name: "坤", sub: "技能", lines: [0, 0, 0] },
  { name: "艮", sub: "技能", lines: [0, 0, 1] },
  { name: "坎", sub: "技能", lines: [0, 1, 0] },
  { name: "巽", sub: "技能", lines: [0, 1, 1] },
];

const LEFT_IDEAS = [
  { t: "一核驱动", d: "以 AI 专家为中心,统一理解、决策与编排,不再各自为战。" },
  { t: "八卦为纲", d: "八类专家技能各司其职,组合成完整的业务能力矩阵。" },
  { t: "人机协同", d: "专家团圆桌共识,人可随时插话引导,让方案更贴业务。" },
];
const RIGHT_IDEAS = [
  { t: "知识沉淀", d: "RAG 检索 + 业务数据资料化,发言与方案有据可依。" },
  { t: "安全闸机", d: "越权、超预算、状态不符自动拦截,高风险动作先审后行。" },
  { t: "全程可溯", d: "从意图到执行全链路留痕,每个决策都可回放复盘。" },
];

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function TrigramGlyph({ lines }: { lines: number[] }) {
  const bar = {
    height: 6,
    borderRadius: 2,
    background: "#fff",
    boxShadow: "0 0 8px rgba(255,255,255,.8)",
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center" }}>
      {lines.map((v, i) =>
        v === 1 ? (
          <span key={i} style={{ ...bar, width: 48 }} />
        ) : (
          <span key={i} style={{ display: "flex", gap: 9 }}>
            <span style={{ ...bar, width: 19.5 }} />
            <span style={{ ...bar, width: 19.5 }} />
          </span>
        )
      )}
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const trigramR = 30;
  const personR = 46;

  return (
    <div className="bagua-page">
      <style>{keyframes}</style>

      <div className="bagua-hero">
        <div className="bagua-title">
          <div className="bagua-brand">良策 AI 专家团</div>
          <div className="bagua-slogan">一核八卦 · 人机协同 · 让每个业务问题都有专家会诊</div>
        </div>

        {/* 左侧理念 */}
        <div className="idea-col left">
          {LEFT_IDEAS.map((x, i) => (
            <div className="idea-card" key={x.t}>
              <h4><i>{String(i + 1).padStart(2, "0")}</i>{x.t}</h4>
              <p>{x.d}</p>
            </div>
          ))}
        </div>

        {/* 右侧理念 */}
        <div className="idea-col right">
          {RIGHT_IDEAS.map((x, i) => (
            <div className="idea-card" key={x.t}>
              <h4>{x.t}<i>{String(i + 4).padStart(2, "0")}</i></h4>
              <p>{x.d}</p>
            </div>
          ))}
        </div>

        <div className="bagua-scene">
          {/* 外层光晕 */}
          <div className="bagua-glow" />

          {/* 连接与协同:金色轨道线 */}
          <svg className="bagua-orbits" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            <circle cx="50" cy="50" r={personR} className="orbit-line" />
            <circle cx="50" cy="50" r={trigramR + 8} className="orbit-line dashed" />
            {TRIGRAMS.map((_, i) => {
              const ang = -90 + i * 45;
              const inner = polar(50, 50, trigramR + 8, ang);
              const outer = polar(50, 50, personR, ang);
              return (
                <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="spoke" />
              );
            })}
          </svg>

          {/* 八卦技能环(顺时针旋转) */}
          <div className="ring ring-spin">
            {TRIGRAMS.map((t, i) => {
              const ang = -90 + i * 45;
              const p = polar(50, 50, trigramR, ang);
              return (
                <div key={t.name} className="node trigram-node" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <div className="counter-spin trigram-inner">
                    <TrigramGlyph lines={t.lines} />
                    <div className="trigram-label"><b>{t.name}</b><span>{t.sub}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 外圈"人"节点(逆时针旋转) */}
          <div className="ring ring-spin-rev">
            {TRIGRAMS.map((_, i) => {
              const ang = -90 + i * 45;
              const p = polar(50, 50, personR, ang);
              return (
                <div key={i} className="node person-node" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <div className="counter-spin-rev">
                    <div className="person-badge">人</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 中心太极:AI 专家核心 */}
          <div className="taichi-wrap">
            <div className="taichi-ring" />
            <div className="taichi">
              <div className="taichi-dot dot-top" />
              <div className="taichi-dot dot-bottom" />
            </div>
            <div className="taichi-core-label">AI 专家</div>
          </div>
        </div>

        {/* 图例 + 入口 */}
        <div className="bagua-legend">
          <span><i className="lg-dot person" />人(团队 / 协作 / 资源)</span>
          <span><i className="lg-line" />连接与协同</span>
          <span><i className="lg-dot core" />AI 专家(核心)</span>
        </div>

        <div className="bagua-actions">
          <button className="btn-primary" onClick={() => nav("/council")}>发起圆桌会议</button>
          <button className="btn-ghost" onClick={() => nav("/agents")}>管理专家对象</button>
          <button className="btn-ghost" onClick={() => nav("/architecture")}>查看架构</button>
        </div>
      </div>
    </div>
  );
}

const keyframes = `
.bagua-page { margin: -16px; }
.bagua-hero {
  position: relative;
  min-height: calc(100vh - 56px);
  background:
    radial-gradient(1300px 680px at 50% 16%, #1b1c3a 0%, #0c0d1f 55%, #07070f 100%);
  color: #e9e9f5;
  display: flex; flex-direction: column; align-items: center;
  padding: 22px 16px 34px; overflow: hidden;
}
.bagua-title { text-align: center; margin-bottom: 4px; }
.bagua-brand {
  font-size: 34px; font-weight: 800; letter-spacing: 4px;
  background: linear-gradient(90deg, #ffe08a, #ffd15c, #b98a2e);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.bagua-slogan { color: #9aa0c7; margin-top: 6px; font-size: 14px; letter-spacing: 1px; }

.bagua-scene {
  position: relative;
  width: min(80vh, 720px, 52vw); aspect-ratio: 1;
  margin: 6px auto 2px;
}
.bagua-glow {
  position: absolute; inset: 12%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 45%, rgba(124,108,255,.35), rgba(90,70,200,.10) 55%, transparent 70%);
  filter: blur(6px);
  animation: pulse 5s ease-in-out infinite;
}
@keyframes pulse { 0%,100%{opacity:.55} 50%{opacity:.95} }

.bagua-orbits { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.orbit-line { fill: none; stroke: rgba(214,178,94,.45); stroke-width: .25; }
.orbit-line.dashed { stroke-dasharray: .8 1.6; stroke: rgba(214,178,94,.5); }
.spoke { stroke: rgba(214,178,94,.35); stroke-width: .18; stroke-dasharray: .6 1.2; }

.ring { position: absolute; inset: 0; transform-origin: 50% 50%; }
.ring-spin { animation: spin 46s linear infinite; }
.ring-spin-rev { animation: spin-rev 60s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes spin-rev { to { transform: rotate(-360deg); } }
.counter-spin { animation: spin-rev 46s linear infinite; }
.counter-spin-rev { animation: spin 60s linear infinite; }

.node { position: absolute; transform: translate(-50%, -50%); }
.trigram-inner { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.trigram-label { text-align: center; line-height: 1.15; }
.trigram-label b { color: #ffe08a; font-size: 19px; letter-spacing: 2px; }
.trigram-label span { display: block; color: #9aa0c7; font-size: 12px; }

.person-badge {
  width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 700; color: #dfe6ff;
  background: radial-gradient(circle at 35% 30%, #2b3f8f, #10204f 70%);
  border: 2px solid rgba(214,178,94,.75);
  box-shadow: 0 0 16px rgba(60,90,200,.6), inset 0 0 10px rgba(120,150,255,.35);
}

.taichi-wrap {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 44%; aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
}
.taichi-ring {
  position: absolute; inset: -8%; border-radius: 50%;
  border: 1px dashed rgba(214,178,94,.55);
  animation: spin 24s linear infinite;
}
/* 标准阴阳鱼(带 S 曲线) */
.taichi {
  position: relative; width: 100%; height: 100%; border-radius: 50%;
  background: linear-gradient(90deg, #e9e6ff 0 50%, #16132e 50% 100%);
  box-shadow: 0 0 48px rgba(120,100,255,.55), inset 0 0 42px rgba(0,0,0,.45);
  animation: spin 22s linear infinite; overflow: hidden;
}
.taichi::before, .taichi::after {
  content: ""; position: absolute; left: 25%; width: 50%; height: 50%; border-radius: 50%;
}
.taichi::before { top: 0; background: #16132e; }
.taichi::after { top: 50%; background: #e9e6ff; }
.taichi-dot {
  position: absolute; left: 50%; width: 14%; aspect-ratio: 1; border-radius: 50%;
  transform: translate(-50%, -50%); z-index: 1;
}
.dot-top { top: 25%; background: #e9e6ff; }
.dot-bottom { top: 75%; background: #16132e; }
.taichi-core-label {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  font-size: 26px; font-weight: 800; letter-spacing: 2px; color: #fff;
  text-shadow: 0 2px 12px rgba(0,0,0,.9), 0 0 18px rgba(140,120,255,.6);
  pointer-events: none; z-index: 2;
}

/* 理念栏 */
.idea-col {
  position: absolute; top: 52%; transform: translateY(-50%);
  width: 240px; display: flex; flex-direction: column; gap: 16px; z-index: 2;
}
.idea-col.left { left: 3%; }
.idea-col.right { right: 3%; text-align: right; }
.idea-card {
  background: rgba(20,23,40,.5); border: 1px solid rgba(214,178,94,.26);
  border-radius: 14px; padding: 14px 16px; backdrop-filter: blur(6px);
  transition: all .2s ease;
}
.idea-card:hover { border-color: rgba(214,178,94,.6); transform: translateY(-2px); }
.idea-card h4 {
  margin: 0 0 6px; color: #ffe08a; font-size: 15px; letter-spacing: 1px;
  display: flex; align-items: center; gap: 8px;
}
.idea-col.right .idea-card h4 { justify-content: flex-end; }
.idea-card h4 i {
  font-style: normal; font-size: 12px; font-weight: 700; color: #0c0d1f;
  background: linear-gradient(90deg, #ffe08a, #ffca4a); border-radius: 6px; padding: 1px 6px;
}
.idea-card p { margin: 0; color: #aab0d6; font-size: 12.5px; line-height: 1.65; }
@media (max-width: 1180px) { .idea-col { display: none; } }

.bagua-legend {
  display: flex; gap: 26px; flex-wrap: wrap; justify-content: center;
  margin-top: 8px; color: #aab0d6; font-size: 13px;
}
.bagua-legend span { display: inline-flex; align-items: center; gap: 8px; }
.lg-dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
.lg-dot.person { background: radial-gradient(circle at 35% 30%, #2b3f8f, #10204f); border: 1px solid rgba(214,178,94,.8); }
.lg-dot.core { background: radial-gradient(circle at 35% 30%, #b9b3e6, #4a3f8f); }
.lg-line { width: 22px; height: 0; border-top: 2px dashed rgba(214,178,94,.8); display: inline-block; }

.bagua-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 18px; }
.btn-primary, .btn-ghost {
  cursor: pointer; border-radius: 22px; padding: 9px 22px; font-size: 14px; font-weight: 600;
  transition: all .2s ease;
}
.btn-primary {
  color: #2a1e00; border: none;
  background: linear-gradient(90deg, #ffe08a, #ffca4a);
  box-shadow: 0 6px 18px rgba(255,190,60,.35);
}
.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(255,190,60,.5); }
.btn-ghost {
  color: #dfe6ff; background: rgba(255,255,255,.06);
  border: 1px solid rgba(214,178,94,.5);
}
.btn-ghost:hover { background: rgba(255,255,255,.12); transform: translateY(-2px); }

@media (max-width: 600px) {
  .bagua-scene { width: 92vw; }
  .bagua-brand { font-size: 26px; }
}
`;
