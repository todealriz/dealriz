// "How scoring works" — transparent explainer for the DealScore.
// Rendered as a native <details> popover; no JS needed.
export function ScoreExplainer() {
  return (
    <details className="group relative inline-block">
      <summary className="cursor-pointer list-none text-xs font-medium text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-800">
        How scoring works
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600 shadow-xl">
        <p className="mb-2 font-semibold text-slate-900">
          DealScore (0–100) — deterministic v1
        </p>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>Base 20</b> — every verified deal starts here.</li>
          <li><b>Discount up to 40</b> — deeper discounts score higher (capped at 80% off).</li>
          <li><b>Coupon +10</b> — extra savings layer attached.</li>
          <li><b>Freshness up to 15</b> — newer deals score higher; decays over 72h.</li>
          <li><b>Urgency up to 10</b> — expiring within 48h scores higher.</li>
          <li><b>Price band up to 5</b> — accessible prices get a small boost.</li>
        </ul>
        <p className="mt-2 text-slate-500">
          Scores are algorithmic, not financial advice. Components are stored
          per deal for full transparency.
        </p>
      </div>
    </details>
  );
}
