/**
 * One-shot importer: Prime Big Deal Days opening slate → DealRiz DB.
 *
 * Feeds prime-opening-slate.csv through the REAL pipeline:
 *   CSV → fetchMappedFeed (lib/affiliates/datafeed.ts)
 *       → RawDeal[] (validated by rawDealSchema)
 *       → ingestAdapter() (lib/affiliates/ingest.ts:
 *           validate → normalize → dedupe → upsert → price snapshots)
 *       → scoreDeals() (lib/scoring.ts: deterministic DealScore)
 *
 * New deals land in PENDING (Amazon isn't a "trusted store" until a human
 * approves one Amazon deal in /admin) — human review still required.
 * Re-running is safe: dedupe is per-network on externalId (`amazon-{ASIN}`),
 * so existing rows get price-updated instead of duplicated.
 *
 * Usage:
 *   tsx scripts/import-prime-slate.ts --dry-run   # parse + validate only, no DB writes (default)
 *   tsx scripts/import-prime-slate.ts --commit    # actually ingest + score
 *
 * Run from the repo root: ./node_modules/.bin/tsx scripts/import-prime-slate.ts --commit
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchMappedFeed } from "../lib/affiliates/datafeed";
import { ingestAdapter } from "../lib/affiliates/ingest";
import { scoreDeals } from "../lib/scoring";
import { rawDealSchema } from "../lib/validation";
import type { AffiliateAdapter, RawDeal } from "../lib/affiliates/types";

// Minimal .env loader (dependency-free): KEY=VALUE lines, ignores comments.
function loadEnvFile(path: string) {
  let text = "";
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const csvPath =
  args.find((a) => a.endsWith(".csv")) ??
  "/home/hatch/workspace/goals/dealriz-v1-deal-site/files/prime-opening-slate.csv";

const COLUMN_MAP = {
  externalId: "externalId",
  title: "title",
  salePrice: "salePrice",
  originalPrice: "originalPrice",
  imageUrl: "imageUrl",
  affiliateUrl: "affiliateUrl",
  category: "category",
  inStock: "inStock",
} as const;

async function buildRawDeals(): Promise<RawDeal[]> {
  const rows = await fetchMappedFeed({ file: resolve(csvPath) }, COLUMN_MAP as any);
  const deals: RawDeal[] = [];
  for (const r of rows) {
    if (r.inStock === false) continue; // never import an out-of-stock row
    const raw = {
      externalId: `amazon-${r.externalId}`,
      title: r.title,
      salePrice: r.salePrice,
      originalPrice: r.originalPrice,
      imageUrl: r.imageUrl,
      affiliateUrl: r.affiliateUrl,
      category: r.category ?? "Other",
      badge: "Prime Deal",
      // Prime Big Deal Days ends Oct 7, 2026 11:59 PM PT — the site
      // auto-hides deals past expiresAt, so no manual cleanup needed.
      expiresAt: new Date("2026-10-07T23:59:59-07:00"),
      storeName: "Amazon",
      storeSlug: "amazon",
      affiliateNetwork: "Amazon Associates",
    };
    const parsed = rawDealSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Row ${r.externalId} failed validation: ${parsed.error.issues[0]?.message}`
      );
    }
    deals.push(parsed.data);
  }
  return deals;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env"));
  if (!process.env.DATABASE_URL && commit) {
    throw new Error("DATABASE_URL is not set — cannot run --commit.");
  }

  const deals = await buildRawDeals();
  console.log(`Parsed ${deals.length} validated deals from ${csvPath}`);
  for (const d of deals) {
    const pct =
      d.originalPrice && d.originalPrice > d.salePrice
        ? Math.round((1 - d.salePrice / d.originalPrice) * 100)
        : 0;
    console.log(
      `  - [${d.externalId}] ${d.title.slice(0, 52)} | $${d.salePrice} / $${d.originalPrice} (${pct}%) | ${d.category}`
    );
  }

  if (!commit) {
    console.log("\nDRY RUN — no database writes. Re-run with --commit to ingest.");
    return;
  }

  const adapter: AffiliateAdapter = {
    name: "prime-slate-csv",
    fetchDeals: async () => deals,
  };

  console.log("\nRunning ingestAdapter() …");
  const result = await ingestAdapter(adapter);
  console.log(
    `Ingest done: found=${result.found} added=${result.added} updated=${result.updated} skipped=${result.skipped} priceDrops=${result.priceDrops}`
  );
  for (const e of result.errors) console.log("  ERROR:", e);

  console.log("Running scoreDeals() …");
  const scored = await scoreDeals(500);
  console.log(`Scored ${scored.scored} deals (${scored.skipped} skipped).`);
  console.log("\nDone. Review the new deals in /admin moderation queue.");
}

main().catch((err) => {
  console.error("IMPORT FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
