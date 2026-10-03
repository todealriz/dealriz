import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SITE } from "@/lib/site";

export const runtime = "nodejs";

// GET /api/alerts/unsubscribe?token=xxx — one-click unsubscribe (CAN-SPAM).
// Returns a small confirmation page (no JS, no login).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  let message: string;
  let ok = false;
  if (!token) {
    message = "Missing unsubscribe token.";
  } else {
    const sub = await prisma.emailAlert.findUnique({ where: { token } });
    if (!sub) {
      message = "This unsubscribe link is invalid or already used.";
    } else {
      await prisma.emailAlert.update({
        where: { id: sub.id },
        data: { isActive: false },
      });
      message = `Done — ${sub.email} will no longer receive deal alerts from ${SITE.name}.`;
      ok = true;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — ${SITE.name}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 16px;color:#0f172a;">
<h1 style="font-size:24px;">${ok ? "Unsubscribed ✓" : "Hmm…"}</h1>
<p>${message}</p>
<p><a href="${SITE.url}" style="color:#0ea5e9;">← Back to ${SITE.name}</a></p>
</body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
