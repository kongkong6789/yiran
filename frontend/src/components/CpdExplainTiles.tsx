import type { CpdLoopExplain } from "../loopsHierarchy/cpdLoopExplain";

const CHIP_FIELDS: { key: keyof CpdLoopExplain; label: string }[] = [
  { key: "stocks", label: "存量" },
  { key: "flows", label: "流量" },
];

const LINE_FIELDS: { key: keyof CpdLoopExplain; label: string }[] = [
  { key: "delays", label: "延迟" },
  { key: "behavior", label: "行为" },
  { key: "intervention", label: "干预" },
];

/** 柔和底色池，按 seed 稳定抽取，避免每帧乱闪 */
const TILE_PALETTE = [
  { bg: "#fff7ed", border: "#fdba74", text: "#9a3412" },
  { bg: "#eff6ff", border: "#93c5fd", text: "#1e3a8a" },
  { bg: "#f0fdf4", border: "#86efac", text: "#14532d" },
  { bg: "#fdf4ff", border: "#e9d5ff", text: "#581c87" },
  { bg: "#fff1f2", border: "#fda4af", text: "#9f1239" },
  { bg: "#ecfeff", border: "#67e8f9", text: "#155e75" },
  { bg: "#fefce8", border: "#fde047", text: "#854d0e" },
  { bg: "#f8fafc", border: "#cbd5e1", text: "#334155" },
  { bg: "#fdf2f8", border: "#f9a8d4", text: "#9d174d" },
  { bg: "#eef2ff", border: "#a5b4fc", text: "#3730a3" },
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function paletteFor(seed: string, index: number) {
  const h = hashSeed(`${seed}::${index}::chip`);
  return TILE_PALETTE[h % TILE_PALETTE.length];
}

/** 去掉顿号等列表分隔，拆成一块一块 */
function splitExplainItems(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  return raw
    .split(/[、；;|/]+/)
    .map((part) => part.replace(/^[\s，,]+|[\s，,]+$/g, "").trim())
    .filter(Boolean);
}

export function CpdExplainTiles({
  explain,
  seed = "loop",
  compact = false,
}: {
  explain: CpdLoopExplain;
  seed?: string;
  compact?: boolean;
}) {
  let chipIndex = 0;

  return (
    <div className={`cpd-explain-sections${compact ? " is-compact" : ""}`}>
      {CHIP_FIELDS.map((field) => {
        const items = splitExplainItems(explain[field.key] || "");
        if (!items.length) return null;
        return (
          <div key={field.key} className="cpd-explain-line is-chips">
            <span>{field.label}</span>
            <div className="cpd-explain-chips">
              {items.map((item) => {
                const tone = paletteFor(seed, chipIndex);
                chipIndex += 1;
                return (
                  <span
                    key={`${field.key}-${item}`}
                    className="cpd-explain-chip"
                    style={{
                      background: tone.bg,
                      borderColor: tone.border,
                      color: tone.text,
                    }}
                  >
                    {item}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}

      {LINE_FIELDS.map((field) => {
        const value = (explain[field.key] || "").trim();
        if (!value) return null;
        return (
          <div key={field.key} className="cpd-explain-line">
            <span>{field.label}</span>
            <p>{value}</p>
          </div>
        );
      })}
    </div>
  );
}
