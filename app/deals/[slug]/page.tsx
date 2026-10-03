import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SITE, REVALIDATE_SECONDS } from "@/lib/site";
import { ScoreRing } from "@/components/ScoreRing";
import { ScoreExplainer } from "@/components/ScoreExplainer";
import { CouponCopy } from "@/components/CouponCopy";
import { Countdown } from "@/components/Countdown";
import { ShareButtons } from "@/components/ShareButtons";
import { DealCard } from "@/components/DealCard";
import { AdSlot } from "@/components/AdSlot";

export const revalidate = REVALIDATE_SECONDS;

type Props = { params: { slug: string } };

async function getDeal(slug: string) {
  return prisma.deal.findFirst({
    where: {
      slug,
      status: "APPROVED",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { store: true },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const deal = await getDeal(params.slug);
  if (!deal) return { title: "Deal not found" };
  const title = deal.title;
  const description = `Save${deal.discountPct ? ` ${deal.discountPct}%` : ""} — $${deal.salePrice.toFixed(2)} at ${deal.store.name}. DealScore ${deal.aiScore ?? "—"}/100 on ${SITE.name}.`;
  return {
    title,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      ...(deal.imageUrl ? { images: [{ url: deal.imageUrl }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(deal.imageUrl ? { images: [deal.imageUrl] } : {}),
    },
  };
}

export default async function DealDetailPage({ params }: Props) {
  const deal = await getDeal(params.slug);
  if (!deal) notFound();

  // Track the view (fire-and-forget style — awaited, but cheap).
  await prisma.deal.update({
    where: { id: deal.id },
    data: { views: { increment: 1 } },
  });

  const related = await prisma.deal.findMany({
    where: {
      id: { not: deal.id },
      status: "APPROVED",
      category: deal.category,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ aiScore: "desc" }],
    take: 4,
    select: {
      id: true, slug: true, title: true, salePrice: true, originalPrice: true,
      discountPct: true, couponCode: true, imageUrl: true, category: true,
      badge: true, aiScore: true, expiresAt: true,
      store: { select: { name: true, slug: true } },
    },
  });

  const components = deal.scoreComponents
    ? (JSON.parse(deal.scoreComponents) as Record<string, number>)
    : null;

  // JSON-LD Product schema for Google rich results.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: deal.title,
    description: deal.description ?? deal.title,
    category: deal.category,
    ...(deal.imageUrl ? { image: [deal.imageUrl] } : {}),
    brand: { "@type": "Brand", name: deal.store.name },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: deal.salePrice.toFixed(2),
      availability: "https://schema.org/InStock",
      url: `${SITE.url}/go/${deal.id}`,
      ...(deal.expiresAt ? { priceValidUntil: deal.expiresAt.toISOString() } : {}),
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-brand-700 hover:underline">Home</Link>
        {" / "}
        <Link href="/deals" className="hover:text-brand-700 hover:underline">Deals</Link>
        {" / "}
        <Link href={`/deals?category=${encodeURIComponent(deal.category)}`} className="hover:text-brand-700 hover:underline">
          {deal.category}
        </Link>
      </nav>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Main column ─────────────────────────────── */}
        <div className="min-w-0">
          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="relative aspect-[16/9] bg-slate-100">
              {deal.imageUrl ? (
                <Image
                  src={deal.imageUrl}
                  alt={deal.title}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 70vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-navy-600 to-navy-800">
                  <span className="text-7xl font-black text-white/80">{deal.category.charAt(0)}</span>
                </div>
              )}
              {deal.badge && (
                <span className="absolute left-4 top-4 rounded-md bg-red-600 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white">
                  {deal.badge}
                </span>
              )}
            </div>

            <div className="p-5 sm:p-6">
              <Link
                href={`/stores/${deal.store.slug}`}
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                {deal.store.name}
              </Link>
              <h1 className="mt-1 text-xl font-black leading-tight text-navy-800 sm:text-2xl">
                {deal.title}
              </h1>
              {deal.description && (
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{deal.description}</p>
              )}
            </div>
          </article>

          {/* DealScore breakdown */}
          {deal.aiScore != null && (
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" aria-label="DealScore breakdown">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ScoreRing score={deal.aiScore} size={56} />
                  <div>
                    <h2 className="text-base font-black text-navy-800">
                      DealScore: {deal.aiScore}
                      <span className="text-slate-400">/100</span>
                    </h2>
                    <ScoreExplainer />
                  </div>
                </div>
              </div>
              {components && (
                <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(components).map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-slate-50 p-3 text-center">
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{k}</dt>
                      <dd className="text-lg font-extrabold text-brand-700">+{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Scores are algorithmic and for informational purposes only — not financial advice.
              </p>
            </section>
          )}
        </div>

        {/* ── Sticky buy box ────────────────────────────── */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-navy-800">
                ${deal.salePrice.toFixed(2)}
              </span>
              {deal.originalPrice && deal.originalPrice > deal.salePrice && (
                <span className="text-base text-slate-400 line-through">
                  ${deal.originalPrice.toFixed(2)}
                </span>
              )}
            </div>
            {deal.discountPct ? (
              <span className="mt-2 inline-block rounded-md bg-brand-600 px-2.5 py-1 text-xs font-extrabold text-white">
                Save {deal.discountPct}%
              </span>
            ) : null}

            <div className="mt-4 space-y-3">
              {deal.couponCode && <CouponCopy code={deal.couponCode} />}
              {deal.expiresAt && (
                <div>
                  <Countdown expiresAt={deal.expiresAt.toISOString()} />
                </div>
              )}
            </div>

            <a
              href={`/go/${deal.id}`}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="mt-4 block rounded-xl bg-brand-600 px-6 py-3.5 text-center text-base font-extrabold text-white transition hover:bg-brand-700"
            >
              Get This Deal at {deal.store.name} →
            </a>
            <p className="mt-2 text-center text-xs text-slate-400">
              ↗ Affiliate link — DealRiz may earn a commission at no extra cost to you.
            </p>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <ShareButtons url={`${SITE.url}/deals/${deal.slug}`} title={deal.title} />
            </div>
          </div>

          {/* ── Rectangle ad below the buy box, clear of the CTA (placeholder until AdSense is configured) ── */}
          <div className="mt-4">
            <AdSlot
              slot="detail-sidebar-rectangle"
              format="rectangle"
              label="Detail sidebar rectangle"
              className="mx-auto"
            />
          </div>
        </aside>
      </div>

      {/* ── In-content responsive ad (placeholder until AdSense is configured) ── */}
      <div className="mt-8">
        <AdSlot slot="detail-incontent" format="responsive" label="In-content" />
      </div>

      {/* Related */}
      {related.length > 0 && (
        <section className="mt-10" aria-label="Related deals">
          <h2 className="mb-3 text-lg font-extrabold text-navy-800">More {deal.category} deals</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((d) => (
              <DealCard key={d.id} deal={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
