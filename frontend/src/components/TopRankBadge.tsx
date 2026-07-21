import rank1Icon from "../assets/ranks/rank-1.png";
import rank2Icon from "../assets/ranks/rank-2.png";
import rank3Icon from "../assets/ranks/rank-3.png";

type MedalRank = 1 | 2 | 3;

const RANK_ICON: Record<MedalRank, string> = {
  1: rank1Icon,
  2: rank2Icon,
  3: rank3Icon,
};

export function TopRankBadge({ rank }: { rank: number }) {
  return (
    <span className="logs-top-rank-slot">
      {rank <= 3 ? (
        <span className={`logs-top-shield rank-${rank}`} aria-label={`第 ${rank} 名`}>
          <img
            src={RANK_ICON[rank as MedalRank]}
            alt=""
            className="logs-top-shield-img"
            draggable={false}
          />
        </span>
      ) : (
        <span className="logs-top-rank-num">{rank}</span>
      )}
    </span>
  );
}

export function TopRankWatermark({ rank }: { rank: MedalRank }) {
  return (
    <svg className={`logs-top-watermark rank-${rank}`} viewBox="0 0 64 64" aria-hidden>
      <path
        fill="currentColor"
        d="M18 40h28l-3.2-10.4 5.6-4.6-6.8-1.8L32 28.8 28.4 22l-4.2 1.8-6.8 1.8 5.6 4.6L18 40zm-2.2 4.2a1.4 1.4 0 0 0 1.4 1.4h31.6a1.4 1.4 0 0 0 1.4-1.4v-2H15.8v2z"
      />
    </svg>
  );
}
