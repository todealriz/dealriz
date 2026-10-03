import Image from "next/image";
import Link from "next/link";
import { ScoreRing } from "./ScoreRing";
import { Countdown } from "./Countdown";

export type DealCardDeal = {
  id: string;
  slug: string;
  title: string;
  salePrice: number;
  originalPrice: number | null;
  discountPct: number | null;
  couponCode: string | null;
  imageUrl: string | null;
  category: string;
  badge: string | null;
  aiScore: number | null;
  expiresAt: Date | null;
  store: { name: string; slug: string };
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Category → placeholder gradient when a deal has no image (brand-tinted).
const PLACEHOLDER_HUES: Record<string, string> = {
  Electronics: "from-navy-600 to-navy-800",
  Fashion: "from-brand-400 to-brand-600",
  Home: "from-amber-500 to-orange-600",
  Grocery: "from-brand-500 to-emerald-700",
  Health: "from-teal-500 to-emerald-600",
  Sports: "from-lime-500 to-brand-600",
  Gaming: "from-navy-500 to-navy-900",
  Travel: "from-sky-500 to-navy-600",
  Pets: "from-orange-500 to-amber-600",
  Kids: "from-brand-300 to-brand-500",
  Tools: "from-slate-500 to-slate-700",
  Other: "from-navy-400 to-navy-700",
};

// Compact, uniform-height deal card for dense grids.
export function DealCard({ deal }: { deal: DealCardDeal }) {
  const gradient = PLACEHOLDER_HUES[deal.category] ?? PLACEHOLDER_HUES.Other;

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md">
      {/* Image */}
      <Link
        href={`/deals/${deal.slug}`}
        className="relative block aspect-[16/10] overflow-hidden bg-slate-100"
        aria-label={deal.title}
      >
        {deal.imageUrl ? (
          <Image
            src={deal.imageUrl}
            alt={deal.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 20vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient}`}
            aria-hidden="true"
          >
            <span className="text-4xl font-black text-white/80">
              {deal.category.charAt(0)}
            </span>
          </div>
        )}
        {deal.badge && (
          <span className="absolute left-2 top-2 rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
            {deal.badge}
          </span>
        )}
        {deal.discountPct != null && deal.discountPct > 0 && (
          <span className="absolute right-2 top-2 rounded-md bg-brand-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
            -{deal.discountPct}%
          </span>
        )}
      </Link>

      {/* Body */}
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/deals?category=${encodeURIComponent(deal.category)}`}
            className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 hover:bg-brand-100"
          >
            {deal.category}
          </Link>
          {deal.aiScore != null && <ScoreRing score={deal.aiScore} size={38} />}
        </div>

        <Link href={`/deals/${deal.slug}`} className="mt-1.5 block min-h-[2.6rem]">
          <h3 className="clamp-2 text-sm font-bold leading-snug text-navy-800 group-hover:text-brand-700">
            {deal.title}
          </h3>
        </Link>

        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Link href={`/stores/${deal.store.slug}`} className="truncate hover:underline">
            {deal.store.name}
          </Link>
          {deal.couponCode && (
            <span className="ml-auto shrink-0 rounded border border-dashed border-brand-400 bg-brand-50 px-1.5 py-px text-[10px] font-bold text-brand-700">
              🎟 Coupon
            </span>
          )}
        </div>

        <div className="mt-auto flex items-baseline gap-1.5 pt-2">
          <span className="text-lg font-extrabold text-navy-800">
            {money(deal.salePrice)}
          </span>
          {deal.originalPrice != null && deal.originalPrice > deal.salePrice && (
            <span className="text-xs text-slate-400 line-through">
              {money(deal.originalPrice)}
            </span>
          )}
          {deal.expiresAt && (
            <span className="ml-auto">
              <Countdown expiresAt={deal.expiresAt.toISOString()} compact />
            </span>
          )}
        </div>

        {/* CTA + FTC per-card disclosure */}
        <div className="pt-2">
          <a
            href={`/go/${deal.id}`}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="block rounded-lg bg-brand-600 px-3 py-2 text-center text-[13px] font-bold text-white transition hover:bg-brand-700"
          >
            Get This Deal →
          </a>
          <p className="mt-1 text-center text-[10px] text-slate-400">
            ↗ Affiliate link
          </p>
        </div>
      </div>
    </article>
  );
}
