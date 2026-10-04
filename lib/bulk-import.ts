// Bulk deal import: spreadsheet parsing + column mapping + row validation.
//
// Supports Excel (.xlsx/.xls) via SheetJS and CSV/TSV via the existing
// dependency-free parser in lib/affiliates/datafeed.ts. All functions here
// are pure (no DB) so they can be unit-tested in isolation; the API route
// handles persistence, dedupe and scoring.

import * as XLSX from "xlsx";
import { z } from "zod";
import { createHash } from "crypto";
import { rawDealSchema } from "./validation";
import { isCategory } from "./categories";
import { parseLine } from "./affiliates/datafeed";

export type RawDeal = z.infer<typeof rawDealSchema>;

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
const PREVIEW_ROWS = 25;
const ERROR_ROWS = 50;

export type RowError = { rowNumber: number; errors: string[] };

/**
 * Canonical columns. Headers are matched case-insensitively and these
 * common aliases are accepted (e.g. "price" → salePrice, "url" → affiliateUrl).
 */
export const IMPORT_COLUMNS = [
  { key: "title", required: true, aliases: ["name", "product", "product name"] },
  { key: "salePrice", required: true, aliases: ["price", "sale price", "current price", "deal price"] },
  { key: "affiliateUrl", required: true, aliases: ["url", "link", "affiliate link", "product url", "deal url"] },
  { key: "storeName", required: true, aliases: ["store", "merchant", "retailer", "shop"] },
  { key: "originalPrice", required: false, aliases: ["listprice", "list price", "was", "regular price", "msrp", "rrp", "compare at"] },
  { key: "category", required: false, aliases: ["cat", "department"] },
  { key: "imageUrl", required: false, aliases: ["image", "img", "picture", "thumbnail", "photo"] },
  { key: "description", required: false, aliases: ["desc", "details", "summary"] },
  { key: "couponCode", required: false, aliases: ["coupon", "promo", "promo code", "discount code", "code"] },
  { key: "badge", required: false, aliases: ["tag", "label"] },
  { key: "expiresAt", required: false, aliases: ["expires", "expiry", "end date", "expiration"] },
  { key: "externalId", required: false, aliases: ["external id", "id", "sku", "item id"] },
  { key: "gtin", required: false, aliases: ["upc", "ean", "isbn", "barcode"] },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

// header (lowercased, punctuation stripped) → canonical key
const HEADER_MAP: Record<string, ImportColumnKey> = {};
for (const col of IMPORT_COLUMNS) {
  HEADER_MAP[normalizeHeader(col.key)] = col.key;
  for (const a of col.aliases) HEADER_MAP[normalizeHeader(a)] = col.key;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-]+/g, "");
}

/** Map raw header names to canonical column keys (null = unknown column, ignored). */
export function mapHeaders(headers: string[]): (ImportColumnKey | null)[] {
  return headers.map((h) => HEADER_MAP[normalizeHeader(h)] ?? null);
}

export function missingRequiredColumns(mapped: (ImportColumnKey | null)[]): string[] {
  const present = new Set(mapped.filter(Boolean));
  return IMPORT_COLUMNS.filter((c) => c.required && !present.has(c.key)).map((c) => c.key);
}

// ── File parsing ─────────────────────────────────────────────────────────

export type ParsedSheet = {
  records: Record<string, string>[]; // header-name → cell value
  rowCount: number;
};

function recordsFromRows(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });
}

/** Parse CSV/TSV text with an explicit delimiter. Exported for the Google Sheets path. */
export function parseCsvText(text: string, delimiter: string): ParsedSheet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { records: [], rowCount: 0 };
  const headers = parseLine(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => parseLine(l, delimiter));
  return { records: recordsFromRows(headers, rows), rowCount: rows.length };
}

function parseExcel(buffer: Buffer): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { records: [], rowCount: 0 };
  // header:1 gives raw rows (first row = headers); defval keeps blanks as "".
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  });
  if (aoa.length === 0) return { records: [], rowCount: 0 };
  const headers = aoa[0].map((h) => String(h ?? "").trim());
  const rows = aoa.slice(1).map((r) =>
    r.map((c) => {
      if (c instanceof Date) return c.toISOString();
      return String(c ?? "").trim();
    })
  );
  // Drop fully-empty rows (trailing blank rows are common in Excel).
  const nonEmpty = rows.filter((r) => r.some((c) => c !== ""));
  return { records: recordsFromRows(headers, nonEmpty), rowCount: nonEmpty.length };
}

/** Parse an uploaded file into header→value records. Throws on unsupported type. */
export function parseImportFile(buffer: Buffer, filename: string): ParsedSheet {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseExcel(buffer);
  }
  if (lower.endsWith(".tsv")) {
    return parseCsvText(buffer.toString("utf-8"), "\t");
  }
  if (lower.endsWith(".csv")) {
    return parseCsvText(buffer.toString("utf-8"), ",");
  }
  if (lower.endsWith(".txt")) {
    // Plain-text exports: sniff the delimiter from the first non-empty line
    // (tab-separated and comma-separated are both common).
    const text = buffer.toString("utf-8");
    const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const tabs = (firstLine.match(/\t/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    return parseCsvText(text, tabs > commas ? "\t" : ",");
  }
  throw new Error(
    `Unsupported file type "${filename}". Use .xlsx, .xls, .csv, .tsv or .txt.`
  );
}

// ── Google Sheets ───────────────────────────────────────────────────────
// Paste-a-link import: the sheet must be shared as "Anyone with the link can
// view". We fetch Google's CSV export of the first sheet (or the tab in ?gid=).

/** Extract the spreadsheet ID (and optional tab gid) from a share URL. */
export function parseGoogleSheetsUrl(url: string): { id: string; gid?: string } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "docs.google.com") return null;
    const m = u.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) return null;
    const gid = u.searchParams.get("gid") ?? u.hash.match(/[#&]gid=(\d+)/)?.[1] ?? undefined;
    return { id: m[1], gid };
  } catch {
    return null;
  }
}

export function googleSheetsCsvUrl(id: string, gid?: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/** Download a shared Google Sheet as CSV text. Throws with a user-friendly message. */
export async function fetchGoogleSheetCsv(sheetUrl: string): Promise<string> {
  const parsed = parseGoogleSheetsUrl(sheetUrl);
  if (!parsed) {
    throw new Error(
      "That doesn't look like a Google Sheets link. Copy the full share URL from your browser's address bar."
    );
  }
  let res: Response;
  try {
    res = await fetch(googleSheetsCsvUrl(parsed.id, parsed.gid), { redirect: "follow" });
  } catch {
    throw new Error("Could not reach Google Sheets. Check your connection and try again.");
  }
  if (!res.ok) {
    throw new Error(
      `Google Sheets returned HTTP ${res.status}. Make sure link sharing is ON: Share → General access → "Anyone with the link".`
    );
  }
  const text = await res.text();
  if (/^\s*<(?:!DOCTYPE|html)/i.test(text)) {
    throw new Error(
      "Google returned a sign-in page instead of the sheet. Turn ON link sharing: Share → General access → " +
        '"Anyone with the link".'
    );
  }
  return text;
}

// ── Row normalization + validation ───────────────────────────────────────

function toNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function cleanUrl(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

/** Normalize an affiliate URL for dedupe: lowercase host, drop tracking params. */
export function normalizeAffiliateUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    // Drop common tracking params that don't change the destination.
    const drop = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "_ga",
    ]);
    for (const p of Array.from(u.searchParams.keys())) {
      if (drop.has(p.toLowerCase())) u.searchParams.delete(p);
    }
    // Sort remaining params for a canonical form.
    u.searchParams.sort();
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return url.trim();
  }
}

/** Stable externalId for a row: use the sheet's id, else hash the normalized URL. */
export function rowExternalId(row: Partial<Record<ImportColumnKey, string>>): string {
  const given = (row.externalId ?? "").trim();
  if (given) return given.slice(0, 120);
  const url = normalizeAffiliateUrl(row.affiliateUrl ?? "");
  return `bulk-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

/**
 * Turn header→value records into validated RawDeals.
 * Never throws on bad rows — errors are collected per row.
 */
export function normalizeImportRows(records: Record<string, string>[]): {
  valid: RawDeal[];
  errors: RowError[];
} {
  const valid: RawDeal[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < records.length; i++) {
    const rowNumber = i + 2; // 1-based, +1 for the header row
    try {
      const rec = records[i];
      // Build a canonical-key record from whatever headers the sheet used.
      const mapped: Record<string, string> = {};
      for (const [header, value] of Object.entries(rec)) {
        const key = HEADER_MAP[normalizeHeader(header)];
        if (key && !(key in mapped)) mapped[key] = value;
      }

      const rowErrors: string[] = [];
      if (!(mapped.title ?? "").trim()) rowErrors.push("title is required");
      if (toNumber(mapped.salePrice) === undefined)
        rowErrors.push("salePrice must be a positive number");
      if (!cleanUrl(mapped.affiliateUrl))
        rowErrors.push("affiliateUrl is required");
      if (!(mapped.storeName ?? "").trim()) rowErrors.push("storeName is required");

      const categoryRaw = (mapped.category ?? "").trim();
      const category = categoryRaw
        ? isCategory(categoryRaw)
          ? categoryRaw
          : null // unknown category → flagged, defaulted below
        : "Other";
      if (categoryRaw && !category) {
        rowErrors.push(
          `unknown category "${categoryRaw}" (must be one of: ${["Electronics","Fashion","Home","Grocery","Health","Sports","Gaming","Travel","Pets","Kids","Tools","Other"].join(", ")})`
        );
      }

      if (rowErrors.length > 0) {
        errors.push({ rowNumber, errors: rowErrors });
        continue;
      }

      const candidate = {
        externalId: rowExternalId(mapped as Partial<Record<ImportColumnKey, string>>),
        title: (mapped.title ?? "").trim().slice(0, 200),
        description: (mapped.description ?? "").trim().slice(0, 3000) || undefined,
        salePrice: toNumber(mapped.salePrice)!,
        originalPrice: toNumber(mapped.originalPrice),
        couponCode: (mapped.couponCode ?? "").trim().slice(0, 60) || undefined,
        affiliateUrl: cleanUrl(mapped.affiliateUrl)!,
        imageUrl: cleanUrl(mapped.imageUrl),
        category: category ?? "Other",
        badge: (mapped.badge ?? "").trim().slice(0, 24) || undefined,
        storeName: (mapped.storeName ?? "").trim().slice(0, 100),
        affiliateNetwork: "Bulk import",
        expiresAt: (mapped.expiresAt ?? "").trim() || undefined,
        gtin: (mapped.gtin ?? "").trim().slice(0, 40) || undefined,
      };

      const parsed = rawDealSchema.safeParse(candidate);
      if (!parsed.success) {
        errors.push({
          rowNumber,
          errors: parsed.error.issues.map(
            (iss) => `${iss.path.join(".") || "row"}: ${iss.message}`
          ),
        });
        continue;
      }
      valid.push(parsed.data);
    } catch (err) {
      errors.push({
        rowNumber,
        errors: [err instanceof Error ? err.message : "unexpected row error"],
      });
    }
  }

  return { valid, errors };
}

/** Build the full dry-run summary from parsed records. */
export function summarizeDryRun(records: Record<string, string>[]) {
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  const mapped = mapHeaders(headers);
  const missing = missingRequiredColumns(mapped);
  if (missing.length > 0) {
    return {
      ok: false as const,
      error: `Missing required column(s): ${missing.join(", ")}. Required: title, salePrice, affiliateUrl, storeName.`,
      missing,
    };
  }
  const { valid, errors } = normalizeImportRows(records);
  return {
    ok: true as const,
    totalRows: records.length,
    validCount: valid.length,
    errorCount: errors.length,
    preview: valid.slice(0, PREVIEW_ROWS),
    errors: errors.slice(0, ERROR_ROWS),
    valid,
  };
}

/** CSV template: exact expected headers + 2 example rows. */
export function importTemplateCsv(): string {
  const headers = IMPORT_COLUMNS.map((c) => c.key).join(",");
  const rows = [
    [
      "Sony WH-1000XM5 Wireless Headphones",
      "248.00",
      "https://www.amazon.com/dp/B09XS7JWHH?tag=yourtag-20",
      "Amazon",
      "399.99",
      "Electronics",
      "https://m.media-amazon.com/images/I/example.jpg",
      "Industry-leading noise cancelling over-ear headphones.",
      "",
      "Hot deal",
      "",
      "",
      "019594909608",
    ].join(","),
    [
      "KitchenAid Artisan 5-Qt Stand Mixer",
      "329.95",
      "https://www.walmart.com/ip/12345678",
      "Walmart",
      "499.00",
      "Home",
      "",
      "10-speed stand mixer, Empire Red.",
      "SAVE20",
      "",
      "2026-12-31",
      "mixer-001",
      "",
    ].join(","),
  ];
  return [headers, ...rows].join("\n") + "\n";
}
