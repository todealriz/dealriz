// SVG score ring: green-scale 0–100 DealScore badge (brand palette).
export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * c;
  // Green scale: strong = deep green, decent = lime, weak = neutral gray.
  const color =
    score >= 75 ? "#16a34a" : score >= 55 ? "#84cc16" : "#d1d5db";

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`DealScore ${score} out of 100`}
      title={`DealScore ${score}/100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="white"
          stroke="#e2e8f0"
          strokeWidth={5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
        />
      </svg>
      <span
        className="absolute font-extrabold text-navy-800"
        style={{ fontSize: Math.max(10, size * 0.28) }}
      >
        {score}
      </span>
    </div>
  );
}
