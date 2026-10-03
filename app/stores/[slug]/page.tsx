import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SITE, REVALIDATE_SECONDS } from "@/lib/site";
import { DealCard } from "@/components/DealCard";

export const revalidate = REVALIDATE_SECONDS;

type Props = { params: { slug: string } };

async function getStore(slug: string) {
  return prisma.store.findFirst({
    where: { slug, isActive: true },
    include: {
      deals: {
        where: {
          status: "APPROVED",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ aiScore: "desc" }, { createdAt: "desc" }],
        select: {
          id: true, slug: true, title: true, salePrice: true, originalPrice: true,
          discountPct: true, couponCode: true, imageUrl: true, category: true,
          badge: true, aiScore: true, expiresAt: true,
          store: { select: { name: true, slug: true } },
        },
      },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await getStore(params.slug);
  if (!store) return { title: "Store not found" };
  return {
    title: `${store.name} Deals`,
    description: `Live AI-scored deals from ${store.name} on ${SITE.name}.`,
  };
}

export default async function StoreDetailPage({ params }: Props) {
  const store = await getStore(params.slug);
  if (!store) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav className="text-xs text-slate-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">Home</Link> {" / "}
        <Link href="/stores" className="hover:underline">Stores</Link> {" / "}
        <span className="text-slate-700">{store.name}</span>
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="bg-brand-600 hover:bg-brand-700 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl font-black text-white">
          {store.name.charAt(0)}
        </div>
        <div>
          <h1 className="text-3xl font-black">{store.name}</h1>
          {store.description && (
            <p className="mt-1 max-w-xl text-sm text-slate-500">{store.description}</p>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        ↗ Links to {store.name} are affiliate links — commission may apply.
      </p>

      <h2 className="mb-4 mt-8 text-xl font-black">
        {store.deals.length} live deal{store.deals.length === 1 ? "" : "s"}
      </h2>

      {store.deals.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {store.deals.map((d) => (
            <DealCard key={d.id} deal={d} />
          ))}
        </div>
      ) : (
        <p className="text-slate-500">No live deals from {store.name} right now.</p>
      )}
    </div>
  );
}
