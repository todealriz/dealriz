import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { adminDealActionSchema } from "@/lib/validation";

export const runtime = "nodejs";

// PATCH /api/admin/deals/[id]
//   { action: "approve" | "reject" } — moderation
//   { action: "boost", boostFactor: 1.0–2.0, pinnedUntil?: ISO datetime | null }
//     — ranking override: boostFactor multiplies rankScore (see lib/ranking.ts);
//       pinnedUntil pins the deal above all unpinned deals until it lapses.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = adminDealActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const action = parsed.data;
  if (action.action === "boost") {
    let pinnedUntil: Date | null = null;
    if (action.pinnedUntil) {
      const t = new Date(action.pinnedUntil);
      if (Number.isNaN(t.getTime())) {
        return NextResponse.json({ error: "Invalid pinnedUntil datetime" }, { status: 400 });
      }
      pinnedUntil = t;
    }
    const updated = await prisma.deal.update({
      where: { id: params.id },
      data: { boostFactor: action.boostFactor, pinnedUntil },
    });
    return NextResponse.json({ ok: true, deal: updated });
  }

  const updated = await prisma.deal.update({
    where: { id: params.id },
    data: { status: action.action === "approve" ? "APPROVED" : "REJECTED" },
  });
  return NextResponse.json({ ok: true, deal: updated });
}

// DELETE /api/admin/deals/[id] — soft-delete (marks REJECTED).
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();
  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  await prisma.deal.update({
    where: { id: params.id },
    data: { status: "REJECTED" },
  });
  return NextResponse.json({ ok: true });
}
