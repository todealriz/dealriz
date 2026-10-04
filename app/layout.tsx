import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SITE } from "@/lib/site";
import { CATEGORIES } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { DisclosureBanner } from "@/components/DisclosureBanner";
import { CookieConsent } from "@/components/CookieConsent";
import { SubscribeForm } from "@/components/SubscribeForm";
import { AdSenseScript } from "@/components/AdSlot";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    images: [
      {
        url: "/logo.png",
        width: 1774,
        height: 887,
        alt: `${SITE.name} — ${SITE.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    images: ["/logo.png"],
  },
  robots: { index: true, follow: true },
};

function HeaderLogo() {
  return (
    <Link href="/" className="shrink-0" aria-label="DealRiz home">
      <Image
        src="/logo.png"
        alt="DealRiz — Shop smarter. Save more."
        width={1774}
        height={887}
        className="h-9 w-auto sm:h-10"
        priority
      />
    </Link>
  );
}

function HeaderSearch() {
  return (
    <form action="/deals" method="GET" role="search" className="min-w-0 flex-1">
      <label htmlFor="site-search" className="sr-only">
        Search deals
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        placeholder="Search deals, stores, brands…"
        autoComplete="off"
        className="w-full rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none"
      />
    </form>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Top stores for the footer (by live deal count).
  const topStores = await prisma.store.findMany({
    where: { isActive: true },
    select: { name: true, slug: true, _count: { select: { deals: true } } },
    orderBy: { deals: { _count: "desc" } },
    take: 6,
  });

  return (
    <html lang="en">
      <head>
        {/* Impact.com site verification (meta tag method). Set NEXT_PUBLIC_IMPACT_SITE_VERIFICATION in env. */}
        {process.env.NEXT_PUBLIC_IMPACT_SITE_VERIFICATION ? (
          <meta
            name="impact-site-verification"
            {...{ value: process.env.NEXT_PUBLIC_IMPACT_SITE_VERIFICATION } as any}
          />
        ) : null}
      </head>
      <body>
        <DisclosureBanner />

        {/* ── Slim sticky header ─────────────────────────── */}
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-5 sm:px-6">
            <HeaderLogo />
            <div className="hidden min-w-0 flex-1 md:block">
              <HeaderSearch />
            </div>
            <nav className="ml-auto flex shrink-0 items-center gap-0.5 text-sm font-semibold" aria-label="Main navigation">
              <Link href="/deals" className="rounded-lg px-3 py-2 text-navy-800 hover:bg-slate-100">
                Deals
              </Link>
              <Link href="/stores" className="rounded-lg px-3 py-2 text-navy-800 hover:bg-slate-100">
                Stores
              </Link>
            </nav>
          </div>
          {/* Mobile search row */}
          <div className="border-t border-slate-100 px-4 pb-2 pt-2 md:hidden">
            <HeaderSearch />
          </div>
        </header>

        {/* ── Category strip (scrolls away) ────────────────── */}
        <nav className="border-b border-slate-200 bg-white" aria-label="Categories">
          <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
            {CATEGORIES.map((c) => (
              <Link
                key={c}
                href={`/deals?category=${encodeURIComponent(c)}`}
                className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-brand-50 hover:text-brand-700"
              >
                {c}
              </Link>
            ))}
          </div>
        </nav>

        <main className="min-h-[70vh]">{children}</main>

        {/* ── Rich navy footer ─────────────────────────────── */}
        <footer className="mt-12 bg-navy-800 text-slate-300">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            <div>
              <span className="inline-block rounded-lg bg-white px-3 py-1.5">
                <Image
                  src="/logo.png"
                  alt="DealRiz"
                  width={1774}
                  height={887}
                  className="h-8 w-auto"
                />
              </span>
              <p className="mt-3 text-sm font-bold uppercase tracking-widest text-white">
                Shop smarter. Save more.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Every deal scored by our DealScore engine so you know what&apos;s
                actually worth buying. We fight for the buyer — not the seller.
              </p>
            </div>
            <nav aria-label="Footer categories">
              <p className="text-xs font-extrabold uppercase tracking-widest text-white">Categories</p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {CATEGORIES.slice(0, 10).map((c) => (
                  <li key={c}>
                    <Link
                      href={`/deals?category=${encodeURIComponent(c)}`}
                      className="text-slate-400 hover:text-white hover:underline"
                    >
                      {c}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Footer stores">
              <p className="text-xs font-extrabold uppercase tracking-widest text-white">Top stores</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {topStores.map((s) => (
                  <li key={s.slug}>
                    <Link href={`/stores/${s.slug}`} className="text-slate-400 hover:text-white hover:underline">
                      {s.name}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/stores" className="font-semibold text-brand-300 hover:text-white hover:underline">
                    All stores →
                  </Link>
                </li>
              </ul>
            </nav>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-widest text-white">Deal alerts</p>
              <p className="mt-3 text-xs text-slate-400">
                One weekly email with the highest-scored deals. No spam.
              </p>
              <div className="mt-3">
                <SubscribeForm compact />
              </div>
              <nav aria-label="Legal" className="mt-5">
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  <li><Link href="/legal/disclosure" className="hover:text-white hover:underline">Affiliate disclosure</Link></li>
                  <li><Link href="/legal/privacy" className="hover:text-white hover:underline">Privacy</Link></li>
                  <li><Link href="/legal/terms" className="hover:text-white hover:underline">Terms</Link></li>
                </ul>
              </nav>
            </div>
          </div>
          <div className="border-t border-white/10 px-4 py-4 text-center text-[11px] text-slate-500">
            © {new Date().getFullYear()} {SITE.name} · {SITE.domain} · Affiliate Disclosure: some links
            earn us a commission at no extra cost to you. DealScores are algorithmic, not financial advice.
          </div>
        </footer>

        <CookieConsent />
        <AdSenseScript />
      </body>
    </html>
  );
}
