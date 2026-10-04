import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { importTemplateCsv } from "@/lib/bulk-import";

export const runtime = "nodejs";

// GET /api/admin/import/template — download a CSV template with the exact
// expected headers plus 2 example rows.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();
  const csv = importTemplateCsv();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dealriz-import-template.csv"',
    },
  });
}
