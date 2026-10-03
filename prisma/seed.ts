/**
 * DealRiz seed: runs the MockAdapter through the real ingest pipeline
 * (deduped by externalId), auto-approves the deals, then scores them.
 *
 * Run: `npx tsx prisma/seed.ts`  (or `npm run db:seed`)
 * Safe to re-run — ingest dedupes on externalId.
 */
import { MockAdapter } from "../lib/affiliates/mock";
import { ingestAdapter } from "../lib/affiliates/ingest";
import { scoreDeals } from "../lib/scoring";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("🌱 Seeding DealRiz via MockAdapter → ingest pipeline…");

  const ingest = await ingestAdapter(new MockAdapter(), { autoApprove: true });
  console.log(
    `   ingest: found=${ingest.adapter} found=${ingest.found} added=${ingest.added} updated=${ingest.updated} skipped=${ingest.skipped}`
  );
  if (ingest.errors.length > 0) {
    console.log("   errors:", ingest.errors.slice(0, 5));
  }

  const scoring = await scoreDeals();
  console.log(`   scoring: scored=${scoring.scored}`);

  const [deals, stores, pending] = await Promise.all([
    prisma.deal.count({ where: { status: "APPROVED" } }),
    prisma.store.count(),
    prisma.deal.count({ where: { status: "PENDING" } }),
  ]);
  console.log(`✅ Done: ${deals} approved deals, ${stores} stores, ${pending} pending.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
