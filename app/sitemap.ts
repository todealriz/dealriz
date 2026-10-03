import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SITE } from "@/lib/site";

// Dynamic XML sitemap: all live deals + stores + static pages.
// Wrapped in try/catch so `next build` succeeds even without a database.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = [
    { url: SITE.url, lastModified: new Date(), changeFrequency: "daily" as const, priority: 1 },
    { url: `${SITE.url}/deals`, lastModified: new Date(), changeFrequency: "hourly" as const, priority: 0.9 },
    { url: `${SITE.url}/stores`, lastModified: new Date(), changeFrequency: "daily" as const, priority: 0.7 },
  ];

  try {
    const [deals, stores] = await Promise.all([
      prisma.deal.findMany({
        where: {
          status: "APPROVED",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
      prisma.store.findMany({
        where: { isActive: true },
        select: { slug: true },
      }),
    ]);

    return [
      ...base,
      ...deals.map((d) => ({
        url: `${SITE.url}/deals/${d.slug}`,
        lastModified: d.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
      ...stores.map((s) => ({
        url: `${SITE.url}/stores/${s.slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    return base;
  }
}
