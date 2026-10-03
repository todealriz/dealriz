import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { subscribeSchema } from "@/lib/validation";

export const runtime = "nodejs";

// POST /api/alerts/subscribe — { email, keyword?, category? }.
// No account required. Each subscription gets an unguessable token for
// one-click unsubscribe (CAN-SPAM).
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { email, keyword, category } = parsed.data;

  // Idempotent: re-activates an existing subscription instead of duplicating.
  const existing = await prisma.emailAlert.findFirst({
    where: { email: email.toLowerCase() },
  });

  if (existing) {
    await prisma.emailAlert.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        keyword: keyword || null,
        category: category || null,
      },
    });
  } else {
    await prisma.emailAlert.create({
      data: {
        email: email.toLowerCase(),
        keyword: keyword || null,
        category: category || null,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
