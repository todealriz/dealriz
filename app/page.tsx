import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";
import { REVALIDATE_SECONDS } from "@/lib/site";
import { DealCard } from "@/components/DealCard";
import { ScoreRing } from "@/components/ScoreRing";
import { Countdown } from "@/components/Countdown";
import { SubscribeForm } from "@/components/SubscribeForm";
import { AdSlot } from "@/components/AdSlot";
import { Fragment } from "react";
import {
  computeRankScore,
  getCatchOfTheDay,
  getClicks24hMap,
  sortByRank,
} from "@/lib/ranking";
import { SITE } from "@/lib/site";

export const revalidate = REVALIDATE_SECONDS;

const liveWhere = {
  status: "APPROVED" as const,
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
};

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  salePrice: true,
  originalPrice: true,
  discountPct: true,
  couponCode: true,
  imageUrl: true,
  category: true,
  badge: true,
  aiScore: true,
  expiresAt: true,
  createdAt: true,
  // Ranking inputs (see lib/ranking.ts).
  boostFactor: true,
  pinnedUntil: true,
  isPriceDrop: true,
  store: { select: { name: true, slug: true } },
};

function SectionHead({ title, href, linkText }: { title: string; href: string; linkText: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-extrabold text-navy-800">{title}</h2>
      <Link href={href} className="text-xs font-bold text-brand-700 hover:underline">
        {linkText} →
      </Link>
    </div>
  );
}

export default async function HomePage() {
  const [catchOfDay, topCandidates, freshCandidates, counts, topStores, trending] =
    await Promise.all([
      // Deterministic daily pick (see lib/ranking.ts) — stable across ISR revalidations.
      getCatchOfTheDay(),
      prisma.deal.findMany({
        where: { ...liveWhere, aiScore: { not: null } },
        orderBy: [{ aiScore: "desc" }],
        take: 60,
        select: cardSelect,
      }),
      prisma.deal.findMany({
        where: liveWhere,
        orderBy: { createdAt: "desc" },
        take: 60,
        select: cardSelect,
      }),
    prisma.deal.groupBy({
      by: ["category"],
      where: liveWhere,
      _count: { id: true },
    }),
    prisma.store.findMany({
      where: { isActive: true },
      select: {
        name: true,
        slug: true,
        _count: { select: { deals: { where: liveWhere } } },
      },
      orderBy: { deals: { _count: "desc" } },
      take: 8,
    }),
    prisma.deal.findMany({
      where: liveWhere,
      orderBy: [{ clicks: "desc" }],
      take: 5,
      select: { id: true, slug: true, title: true, salePrice: true, discountPct: true },
    }),
  ]);

  const countByCat = new Map(counts.map((c) => [c.category, c._count.id]));

  // ── Rank homepage grids with the transparent ranking engine ──
  // Candidates are fetched above (top 60 by score / newest 60); rankScore
  // is computed in JS and pinned deals sort first. The Catch of the Day is
  // excluded from the grids so the hero never duplicates a card.
  const rankIds = Array.from(
    new Set([...topCandidates, ...freshCandidates].map((d) => d.id))
  );
  const clicks24h = await getClicks24hMap(rankIds);
  const rankOf = (d: (typeof topCandidates)[number]) =>
    computeRankScore(d, { clicks24h: clicks24h.get(d.id) ?? 0 }).score;
  const notCatch = (d: { id: string }) => !catchOfDay || d.id !== catchOfDay.id;
  const topScored = sortByRank(
    topCandidates.filter(notCatch),
    rankOf
  ).slice(0, 6);
  const freshDeals = sortByRank(
    freshCandidates.filter(notCatch),
    rankOf
  ).slice(0, 6);

  return (
    <div>
      {/* Brand signal for search engines: Organization entity for DealRiz.
          (No sameAs — social profiles aren't configured; don't invent URLs.) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "DealRiz",
            url: "https://dealriz.com",
            logo: "https://dealriz.com/logo.png",
            description: SITE.description,
          }),
        }}
      />
      {/* ── Compact Catch of the Day strip ─────────────────── */}
      {catchOfDay && (
        <section
          className="border-b border-brand-100 bg-gradient-to-r from-brand-50 via-white to-brand-50"
          aria-label="Catch of the day"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 sm:px-6">
            <span className="rounded-full bg-brand-600 px-3 py-1 text-[11px] font-extrabold uppercase tracking-widest text-white">
              Catch of the Day
            </span>
            {catchOfDay.aiScore != null && <ScoreRing score={catchOfDay.aiScore} size={52} />}
            <div className="min-w-0 flex-1 basis-64">
              <Link
                href={`/deals/${catchOfDay.slug}`}
                className="block truncate text-base font-extrabold text-navy-800 hover:text-brand-700"
              >
                {catchOfDay.title}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-xl font-black text-navy-800">
                  ${catchOfDay.salePrice.toFixed(2)}
                </span>
                {catchOfDay.originalPrice && (
                  <span className="text-slate-400 line-through">
                    ${catchOfDay.originalPrice.toFixed(2)}
                  </span>
                )}
                {catchOfDay.discountPct ? (
                  <span className="rounded-md bg-brand-600 px-1.5 py-0.5 text-[11px] font-extrabold text-white">
                    Save {catchOfDay.discountPct}%
                  </span>
                ) : null}
                {catchOfDay.expiresAt && (
                  <Countdown expiresAt={catchOfDay.expiresAt.toISOString()} compact />
                )}
              </div>
            </div>
            <a
              href={`/go/${catchOfDay.id}`}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700"
            >
              Get This Deal →
            </a>
          </div>
        </section>
      )}

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ── Category chips ───────────────────────────────── */}
        <nav className="mt-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Browse by category">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/deals?category=${encodeURIComponent(c)}`}
              className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
            >
              {c}
              {countByCat.get(c) ? (
                <span className="ml-1 text-[10px] text-slate-400">{countByCat.get(c)}</span>
              ) : null}
            </Link>
          ))}
        </nav>

        {/* ── Leaderboard ad (placeholder until AdSense is configured) ── */}
        <div className="mt-4">
          <AdSlot slot="homepage-leaderboard" format="leaderboard" label="Homepage leaderboard" />
        </div>

        {/* ── Content + sidebar ────────────────────────────── */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {topScored.length > 0 && (
              <section aria-label="Top scored deals">
                <SectionHead title="Top DealScores" href="/deals?sort=score" linkText="View all" />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {topScored.map((d) => (
                    <DealCard key={d.id} deal={d} />
                  ))}
                </div>
              </section>
            )}

            {freshDeals.length > 0 && (
              <section className="mt-8" aria-label="Fresh deals">
                <SectionHead title="Fresh Deals" href="/deals?sort=newest" linkText="View all" />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {freshDeals.map((d, i) => (
                    <Fragment key={d.id}>
                      <DealCard deal={d} />
                      {/* In-feed ad after the ~8th card overall (6 top-scored + 2 fresh) */}
                      {i === 1 && (
                        <AdSlot slot="homepage-infeed" format="in-feed" label="In-feed" />
                      )}
                    </Fragment>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ── Right sidebar ─────────────────────────────── */}
          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-extrabold uppercase tracking-widest text-navy-800">
                Top stores
              </h3>
              <ul className="mt-3 space-y-2">
                {topStores.map((s) => (
                  <li key={s.slug}>
                    <Link
                      href={`/stores/${s.slug}`}
                      className="flex items-center justify-between text-sm text-slate-700 hover:text-brand-700 hover:underline"
                    >
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="ml-2 shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                        {s._count.deals}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/stores" className="mt-3 block text-xs font-bold text-brand-700 hover:underline">
                All stores →
              </Link>
            </div>

            {/* ── Sidebar rectangle ad (placeholder until AdSense is configured) ── */}
            <AdSlot
              slot="homepage-sidebar-rectangle"
              format="rectangle"
              label="Sidebar rectangle"
              className="mx-auto"
            />

            <div className="rounded-2xl bg-navy-800 p-5 text-white">
              <h3 className="text-sm font-extrabold uppercase tracking-widest">
                Never miss a deal
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                One weekly email with the highest-scored deals. No spam, unsubscribe anytime.
              </p>
              <div className="mt-3">
                <SubscribeForm compact />
              </div>
            </div>

            {trending.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-navy-800">
                  Trending now
                </h3>
                <ol className="mt-3 space-y-2.5">
                  {trending.map((d, i) => (
                    <li key={d.id} className="flex items-start gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-100 text-[11px] font-extrabold text-brand-700">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <Link
                          href={`/deals/${d.slug}`}
                          className="block truncate text-[13px] font-semibold text-slate-800 hover:text-brand-700 hover:underline"
                        >
                          {d.title}
                        </Link>
                        <p className="text-[11px] text-slate-500">
                          <span className="font-bold text-navy-800">${d.salePrice.toFixed(2)}</span>
                          {d.discountPct ? ` · -${d.discountPct}%` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
