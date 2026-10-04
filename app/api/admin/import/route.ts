import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { slugify, uniqueSlug } from "@/lib/slug";
import { computeDealScore } from "@/lib/scoring";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  fetchGoogleSheetCsv,
  parseCsvText,
  parseImportFile,
  rowExternalId,
  summarizeDryRun,
  type RowError,
} from "@/lib/bulk-import";

export const runtime = "nodejs";
// Bulk imports can take a while (up to 2000 rows × DB writes).
export const maxDuration = 120;

// POST /api/admin/import — multipart/form-data:
//   file: .xlsx | .xls | .csv | .tsv | .txt (≤5MB, ≤2000 rows)
//     — OR —
//   sheetUrl: a shared Google Sheets link ("Anyone with the link can view");
//             imports the first sheet (or the tab in the link's ?gid=)
//   dryRun: "1" → validate + preview only, no DB writes
//   autoApprove: "1" → created deals are APPROVED (and scored immediately);
//                default "0" → PENDING (moderation queue)
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const sheetUrlRaw = form.get("sheetUrl");
  const sheetUrl = typeof sheetUrlRaw === "string" ? sheetUrlRaw.trim() : "";
  const hasFile = file instanceof File && file.size > 0;

  if (!hasFile && !sheetUrl) {
    return NextResponse.json({ error: "Provide a file upload or a Google Sheets link" }, { status: 400 });
  }

  const dryRun = form.get("dryRun") === "1";
  const autoApprove = form.get("autoApprove") === "1";

  let records: Record<string, string>[];
  try {
    if (sheetUrl) {
      // Google Sheets path: download the CSV export and parse it.
      const csv = await fetchGoogleSheetCsv(sheetUrl);
      if (csv.length > MAX_IMPORT_BYTES) {
        return NextResponse.json({ error: "Sheet is too large. Max is 5MB of data." }, { status: 400 });
      }
      records = parseCsvText(csv, ",").records;
    } else {
      const f = file as File;
      if (f.size > MAX_IMPORT_BYTES) {
        return NextResponse.json(
          { error: `File too large (${(f.size / 1024 / 1024).toFixed(1)}MB). Max is 5MB.` },
          { status: 400 }
        );
      }
      const buffer = Buffer.from(await f.arrayBuffer());
      records = parseImportFile(buffer, f.name || "upload.csv").records;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not parse input" },
      { status: 400 }
    );
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "No data rows found in the file" }, { status: 400 });
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (${records.length}). Max is ${MAX_IMPORT_ROWS} per import — split the file and try again.` },
      { status: 400 }
    );
  }

  const summary = summarizeDryRun(records);
  if (!summary.ok) {
    return NextResponse.json({ error: summary.error, missing: summary.missing }, { status: 400 });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      totalRows: summary.totalRows,
      validCount: summary.validCount,
      errorCount: summary.errorCount,
      preview: summary.preview,
      errors: summary.errors,
    });
  }

  // ── Commit ──
  const status = autoApprove ? "APPROVED" : "PENDING";
  let imported = 0;
  let skippedDuplicates = 0;
  const errors: RowError[] = [];
  const seenExternalIds = new Set<string>();

  for (const d of summary.valid) {
    // rowNumber is best-effort here (valid rows lost their original index);
    // errors reference the deal title instead.
    try {
      // In-batch dedupe.
      if (seenExternalIds.has(d.externalId)) {
        skippedDuplicates++;
        continue;
      }

      // DB dedupe: (1) same externalId, (2) same URL-derived id (catches the
      // same URL re-imported under a different externalId), (3) same gtin.
      const candidates = [d.externalId];
      const urlId = rowExternalId({ affiliateUrl: d.affiliateUrl });
      if (urlId !== d.externalId) candidates.push(urlId);
      let existing: { id: string } | null = null;
      for (const ext of candidates) {
        existing = await prisma.deal.findUnique({ where: { externalId: ext } });
        if (existing) break;
      }
      if (!existing && d.gtin) {
        existing = await prisma.deal.findFirst({
          where: { gtin: d.gtin },
          select: { id: true },
        });
      }
      if (existing) {
        skippedDuplicates++;
        continue;
      }

      const store = await prisma.store.upsert({
        where: { slug: slugify(d.storeName) },
        update: { name: d.storeName, affiliateNetwork: d.affiliateNetwork },
        create: {
          slug: slugify(d.storeName),
          name: d.storeName,
          affiliateNetwork: d.affiliateNetwork,
        },
      });

      const discountPct =
        d.originalPrice && d.originalPrice > d.salePrice
          ? Math.round((1 - d.salePrice / d.originalPrice) * 100)
          : 0;

      const created = await prisma.deal.create({
        data: {
          externalId: d.externalId,
          slug: uniqueSlug(d.title),
          title: d.title,
          description: d.description ?? null,
          salePrice: d.salePrice,
          originalPrice: d.originalPrice ?? null,
          discountPct,
          couponCode: d.couponCode ?? null,
          affiliateUrl: d.affiliateUrl,
          imageUrl: d.imageUrl ?? null,
          category: d.category,
          badge: d.badge ?? null,
          status,
          expiresAt: d.expiresAt ?? null,
          storeId: store.id,
          gtin: d.gtin ?? null,
          mpn: d.mpn ?? null,
        },
      });

      // Auto-approved deals get scored immediately so they appear on the
      // homepage without waiting for the score cron job.
      if (status === "APPROVED") {
        const { score, components } = computeDealScore(created);
        await prisma.deal.update({
          where: { id: created.id },
          data: {
            aiScore: score,
            scoreComponents: JSON.stringify(components),
            scoredAt: new Date(),
          },
        });
      }

      seenExternalIds.add(d.externalId);
      imported++;
    } catch (err) {
      errors.push({
        rowNumber: 0,
        errors: [`"${d.title.slice(0, 60)}": ${err instanceof Error ? err.message : "db error"}`],
      });
    }
  }

  return NextResponse.json({
    dryRun: false,
    totalRows: summary.totalRows,
    imported,
    skippedDuplicates,
    rowErrors: summary.errorCount,
    errors: [...summary.errors.slice(0, 25), ...errors.slice(0, 25)].slice(0, 50),
  });
}
