import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

// ─────────────────────────────────────────────────────────────────────────────
// Generic CSV/TSV datafeed helper — dependency-free.
//
// Many affiliate networks (notably ShareASale/Awin) publish product datafeeds
// as giant CSV/TSV files (HTTP download or FTP). This module streams them
// row-by-row (never loads the whole file into memory — feeds can be 100MB+),
// maps columns to a uniform row shape, and lets you filter before you keep
// anything.
//
// No new npm dependencies: node:readline + global fetch only.
// ─────────────────────────────────────────────────────────────────────────────

export type FeedSource = { url: string } | { file: string };

export type FeedOptions = {
  /** Column delimiter. Default ",". Use "\t" for TSV feeds. */
  delimiter?: string;
  /** Skip the first N lines (some feeds have preamble rows). Default 0. */
  skipLines?: number;
  /** Stop after N data rows (useful for smoke tests). Default Infinity. */
  limit?: number;
  /** Keep only rows where this returns true. Runs BEFORE column mapping. */
  rowFilter?: (raw: Record<string, string>) => boolean;
};

export type MappedRow = {
  externalId: string;
  title: string;
  salePrice: number;
  originalPrice?: number;
  imageUrl?: string;
  affiliateUrl: string;
  category?: string;
  gtin?: string;
  mpn?: string;
  couponCode?: string;
  inStock?: boolean;
};

/**
 * Map feed-specific column names onto the uniform MappedRow shape.
 * Keys are the FEED's column headers; values pick the target field.
 *
 * Example (ShareASale-style product feed):
 *   { "SKU": "externalId", "Name": "title", "Price": "salePrice",
 *     "RetailPrice": "originalPrice", "ImageURL": "imageUrl",
 *     "ProductURL": "affiliateUrl", "Category": "category",
 *     "UPC": "gtin", "MPN": "mpn" }
 */
export type ColumnMap = Record<string, keyof MappedRow>;

/** Minimal CSV parser: handles quotes, escaped quotes, and the delimiter. */
function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function toStream(source: FeedSource): Promise<Readable> {
  if ("file" in source) {
    return createReadStream(source.file, { encoding: "utf-8" });
  }
  const res = await fetch(source.url);
  if (!res.ok || !res.body) {
    throw new Error(`[datafeed] Download failed: ${res.status} ${source.url}`);
  }
  // Bridge the WHATWG stream from fetch() into a Node Readable without
  // Readable.fromWeb() (its web/node type overlap breaks tsc here).
  const reader = res.body.getReader();
  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        this.push(done ? null : Buffer.from(value).toString("utf-8"));
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}

/**
 * Stream a CSV/TSV feed as raw header→value records. Memory-safe for
 * large feeds — process or discard each row as it arrives.
 */
export async function* streamFeedRows(
  source: FeedSource,
  opts: FeedOptions = {}
): AsyncGenerator<Record<string, string>> {
  const delimiter = opts.delimiter ?? ",";
  const skipLines = opts.skipLines ?? 0;
  const limit = opts.limit ?? Infinity;

  const stream = await toStream(source);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] | null = null;
  let skipped = 0;
  let yielded = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (skipped < skipLines) {
      skipped++;
      continue;
    }
    if (!headers) {
      headers = parseLine(line, delimiter);
      continue;
    }
    const cells = parseLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    if (opts.rowFilter && !opts.rowFilter(row)) continue;
    yield row;
    if (++yielded >= limit) break;
  }
}

const toNum = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Download (or read), parse, filter, and map a whole feed into MappedRows.
 * For very large feeds prefer streamFeedRows() and handle rows incrementally.
 */
export async function fetchMappedFeed(
  source: FeedSource,
  columnMap: ColumnMap,
  opts: FeedOptions = {}
): Promise<MappedRow[]> {
  const rows: MappedRow[] = [];
  for await (const raw of streamFeedRows(source, opts)) {
    const mapped = {} as Record<keyof MappedRow, string | number | boolean | undefined>;
    for (const [feedCol, target] of Object.entries(columnMap)) {
      const v = raw[feedCol];
      if (v == null || v === "") continue;
      if (target === "salePrice" || target === "originalPrice") {
        mapped[target] = toNum(v);
      } else if (target === "inStock") {
        mapped[target] = /^(y|yes|true|in ?stock|1)$/i.test(v.trim());
      } else {
        mapped[target] = v;
      }
    }
    if (!mapped.externalId || !mapped.title || !mapped.salePrice || !mapped.affiliateUrl) {
      continue; // incomplete row — skip rather than ingest garbage
    }
    rows.push(mapped as MappedRow);
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKED EXAMPLE — ShareASale-style product datafeed → RawDeals.
//
// ShareASale publishes per-merchant product feeds (in the merchant's dashboard:
// Tools → Datafeeds). They are typically pipe- or comma-delimited with
// columns like SKU, Name, Price, RetailPrice, ImageURL, ProductURL...
// (exact headers vary per merchant — print a few raw rows first and adjust
// the ColumnMap below).
//
//   import { fetchMappedFeed } from "@/lib/affiliates/datafeed";
//   import type { RawDeal } from "@/lib/affiliates/types";
//
//   const rows = await fetchMappedFeed(
//     { url: "https://account.shareasale.com/.../productfeed.csv" },
//     {
//       "SKU": "externalId",
//       "Name": "title",
//       "Price": "salePrice",
//       "RetailPrice": "originalPrice",
//       "ImageURL": "imageUrl",
//       "ProductURL": "affiliateUrl",   // ShareASale tags these to your account
//       "Category": "category",
//       "UPC": "gtin",
//     },
//     {
//       delimiter: ",",
//       // Keep only plausible deals BEFORE mapping — cheap pre-filter:
//       rowFilter: (r) => (parseFloat(r.Price) || 0) < (parseFloat(r.RetailPrice) || Infinity),
//       limit: 2000, // remove in production; here to bound the first test run
//     }
//   );
//   const rawDeals: RawDeal[] = rows.map((r) => ({
//     externalId: `shareasale-${r.externalId}`,
//     title: r.title,
//     salePrice: r.salePrice,
//     originalPrice: r.originalPrice,
//     imageUrl: r.imageUrl,
//     affiliateUrl: r.affiliateUrl,       // already tagged by ShareASale
//     category: r.category ?? "Other",
//     storeName: "Merchant Name",          // one feed == one merchant
//     affiliateNetwork: "ShareASale",
//     gtin: r.gtin,
//   }));
//   // ...then feed rawDeals into ingestAdapter() via a tiny AffiliateAdapter
//   // wrapper, or call the same normalize/upsert path directly.
// ─────────────────────────────────────────────────────────────────────────────
