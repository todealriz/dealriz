import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /go/[id] — affiliate redirect with click tracking.
// Logs the click (SHA-256 hashed IP, user agent, referrer, timestamp — never
// the plain IP), increments the deal's click counter, then 302-redirects.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const deal = await prisma.deal.findUnique({
    where: { id: params.id },
    select: { id: true, affiliateUrl: true, status: true },
  });

  if (!deal || deal.status === "REJECTED") {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Best-effort logging — never block the redirect on a logging failure.
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
    const salt = process.env.CLICK_SALT ?? "dealriz-click-salt";
    const ipHash = createHash("sha256").update(`${salt}|${ip}`).digest("hex");

    await Promise.all([
      prisma.clickLog.create({
        data: {
          dealId: deal.id,
          ipHash,
          userAgent: req.headers.get("user-agent")?.slice(0, 500),
          referer: req.headers.get("referer")?.slice(0, 500),
        },
      }),
      prisma.deal.update({
        where: { id: deal.id },
        data: { clicks: { increment: 1 } },
      }),
    ]);
  } catch (err) {
    console.error("click logging failed:", err);
  }

  const res = NextResponse.redirect(deal.affiliateUrl, 302);
  // Never let affiliate clicks be cached or leak referrer unnecessarily.
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}
