import { prisma } from "./prisma";
import { ADAPTERS } from "./affiliates";
import { ingestAdapter } from "./affiliates/ingest";
import { scoreDeals } from "./scoring";
import { sendEmail, digestEmailHtml } from "./email";
import { SITE } from "./site";

// Backend automation: every job the site needs, runnable on demand from
// /admin or on a schedule via POST /api/jobs/trigger (see .github/workflows/cron.yml).

export type JobName = "ingest" | "score" | "expire" | "digest" | "all" | "scheduled";

export async function runIngest() {
  const results = [];
  for (const adapter of ADAPTERS) {
    results.push(await ingestAdapter(adapter));
  }
  return { adapters: results };
}

export async function runScore() {
  return scoreDeals();
}

export async function runExpire() {
  const now = new Date();
  const res = await prisma.deal.updateMany({
    where: { status: "APPROVED", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  await prisma.affiliateJob.create({
    data: {
      network: "system",
      status: "ok",
      dealsFound: res.count,
      finishedAt: new Date(),
    },
  });
  return { expired: res.count };
}

export async function runDigest() {
  const deals = await prisma.deal.findMany({
    where: { status: "APPROVED", aiScore: { not: null } },
    orderBy: [{ aiScore: "desc" }, { createdAt: "desc" }],
    take: 6,
    select: { title: true, slug: true, salePrice: true, aiScore: true },
  });
  const subscribers = await prisma.emailAlert.findMany({
    where: { isActive: true },
    select: { email: true, token: true },
  });

  if (deals.length === 0) return { sent: 0, reason: "no live scored deals" };
  if (subscribers.length === 0) return { sent: 0, reason: "no subscribers" };

  let sent = 0;
  for (const sub of subscribers) {
    await sendEmail({
      to: sub.email,
      subject: `This week's top ${deals.length} deals on ${SITE.name}`,
      html: digestEmailHtml(deals, sub.token),
    });
    sent++;
  }
  await prisma.affiliateJob.create({
    data: {
      network: "system",
      status: "ok",
      dealsFound: sent,
      finishedAt: new Date(),
    },
  });
  return { sent, deals: deals.length };
}

export async function runAll() {
  const ingest = await runIngest();
  const score = await runScore();
  const expire = await runExpire();
  return { ingest, score, expire };
}

/**
 * Smart scheduler for the GitHub Actions cron (runs every 6 hours).
 * Always runs ingest + score. Runs expire at most once per ~20h and the
 * digest at most once per 6 days (and only on Mondays), using the
 * AffiliateJob log as the "last run" watermark — no extra state needed.
 */
export async function runScheduled() {
  const ingest = await runIngest();
  const score = await runScore();

  const lastExpire = await prisma.affiliateJob.findFirst({
    where: { network: "expire-marker", status: "ok" },
    orderBy: { startedAt: "desc" },
  });
  let expire: unknown = { skipped: "ran recently" };
  if (!lastExpire || Date.now() - lastExpire.startedAt.getTime() > 20 * 3_600_000) {
    expire = await runExpire();
    await prisma.affiliateJob.create({
      data: { network: "expire-marker", status: "ok", finishedAt: new Date() },
    });
  }

  const lastDigest = await prisma.affiliateJob.findFirst({
    where: { network: "digest-marker", status: "ok" },
    orderBy: { startedAt: "desc" },
  });
  let digest: unknown = { skipped: "not due" };
  const isMonday = new Date().getUTCDay() === 1;
  if (
    isMonday &&
    (!lastDigest || Date.now() - lastDigest.startedAt.getTime() > 6 * 24 * 3_600_000)
  ) {
    digest = await runDigest();
    await prisma.affiliateJob.create({
      data: { network: "digest-marker", status: "ok", finishedAt: new Date() },
    });
  }

  return { ingest, score, expire, digest };
}

export async function runJob(job: JobName) {
  switch (job) {
    case "ingest":
      return runIngest();
    case "score":
      return runScore();
    case "expire":
      return runExpire();
    case "digest":
      return runDigest();
    case "all":
      return runAll();
    case "scheduled":
      return runScheduled();
  }
}
