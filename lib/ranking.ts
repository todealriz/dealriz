import { prisma } from "./prisma";

// ─────────────────────────────────────────────────────────────────────────────
// DealRiz ranking engine — the transparent formula behind every placement.
//
// WHAT IT IS: a single documented function, computeRankScore(), that turns a
// deal + a little context into one number. Homepage grids, the /deals default
// sort, and Catch of the Day all derive from it — so placement is auditable,
// not vibes.
//
// THE FORMULA (all components documented; none hidden):
//   base            = aiScore (0–100, from lib/scoring.ts). The foundation.
//   freshnessBoost  = +25 * exp(-ageHours / 36). New deals surface hard and
//                     decay to ~+3 after 72h, so the page always feels fresh.
//   discountBonus   = +min(discountPct * 0.3, 15). Deeper discounts rank
//                     higher, capped so a bogus "90% off" can't dominate.
//   engagementBonus = +min(clicks24h, 50) * 0.4 (max +20). NOTE: this is pure
//                     noise until the site has real traffic — at zero clicks
//                     every deal gets +0 and ranking falls back to score +
//                     freshness + discount, which is the correct behavior.
//   priceDropBonus  = +10 if isPriceDrop (price fell >10% vs 30-day median).
//                     Fresh price drops deserve immediate visibility.
//   penalties       = −10 if no image, −5 if no originalPrice. Thin listings
//                     sink; complete listings float.
//   score = (base + freshnessBoost + discountBonus + engagementBonus
//            + priceDropBonus − penalties) * boostFactor
//
// PINS: deals with pinnedUntil in the future sort above ALL unpinned deals,
// regardless of score. Pins are an explicit human override (admin dashboard),
// not part of the formula.
//
// HARD RULE — commission blindness: affiliate commission rates must NEVER
// influence organic ranking. Not as a weight, not as a tiebreaker, not
// anywhere in this file. The brand promise is "we fight for the buyer —
// not the seller," and sorting by payout would break it in a month.
// (Commission may only ever affect which *network's* link we use for the
// same product at the same price — i.e. backend margin, never placement.)
// ─────────────────────────────────────────────────────────────────────────────

export type RankContext = {
  /** Affiliate clicks in the last 24h (from ClickLog). 0 until real traffic. */
  clicks24h: number;
};

export type RankableDeal = {
  aiScore: number | null;
  discountPct: number | null;
  imageUrl: string | null;
  originalPrice: number | null;
  createdAt: Date;
  boostFactor: number;
  isPriceDrop: boolean;
};

export type RankBreakdown = {
  base: number;
  freshnessBoost: number;
  discountBonus: number;
  engagementBonus: number;
  priceDropBonus: number;
  penalties: number;
  boostFactor: number;
  total: number;
};

export function computeRankScore(
  deal: RankableDeal,
  ctx: RankContext,
  now = new Date()
): { score: number; breakdown: RankBreakdown } {
  const base = Math.max(0, Math.min(100, deal.aiScore ?? 0));

  const ageHours = Math.max(
    0,
    (now.getTime() - deal.createdAt.getTime()) / 3_600_000
  );
  const freshnessBoost = 25 * Math.exp(-ageHours / 36);

  const discountBonus = Math.min(Math.max(deal.discountPct ?? 0, 0) * 0.3, 15);

  // Capped at +20. Noise until real traffic exists — documented, not hidden.
  const engagementBonus = Math.min(Math.max(ctx.clicks24h, 0), 50) * 0.4;

  const priceDropBonus = deal.isPriceDrop ? 10 : 0;

  let penalties = 0;
  if (!deal.imageUrl) penalties += 10;
  if (deal.originalPrice == null) penalties += 5;

  const boostFactor = Math.max(0.1, Math.min(3, deal.boostFactor || 1));
  const total =
    (base + freshnessBoost + discountBonus + engagementBonus + priceDropBonus - penalties) *
    boostFactor;

  return {
    score: Math.round(total * 10) / 10,
    breakdown: {
      base: Math.round(base * 10) / 10,
      freshnessBoost: Math.round(freshnessBoost * 10) / 10,
      discountBonus: Math.round(discountBonus * 10) / 10,
      engagementBonus: Math.round(engagementBonus * 10) / 10,
      priceDropBonus,
      penalties,
      boostFactor,
      total: Math.round(total * 10) / 10,
    },
  };
}

/** Is this deal currently pinned by an admin? Pins outrank everything. */
export function isPinned(deal: { pinnedUntil: Date | null }, now = new Date()): boolean {
  return deal.pinnedUntil != null && deal.pinnedUntil.getTime() > now.getTime();
}

/**
 * Sort helper: pinned deals first (soonest-expiring pin first), then by
 * rankScore descending. Pure function — takes precomputed scores so pages
 * can batch the DB work however they like.
 */
export function sortByRank<T extends { id: string; pinnedUntil: Date | null }>(
  deals: T[],
  scores: Map<string, number> | ((d: T) => number),
  now = new Date()
): T[] {
  const getScore =
    typeof scores === "function" ? scores : (d: T) => scores.get(d.id) ?? 0;
  return [...deals].sort((a, b) => {
    const aPinned = isPinned(a, now);
    const bPinned = isPinned(b, now);
    if (aPinned && !bPinned) return -1;
    if (bPinned && !aPinned) return 1;
    if (aPinned && bPinned) {
      return (a.pinnedUntil as Date).getTime() - (b.pinnedUntil as Date).getTime();
    }
    return getScore(b) - getScore(a);
  });
}

/**
 * Clicks in the last 24h per deal id, for a batch of deals. One grouped
 * query — callers pass the resulting map as RankContext per deal.
 */
export async function getClicks24hMap(dealIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (dealIds.length === 0) return map;
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await prisma.clickLog.groupBy({
    by: ["dealId"],
    where: { dealId: { in: dealIds }, createdAt: { gte: since } },
    _count: { dealId: true },
  });
  for (const r of rows) map.set(r.dealId, r._count.dealId);
  return map;
}

/**
 * Catch of the Day — deterministic daily rotation.
 *
 * - Candidates: APPROVED + not expired + has image (a hero without an
 *   image looks broken).
 * - Ranked by DealScore × freshness (pure merit, no pin/boost games).
 * - Excludes yesterday's pick so it always feels new.
 * - Persistence: `featuredAt` on the winning Deal. If a deal is already
 *   featured today (featuredAt >= start of today), it is returned as-is —
 *   so the pick is stable across page loads and ISR revalidations.
 */
export async function getCatchOfTheDay(now = new Date()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 3_600_000);

  // Already picked today? Return it — deterministic within the day.
  const todays = await prisma.deal.findFirst({
    where: {
      status: "APPROVED",
      featuredAt: { gte: startOfToday },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { featuredAt: "desc" },
  });
  if (todays) return todays;

  // Otherwise pick: exclude yesterday's winner, rank by score × freshness.
  // NOTE: written as OR(featuredAt null, featuredAt < yesterday) rather than
  // NOT(featuredAt >= yesterday) — in SQL, NOT(NULL >= x) is NULL (falsy),
  // which would wrongly exclude every never-featured deal.
  const candidates = await prisma.deal.findMany({
    where: {
      status: "APPROVED",
      imageUrl: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [
        {
          OR: [{ featuredAt: null }, { featuredAt: { lt: startOfYesterday } }],
        },
      ],
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestRank = -1;
  for (const d of candidates) {
    const ageHours = Math.max(0, (now.getTime() - d.createdAt.getTime()) / 3_600_000);
    const rank = (d.aiScore ?? 0) * Math.exp(-ageHours / 48);
    if (rank > bestRank) {
      bestRank = rank;
      best = d;
    }
  }

  await prisma.deal.update({
    where: { id: best.id },
    data: { featuredAt: now },
  });
  return { ...best, featuredAt: now };
}
