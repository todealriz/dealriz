import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dealFiltersSchema, PRICE_BANDS } from "@/lib/validation";
import { isCategory } from "@/lib/categories";
import { DEALS_PER_PAGE } from "@/lib/site";

export const runtime = "nodejs";

// GET /api/deals — JSON feed of live deals (filters/sort/search via query params).
// Powers future widgets/embeds; the site itself server-renders.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = dealFiltersSchema.safeParse({
    q: sp.get("q") ?? undefined,
    category: sp.get("category") ?? undefined,
    minDiscount: sp.get("minDiscount") ?? undefined,
    price: sp.get("price") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid filters", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const f = parsed.data;
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? DEALS_PER_PAGE;

  const where: Record<string, unknown> = {
    status: "APPROVED",
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
  const and: Record<string, unknown>[] = [];
  if (f.q?.trim()) {
    and.push({
      OR: [
        { title: { contains: f.q.trim() } },
        { description: { contains: f.q.trim() } },
        { store: { name: { contains: f.q.trim() } } },
      ],
    });
  }
  if (isCategory(f.category)) and.push({ category: f.category });
  if (f.minDiscount && f.minDiscount > 0) and.push({ discountPct: { gte: f.minDiscount } });
  if (f.price && f.price !== "any") {
    const band = PRICE_BANDS[f.price];
    const pf: Record<string, number> = {};
    if (band.min != null) pf.gte = band.min;
    if (band.max != null) pf.lt = band.max;
    and.push({ salePrice: pf });
  }
  if (and.length) where.AND = and;

  const orderBy =
    f.sort === "discount"
      ? [{ discountPct: "desc" as const }]
      : f.sort === "price-asc"
        ? [{ salePrice: "asc" as const }]
        : f.sort === "price-desc"
          ? [{ salePrice: "desc" as const }]
          : f.sort === "score"
            ? [{ aiScore: "desc" as const }]
            : [{ createdAt: "desc" as const }];

  const [total, deals] = await Promise.all([
    prisma.deal.count({ where }),
    prisma.deal.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, slug: true, title: true, salePrice: true, originalPrice: true,
        discountPct: true, couponCode: true, imageUrl: true, category: true,
        badge: true, aiScore: true, expiresAt: true, createdAt: true,
        store: { select: { name: true, slug: true } },
      },
    }),
  ]);

  return NextResponse.json({
    deals,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}
