import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SITE, REVALIDATE_SECONDS } from "@/lib/site";

export const revalidate = REVALIDATE_SECONDS;

export const metadata: Metadata = {
  title: "Stores",
  description: `Browse every merchant with live deals on ${SITE.name}.`,
};

export default async function StoresPage() {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: {
          deals: {
            where: {
              status: "APPROVED",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const withDeals = stores.filter((s) => s._count.deals > 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-black">Stores</h1>
      <p className="mt-1 text-sm text-slate-500">
        {withDeals.length} merchants with live deals
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {withDeals.map((s) => (
          <Link
            key={s.id}
            href={`/stores/${s.slug}`}
            className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold group-hover:text-brand-700">{s.name}</h2>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-extrabold text-brand-700">
                {s._count.deals} deal{s._count.deals === 1 ? "" : "s"}
              </span>
            </div>
            {s.description && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{s.description}</p>
            )}
            {s.affiliateNetwork && (
              <p className="mt-2 text-[11px] text-slate-400">via {s.affiliateNetwork}</p>
            )}
          </Link>
        ))}
      </div>

      {withDeals.length === 0 && (
        <p className="mt-12 text-center text-slate-500">
          No stores with live deals yet — check back soon.
        </p>
      )}
    </div>
  );
}
