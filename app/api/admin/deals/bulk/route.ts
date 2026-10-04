import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { adminBulkActionSchema } from "@/lib/validation";

export const runtime = "nodejs";

// POST /api/admin/deals/bulk
//   { ids: string[], action: "approve" | "reject" }
// Bulk moderation. Mirrors the single-deal PATCH behavior exactly:
// approve → status=APPROVED, reject → status=REJECTED. No immediate
// scoring here (same as the single path) — the score cron job scores
// approved deals on its next run.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = adminBulkActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input: provide ids (1–500) and action approve|reject" },
      { status: 400 }
    );
  }

  const status = parsed.data.action === "approve" ? "APPROVED" : "REJECTED";
  const result = await prisma.deal.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { status },
  });

  return NextResponse.json({
    approved: status === "APPROVED" ? result.count : 0,
    rejected: status === "REJECTED" ? result.count : 0,
  });
}
