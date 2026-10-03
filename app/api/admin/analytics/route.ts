import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/admin/analytics — dashboard metrics.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const day = 24 * 3_600_000;
  const now = Date.now();

  const [
    liveDeals,
    pendingDeals,
    clicks7d,
    clicks30d,
    topDeals,
    byCategory,
    recentJobs,
    subscribers,
  ] = await Promise.all([
    prisma.deal.count({ where: { status: "APPROVED" } }),
    prisma.deal.count({ where: { status: "PENDING" } }),
    prisma.clickLog.count({ where: { createdAt: { gte: new Date(now - 7 * day) } } }),
    prisma.clickLog.count({ where: { createdAt: { gte: new Date(now - 30 * day) } } }),
    prisma.deal.findMany({
      where: { status: "APPROVED" },
      orderBy: { clicks: "desc" },
      take: 10,
      select: { id: true, slug: true, title: true, clicks: true, views: true, aiScore: true },
    }),
    prisma.deal.groupBy({
      by: ["category"],
      where: { status: "APPROVED" },
      _count: { id: true },
    }),
    prisma.affiliateJob.findMany({
      orderBy: { startedAt: "desc" },
      take: 15,
    }),
    prisma.emailAlert.count({ where: { isActive: true } }),
  ]);

  return NextResponse.json({
    liveDeals,
    pendingDeals,
    clicks7d,
    clicks30d,
    subscribers,
    topDeals,
    byCategory: byCategory.map((c) => ({ category: c.category, count: c._count.id })),
    recentJobs,
  });
}
