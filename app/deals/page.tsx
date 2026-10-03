import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, isCategory } from "@/lib/categories";
import { dealFiltersSchema, PRICE_BANDS } from "@/lib/validation";
import { DEALS_PER_PAGE, REVALIDATE_SECONDS, SITE } from "@/lib/site";
import { DealCard } from "@/components/DealCard";
import { AdSlot } from "@/components/AdSlot";
import { computeRankScore, getClicks24hMap, sortByRank } from "@/lib/ranking";

export const revalidate = REVALIDATE_SECONDS;

export const metadata: Metadata = {
  title: "All Deals",
  description: `Browse every live DealScore-rated deal on ${SITE.name} — filter by category, discount and price.`,
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

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const SORTS = [
  { key: "rank", label: "Top ranked" },
  { key: "newest", label: "Newest" },
  { key: "score", label: "Top DealScore" },
  { key: "discount", label: "Biggest %" },
  { key: "price-asc", label: "Price ↑" },
  { key: "price-desc", label: "Price ↓" },
] as const;

export default async function DealsPage({ searchParams }: { searchParams: SearchParams }) {
  const parsed = dealFiltersSchema.safeParse({
    q: first(searchParams.q),
    category: first(searchParams.category),
    minDiscount: first(searchParams.minDiscount),
    price: first(searchParams.price),
    sort: first(searchParams.sort),
    page: first(searchParams.page),
    pageSize: first(searchParams.pageSize),
  });
  const f = parsed.success ? parsed.data : {};

  const q = f.q?.trim() || undefined;
  const category = isCategory(f.category) ? f.category : undefined;
  const minDiscount = f.minDiscount && f.minDiscount > 0 ? f.minDiscount : undefined;
  const price = f.price && f.price !== "any" ? f.price : undefined;
  const sort = f.sort ?? "rank";
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? DEALS_PER_PAGE;

  const where: Record<string, unknown> = {
    status: "APPROVED",
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
  const and: Record<string, unknown>[] = [];

  if (q) {
    and.push({
      OR: [
        { title: { contains: q } },
        { description: { contains: q } },
        { store: { name: { contains: q } } },
      ],
    });
  }
  if (category) and.push({ category });
  if (minDiscount) and.push({ discountPct: { gte: minDiscount } });
  if (price) {
    const band = PRICE_BANDS[price];
    const priceFilter: Record<string, number> = {};
    if (band.min != null) priceFilter.gte = band.min;
    if (band.max != null) priceFilter.lt = band.max;
    and.push({ salePrice: priceFilter });
  }
  if (and.length > 0) where.AND = and;

  // "rank" is the default sort: rankScore is computed in JS (see
  // lib/ranking.ts), so we score a candidate window — the freshest 500
  // matches — and paginate in memory. Honest scaling note: past a few
  // thousand live deals this wants a persisted rankScore column refreshed
  // by the score job; the candidate window keeps v1 correct and fast.
  const isRankSort = sort === "rank";
  const orderBy =
    sort === "discount"
      ? [{ discountPct: "desc" as const }, { createdAt: "desc" as const }]
      : sort === "price-asc"
        ? [{ salePrice: "asc" as const }]
        : sort === "price-desc"
          ? [{ salePrice: "desc" as const }]
          : sort === "score"
            ? [{ aiScore: "desc" as const }, { createdAt: "desc" as const }]
            : [{ createdAt: "desc" as const }];

  const [total, fetched] = await Promise.all([
    prisma.deal.count({ where }),
    prisma.deal.findMany({
      where,
      orderBy,
      skip: isRankSort ? 0 : (page - 1) * pageSize,
      take: isRankSort ? 500 : pageSize,
      select: cardSelect,
    }),
  ]);

  let deals = fetched;
  if (isRankSort) {
    const clicks24h = await getClicks24hMap(fetched.map((d) => d.id));
    const ranked = sortByRank(fetched, (d) =>
      computeRankScore(d, { clicks24h: clicks24h.get(d.id) ?? 0 }).score
    );
    deals = ranked.slice((page - 1) * pageSize, page * pageSize);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Preserve current filters in links.
  const baseParams = new URLSearchParams();
  if (q) baseParams.set("q", q);
  if (category) baseParams.set("category", category);
  if (minDiscount) baseParams.set("minDiscount", String(minDiscount));
  if (price) baseParams.set("price", price);
  const withParams = (extra: Record<string, string>) => {
    const sp = new URLSearchParams(baseParams);
    for (const [k, v] of Object.entries(extra)) sp.set(k, v);
    const s = sp.toString();
    return `/deals${s ? `?${s}` : ""}`;
  };
  const pageLink = (p: number) => {
    const sp = new URLSearchParams(baseParams);
    if (sort !== "rank") sp.set("sort", sort);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return `/deals${s ? `?${s}` : ""}`;
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none";
  const labelCls =
    "mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-black text-navy-800">All Deals</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        {total} live deal{total === 1 ? "" : "s"} · DealScore-rated, refreshed regularly
      </p>

      {/* ── Leaderboard ad (placeholder until AdSense is configured) ── */}
      <div className="mt-4">
        <AdSlot slot="deals-leaderboard" format="leaderboard" label="Deals leaderboard" />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* ── Sticky filter sidebar ─────────────────────── */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <form
            method="GET"
            action="/deals"
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-extrabold uppercase tracking-widest text-navy-800">Filters</p>
              <Link href="/deals" className="text-xs font-semibold text-brand-700 hover:underline">
                Clear
              </Link>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className={labelCls}>Search</span>
                <input
                  type="search"
                  name="q"
                  defaultValue={q ?? ""}
                  placeholder="Headphones, Dyson…"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Category</span>
                <select name="category" defaultValue={category ?? ""} className={inputCls}>
                  <option value="">All</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Min discount</span>
                <select name="minDiscount" defaultValue={minDiscount ? String(minDiscount) : ""} className={inputCls}>
                  <option value="">Any</option>
                  <option value="20">20%+</option>
                  <option value="40">40%+</option>
                  <option value="60">60%+</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Price</span>
                <select name="price" defaultValue={price ?? "any"} className={inputCls}>
                  {(Object.keys(PRICE_BANDS) as (keyof typeof PRICE_BANDS)[]).map((k) => (
                    <option key={k} value={k}>{PRICE_BANDS[k].label}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn-primary w-full">
                Apply filters
              </button>
            </div>
          </form>
        </aside>

        {/* ── Results ───────────────────────────────────── */}
        <div className="min-w-0">
          {/* Sticky sort bar */}
          <div className="sticky top-16 z-20 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {SORTS.map((s) => {
                const active = sort === s.key;
                return (
                  <Link
                    key={s.key}
                    href={withParams({ sort: s.key })}
                    aria-current={active ? "true" : undefined}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      active
                        ? "bg-navy-800 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
                    }`}
                  >
                    {s.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {deals.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <p className="text-lg font-bold text-navy-800">No deals match your filters</p>
              <p className="mt-1 text-sm text-slate-500">Try widening the discount, price or category.</p>
              <Link href="/deals" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">
                Clear all filters →
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {deals.map((d) => (
                  <DealCard key={d.id} deal={d} />
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
                  {page > 1 && (
                    <Link href={pageLink(page - 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      ← Prev
                    </Link>
                  )}
                  <span className="px-3 text-sm text-slate-500">
                    Page {page} of {totalPages}
                  </span>
                  {page < totalPages && (
                    <Link href={pageLink(page + 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      Next →
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
