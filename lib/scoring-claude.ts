import type { ScoredDeal } from "./scoring";

// ─────────────────────────────────────────────────────────────────────────────
// Claude scoring adapter — STUB (not used by default).
//
// The deterministic heuristic in lib/scoring.ts is the v1 default ($0).
// If you later want LLM-based scoring:
//
//   1. Set USE_CLAUDE_SCORING=true and ANTHROPIC_API_KEY in your env.
//   2. Implement `scoreWithClaude()` below using the Anthropic SDK
//      (`npm i @anthropic-ai/sdk`) with the suggested prompt.
//   3. In lib/jobs.ts, branch on the env flag to call this instead of
//      computeDealScore().
//
// Cost guidance: score in batches, cache results (we already store scoredAt),
// and prefer a cheap model (e.g. claude-haiku) — scoring text is a small task.
// ─────────────────────────────────────────────────────────────────────────────

export const CLAUDE_SCORING_ENABLED = process.env.USE_CLAUDE_SCORING === "true";

// Suggested prompt (tune before spending money):
//
//   You are a deal analyst. Score this deal 0-100 for a bargain hunter.
//   Consider: true discount depth vs MSRP, brand reputation, price history
//   plausibility, coupon stacking, and expiry urgency.
//   Reply with ONLY valid JSON: {"score": 82, "reasons": ["..."]}
//
//   Deal: {title} — sale ${salePrice} (was ${originalPrice}), coupon: {couponCode}

export async function scoreWithClaude(_deal: {
  title: string;
  salePrice: number;
  originalPrice?: number | null;
  couponCode?: string | null;
  description?: string | null;
}): Promise<ScoredDeal> {
  if (!CLAUDE_SCORING_ENABLED) {
    throw new Error(
      "Claude scoring is disabled. Set USE_CLAUDE_SCORING=true and ANTHROPIC_API_KEY to enable."
    );
  }
  // TODO: implement with @anthropic-ai/sdk — intentionally left as a stub so
  // v1 never incurs API costs by accident.
  throw new Error("scoreWithClaude() is not implemented yet (stub).");
}
