import { prisma } from "./prisma";

// ─────────────────────────────────────────────────────────────────────────────
// DealScore v1 — deterministic heuristic ($0 cost, no API calls).
//
// Every deal gets a single 0–100 score. Components are documented here AND
// stored per-deal as JSON so the number is always auditable in the UI
// ("How scoring works" popover) and in the database.
//
// WEIGHTS (max 100):
//   base        20   every verified deal starts here
//   discount    40   min(discountPct, 80) / 80 * 40 — deeper discounts score higher,
//                   capped so a fake "90% off" can't dominate
//   coupon      10   +10 if a coupon code is attached (extra savings layer)
//   freshness   15   15 * max(0, 1 - ageHours/72) — full points when fresh,
//                   decays to 0 after 72h (stale deals sink)
//   urgency     10   +10 if expiring within 48h, +5 if within 7 days, else 0
//   priceBand    5   +5 if salePrice <= $100 (accessible deals), +2 if <= $500
//
// Deliberately simple: transparent > clever. v2 can blend in Claude scoring
// behind the USE_CLAUDE_SCORING flag (see lib/scoring-claude.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type ScoreComponents = {
  base: number;
  discount: number;
  coupon: number;
  freshness: number;
  urgency: number;
  priceBand: number;
};

export type ScoredDeal = {
  score: number;
  components: ScoreComponents;
};

type ScorableDeal = {
  discountPct: number | null;
  couponCode: string | null;
  salePrice: number;
  createdAt: Date;
  expiresAt: Date | null;
};

export function computeDealScore(deal: ScorableDeal, now = new Date()): ScoredDeal {
  const components: ScoreComponents = {
    base: 20,
    discount: 0,
    coupon: 0,
    freshness: 0,
    urgency: 0,
    priceBand: 0,
  };

  // Discount depth (0–40)
  const pct = Math.min(Math.max(deal.discountPct ?? 0, 0), 80);
  components.discount = Math.round((pct / 80) * 40);

  // Coupon bonus (0 or 10)
  if (deal.couponCode && deal.couponCode.trim().length > 0) {
    components.coupon = 10;
  }

  // Freshness (0–15): linear decay over 72h
  const ageHours = Math.max(
    0,
    (now.getTime() - deal.createdAt.getTime()) / 3_600_000
  );
  components.freshness = Math.round(15 * Math.max(0, 1 - ageHours / 72));

  // Expiry urgency (0/5/10)
  if (deal.expiresAt) {
    const hoursLeft = (deal.expiresAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft > 0 && hoursLeft <= 48) components.urgency = 10;
    else if (hoursLeft <= 24 * 7) components.urgency = 5;
  }

  // Price band (0/2/5)
  if (deal.salePrice <= 100) components.priceBand = 5;
  else if (deal.salePrice <= 500) components.priceBand = 2;

  const total =
    components.base +
    components.discount +
    components.coupon +
    components.freshness +
    components.urgency +
    components.priceBand;

  return { score: Math.min(100, Math.max(0, total)), components };
}

export type ScoreJobResult = { scored: number; skipped: number };

// Recompute DealScore for deals that are unscored or whose score is stale
// (>24h old). Runs as part of the scheduled job pipeline.
export async function scoreDeals(limit = 500): Promise<ScoreJobResult> {
  const staleCutoff = new Date(Date.now() - 24 * 3_600_000);
  const deals = await prisma.deal.findMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      OR: [{ aiScore: null }, { scoredAt: { lt: staleCutoff } }],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let scored = 0;
  for (const deal of deals) {
    const { score, components } = computeDealScore(deal);
    await prisma.deal.update({
      where: { id: deal.id },
      data: {
        aiScore: score,
        scoreComponents: JSON.stringify(components),
        scoredAt: new Date(),
      },
    });
    scored++;
  }

  return { scored, skipped: 0 };
}
