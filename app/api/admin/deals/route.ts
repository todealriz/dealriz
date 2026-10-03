import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { adminDealSubmitSchema, dealStatusSchema } from "@/lib/validation";
import { slugify, uniqueSlug } from "@/lib/slug";
import { computeRankScore, getClicks24hMap, sortByRank } from "@/lib/ranking";

export const runtime = "nodejs";

// GET /api/admin/deals?status=PENDING — moderation queue, ranked by rankScore
// (pinned first). Each deal carries its computed rankScore so the admin can
// see exactly why it would place where it does.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();
  const status = req.nextUrl.searchParams.get("status");
  const parsed = dealStatusSchema.safeParse(status ?? undefined);
  const where = parsed.success ? { status: parsed.data } : {};
  const deals = await prisma.deal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { store: { select: { name: true } } },
  });
  const clicks24h = await getClicks24hMap(deals.map((d) => d.id));
  const scoreOf = (d: (typeof deals)[number]) =>
    computeRankScore(d, { clicks24h: clicks24h.get(d.id) ?? 0 }).score;
  const ranked = sortByRank(deals, scoreOf).map((d) => ({
    ...d,
    rankScore: scoreOf(d),
  }));
  return NextResponse.json({ deals: ranked });
}

// POST /api/admin/deals — submit a deal to the moderation queue (PENDING).
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = adminDealSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const store = await prisma.store.upsert({
    where: { slug: slugify(d.storeName) },
    update: { name: d.storeName },
    create: { slug: slugify(d.storeName), name: d.storeName },
  });

  const discountPct =
    d.originalPrice && d.originalPrice > d.salePrice
      ? Math.round((1 - d.salePrice / d.originalPrice) * 100)
      : 0;

  let expiresAt: Date | undefined;
  if (d.expiresAt) {
    const t = new Date(d.expiresAt);
    if (!Number.isNaN(t.getTime())) expiresAt = t;
  }

  const deal = await prisma.deal.create({
    data: {
      externalId: `manual-${Date.now()}`,
      slug: uniqueSlug(d.title),
      title: d.title,
      description: d.description || null,
      salePrice: d.salePrice,
      originalPrice: d.originalPrice ?? null,
      discountPct,
      couponCode: d.couponCode || null,
      affiliateUrl: d.affiliateUrl,
      imageUrl: d.imageUrl || null,
      category: d.category,
      badge: d.badge || null,
      status: "PENDING",
      expiresAt,
      storeId: store.id,
    },
  });

  return NextResponse.json({ ok: true, deal }, { status: 201 });
}
