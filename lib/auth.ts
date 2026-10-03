import type { NextRequest } from "next/server";

// Admin auth for /api/admin/* and /api/jobs/* and the /admin UI's API calls.
//
// The client (a solo founder) sends the key as the `X-Admin-Key` header
// (or `?key=` for quick curl checks). The key itself lives in ADMIN_API_KEY.
//
// Dev convenience: if ADMIN_API_KEY is unset and we're not in production,
// requests are allowed so local development works with zero setup.

export function adminKeyFromRequest(req: NextRequest): string | null {
  const header = req.headers.get("x-admin-key");
  if (header) return header;
  const viaQuery = req.nextUrl.searchParams.get("key");
  return viaQuery;
}

export function isAdminRequest(req: NextRequest): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  const provided = adminKeyFromRequest(req);
  return !!provided && provided === expected;
}

export function unauthorizedResponse() {
  return Response.json(
    { error: "Unauthorized. Provide a valid X-Admin-Key header." },
    { status: 401 }
  );
}
