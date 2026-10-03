import { prisma } from "../prisma";
import { rawDealSchema } from "../validation";
import { slugify, uniqueSlug } from "../slug";
import { isCategory } from "../categories";
import type { AffiliateAdapter } from "./types";

export type IngestResult = {
  adapter: string;
  found: number;
  added: number;
  updated: number;
  skipped: number;
  priceDrops: number;
  errors: string[];
};

const DAY_MS = 24 * 3_600_000;

/**
 * Ingestion pipeline: fetch → validate → normalize → dedupe → upsert.
 *
 * "Deals" are DERIVED here, not just accepted from feed flags. A feed row is
 * a product; it becomes a deal on this site when one of these is true:
 *   1. Its discount vs list price clears the auto-approve threshold, or
 *   2. Its price just dropped >10% vs its own 30-day median (price history
 *      we record ourselves in PriceSnapshot), or
 *   3. A human approves it in the /admin moderation queue.
 *
 * Dedupe: per-network on `externalId` (the network's stable id), PLUS
 * cross-network on `gtin` when present (same UPC/EAN sold via two networks
 * must not become two listings — we keep the first-seen row and refresh it).
 *
 * Auto-approve rules (new deals only; price-drops always auto-approve):
 *   - AUTO_APPROVE_MIN_DISCOUNT (default 30): discountPct >= threshold AND
 *     the store is "trusted" AND an image is present.
 *   - "Trusted" = the store already has at least one human-approved deal.
 *     New merchants always go through human review once — then automation
 *     takes over. No allowlist to maintain.
 *   - AUTO_APPROVE_INGESTED=true remains as the manual override (used by
 *     the seed script and for bulk backfills).
 */
export async function ingestAdapter(
  adapter: AffiliateAdapter,
  opts: { autoApprove?: boolean } = {}
): Promise<IngestResult> {
  const overrideApprove =
    opts.autoApprove ?? process.env.AUTO_APPROVE_INGESTED === "true";
  const minDiscount = parseMinDiscount();
  const result: IngestResult = {
    adapter: adapter.name,
    found: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    priceDrops: 0,
    errors: [],
  };

  const job = await prisma.affiliateJob.create({
    data: { network: adapter.name, status: "running" },
  });

  try {
    const rawDeals = await adapter.fetchDeals();
    result.found = rawDeals.length;

    for (const raw of rawDeals) {
      const parsed = rawDealSchema.safeParse(raw);
      if (!parsed.success) {
        result.skipped++;
        result.errors.push(
          `Invalid deal "${raw.title ?? "unknown"}": ${parsed.error.issues[0]?.message}`
        );
        continue;
      }
      const d = parsed.data;

      // Normalize: compute discount %, clamp category to our 12.
      const discountPct =
        d.originalPrice && d.originalPrice > d.salePrice
          ? Math.round((1 - d.salePrice / d.originalPrice) * 100)
          : 0;
      const category = isCategory(d.category) ? d.category : "Other";

      // Upsert the store (one row per merchant).
      const storeSlug = d.storeSlug ?? slugify(d.storeName);
      const store = await prisma.store.upsert({
        where: { slug: storeSlug },
        update: { name: d.storeName, affiliateNetwork: d.affiliateNetwork },
        create: {
          slug: storeSlug,
          name: d.storeName,
          affiliateNetwork: d.affiliateNetwork,
        },
      });

      // Dedupe: per-network externalId first, then cross-network gtin.
      let existing = await prisma.deal.findUnique({
        where: { externalId: d.externalId },
      });
      if (!existing && d.gtin) {
        existing = await prisma.deal.findFirst({ where: { gtin: d.gtin } });
      }

      if (existing) {
        // Price-drop detection BEFORE we overwrite the price: compare the
        // incoming price against the median of this deal's own last-30-day
        // snapshots (recorded by previous ingest runs).
        const isPriceDrop = await detectPriceDrop(existing.id, d.salePrice);

        await prisma.deal.update({
          where: { id: existing.id },
          data: {
            title: d.title,
            description: d.description,
            salePrice: d.salePrice,
            originalPrice: d.originalPrice,
            discountPct,
            couponCode: d.couponCode,
            affiliateUrl: d.affiliateUrl,
            imageUrl: d.imageUrl,
            category,
            badge: d.badge,
            expiresAt: d.expiresAt,
            storeId: store.id,
            gtin: d.gtin ?? existing.gtin,
            mpn: d.mpn ?? existing.mpn,
            isPriceDrop,
            // A fresh price drop re-publishes an expired deal and jumps the
            // queue — this is the highest-signal automation on the site.
            ...(isPriceDrop ? { status: "APPROVED" } : {}),
            // Clear a stale score so the score job recomputes it.
            aiScore: null,
            scoredAt: null,
          },
        });
        if (isPriceDrop) result.priceDrops++;
        await recordPriceSnapshot(existing.id, d.salePrice, d.originalPrice);
        result.updated++;
      } else {
        const trusted = await isStoreTrusted(store.id);
        const qualifies =
          discountPct >= minDiscount && trusted && !!d.imageUrl;
        // Price drops can't happen on first sight (no history yet) —
        // the first snapshot is recorded below for future runs.
        const status = overrideApprove || qualifies ? "APPROVED" : "PENDING";

        const created = await prisma.deal.create({
          data: {
            externalId: d.externalId,
            slug: uniqueSlug(d.title),
            title: d.title,
            description: d.description,
            salePrice: d.salePrice,
            originalPrice: d.originalPrice,
            discountPct,
            couponCode: d.couponCode,
            affiliateUrl: d.affiliateUrl,
            imageUrl: d.imageUrl,
            category,
            badge: d.badge,
            status,
            expiresAt: d.expiresAt,
            storeId: store.id,
            gtin: d.gtin,
            mpn: d.mpn,
          },
        });
        await recordPriceSnapshot(created.id, d.salePrice, d.originalPrice);
        result.added++;
      }
    }

    await prisma.affiliateJob.update({
      where: { id: job.id },
      data: {
        status: "ok",
        dealsFound: result.found,
        dealsAdded: result.added,
        dealsUpdated: result.updated,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);
    await prisma.affiliateJob.update({
      where: { id: job.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
  }

  return result;
}

function parseMinDiscount(): number {
  const raw = process.env.AUTO_APPROVE_MIN_DISCOUNT;
  const n = raw != null && raw !== "" ? parseInt(raw, 10) : 30;
  return Number.isFinite(n) && n >= 0 && n <= 90 ? n : 30;
}

/**
 * "Trusted store" = at least one deal from this merchant was previously
 * human-approved. New merchants always pass through the moderation queue
 * once; afterwards their high-discount deals can auto-publish.
 */
async function isStoreTrusted(storeId: string): Promise<boolean> {
  const count = await prisma.deal.count({
    where: { storeId, status: "APPROVED" },
  });
  return count > 0;
}

/**
 * Price-drop detection: is the incoming price more than 10% below the
 * median of this deal's own snapshots from the last 30 days?
 * Requires ≥3 snapshots so a single data point can't trigger it.
 */
async function detectPriceDrop(dealId: string, newPrice: number): Promise<boolean> {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const snaps = await prisma.priceSnapshot.findMany({
    where: { dealId, createdAt: { gte: since } },
    select: { price: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  if (snaps.length < 3) return false;
  const prices = snaps.map((s) => s.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 1
      ? prices[mid]
      : (prices[mid - 1] + prices[mid]) / 2;
  if (median <= 0) return false;
  return newPrice < 0.9 * median;
}

/**
 * Record a price snapshot when the price changed or when >24h have passed
 * since the last snapshot. Keeps the history table small but sufficient
 * for 30-day median price-drop detection.
 */
async function recordPriceSnapshot(
  dealId: string,
  price: number,
  listPrice?: number | null
): Promise<void> {
  const last = await prisma.priceSnapshot.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
  });
  const priceChanged = !last || last.price !== price;
  const stale = !last || Date.now() - last.createdAt.getTime() > DAY_MS;
  if (priceChanged || stale) {
    await prisma.priceSnapshot.create({
      data: { dealId, price, listPrice: listPrice ?? null },
    });
  }
}
