import { createHash } from "node:crypto";
import type { AffiliateAdapter, RawDeal } from "./types";
import { isCategory } from "../categories";
import { parseLine, streamFeedRows } from "./datafeed";

// ─────────────────────────────────────────────────────────────────────────────
// ShareASale affiliate adapter (ShareASale is an Awin Group company).
//
// TWO MODES (both optional; configure whichever you have):
//   Mode A — Affiliate API: keyword product search (getProducts) scoped to
//            SHAREASALE_MERCHANT_IDS, plus current coupon deals (couponDeals).
//   Mode B — Datafeed CSVs: per-merchant product feed download URLs pasted
//            from the ShareASale dashboard (SHAREASALE_DATAFEED_URLS),
//            streamed through lib/affiliates/datafeed.ts.
//
// API contract — VERIFIED (not guessed):
//   Endpoint:   GET https://api.shareasale.com/x.cfm          (affiliate API;
//               the merchant API lives at /w.cfm — different auth subject)
//   Query:      ?version=2.3 & action={verb} & affiliateId={id} & token={token}
//               + action params (keyword, merchantId, current, ...)
//   Headers:    x-ShareASale-Date: "Thu, 02 Oct 2026 23:50:00 GMT"
//               x-ShareASale-Authentication: UPPERCASE_HEX(
//                 SHA256("{token}:{date}:{action}:{secret}"))
//               (plain SHA256, NOT HMAC — confirmed from a working client)
//   Actions:    getProducts (requires keyword; optional merchantId),
//               couponDeals (optional current=1, modifiedSince, merchantId)
//   Formats:    csv (default), xml, pipe — we request csv.
//   Errors:     the API returns HTTP 200 even on auth failure; the body then
//               starts with "Invalid Request". We detect that and throw.
//   Source:     official docs are now behind the Awin-migrated login
//               (account.shareasale.com/a-apiVersion2.cfm redirects to Awin),
//               so the contract above was verified against REAL recorded API
//               traffic (VCR cassettes) of an unofficial client built on the
//               official docs: github.com/tommycarney/teilashare
//               (spec/fixtures/vcr_cassettes/{products,coupon_deal}.yml).
//               getProducts CSV columns and the couponDeals CSV columns used
//               below come verbatim from those recordings.
//
// Affiliate link format — VERIFIED (real-world tracking links + recordings):
//   Product deep link (we build it ourselves — the API's Link column comes
//   back with an empty userID when credentials are absent):
//     https://www.shareasale.com/m-pr.cfm?merchantID={m}&userID={affiliateId}&productID={p}
//   Generic click link (for reference):
//     https://www.shareasale.com/r.cfm?b={bannerId}&u={affiliateId}&m={merchantId}&urllink={urlencoded}
//
// Datafeed format — VERIFIED (multiple affiliate sources):
//   Pipe-delimited, first row headers:
//   ProductID|Name|MerchantID|Merchant|Link|Thumbnail|BigImage|Price|RetailPrice|
//   Category|SubCategory|Description|Custom1..5|LastUpdated|status|manufacturer|
//   partnumber|merchantCategory|merchantSubcategory|shortDescription|ISBN|UPC
//
// RATE LIMITS / TERMS (in-code compliance notes):
//   - ShareASale's affiliate API is a reporting/product API, NOT a scraper
//     substitute — this adapter only calls the licensed API and dashboard
//     datafeed downloads. Never scrape merchant sites (account termination
//     risk, same as Amazon's Operating Agreement).
//   - Exact published API rate limits could not be verified (docs are behind
//     login). The adapter paces API calls ~1.5s apart (REQUEST_GAP_MS),
//     caps calls per run (MAX_API_CALLS), and caps deals per run
//     (SHAREASALE_MAX_DEALS, default 500). If ShareASale throttles you,
//     lower the caps / run the job less often. The scheduled ingest already
//     runs at most a few times per day via GitHub Actions.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.shareasale.com";
const API_PATH = "/x.cfm";
const API_VERSION = process.env.SHAREASALE_API_VERSION || "2.3"; // verified in recorded traffic
const REQUEST_GAP_MS = 1500; // conservative pacing between API calls
const MAX_API_CALLS = 25; // hard cap on API calls per fetchDeals() run
const MAX_DEALS = Math.max(
  1,
  parseInt(process.env.SHAREASALE_MAX_DEALS || "500", 10) || 500
);
const FEED_LIMIT = Math.max(
  100,
  parseInt(process.env.SHAREASALE_FEED_LIMIT || "3000", 10) || 3000
);
// Only ingest feed rows that are actually discounted (RetailPrice > Price)?
// Default true — a full merchant catalog is mostly non-deals; the ingest
// pipeline can still catch price drops on what we ingest, but bounding the
// first runs keeps the moderation queue human-scale.
const FEED_DISCOUNT_ONLY = process.env.SHAREASALE_FEED_DISCOUNT_ONLY !== "false";
// Coupon deals carry no pricing, so they cannot become RawDeals under the
// current schema (salePrice is required). The fetcher + normalizer are
// implemented and unit-tested; flip this to include them once a coupon's
// price can be determined (price-less rows are skipped with a log line).
const INCLUDE_COUPONS = process.env.SHAREASALE_INCLUDE_COUPONS === "true";

type Creds = { affiliateId: string; token: string; secret: string };

function creds(): Creds | null {
  const affiliateId = (process.env.SHAREASALE_AFFILIATE_ID || "").trim();
  const token = (process.env.SHAREASALE_API_TOKEN || "").trim();
  const secret = (process.env.SHAREASALE_API_SECRET || "").trim();
  if (!affiliateId || !token || !secret) return null;
  return { affiliateId, token, secret };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Thu, 02 Oct 2026 23:50:00 GMT" — matches ShareASale's expected format. */
function utcDateHeader(d = new Date()): string {
  return d.toUTCString();
}

/**
 * Build the two auth headers for an API call. Exported for unit tests.
 * Signature = UPPERCASE_HEX(SHA256("{token}:{date}:{action}:{secret}")).
 */
export function buildAuthHeaders(
  token: string,
  secret: string,
  action: string,
  dateStr = utcDateHeader()
): Record<string, string> {
  const sigBase = `${token}:${dateStr}:${action}:${secret}`;
  const sig = createHash("sha256").update(sigBase).digest("hex").toUpperCase();
  return {
    "x-ShareASale-Date": dateStr,
    "x-ShareASale-Authentication": sig,
  };
}

const num = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const httpUrl = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

/** Parse mm/dd/yyyy or yyyy-mm-dd into a Date (coupon Start/End dates). */
function parseApiDate(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // mm/dd/yyyy
  if (m) {
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    return isNaN(d.getTime()) ? undefined : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // yyyy-mm-dd
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/**
 * Build our affiliate-tagged product deep link.
 * Format verified against real ShareASale API traffic:
 *   https://www.shareasale.com/m-pr.cfm?merchantID={m}&userID={u}&productID={p}
 */
export function buildProductLink(
  affiliateId: string,
  merchantId: string,
  productId: string
): string {
  const q = new URLSearchParams({
    merchantID: merchantId,
    userID: affiliateId,
    productID: productId,
  });
  return `https://www.shareasale.com/m-pr.cfm?${q.toString()}`;
}

/** Map ShareASale category text onto our 12 categories by keyword. */
export function mapCategory(raw: string | undefined, title: string): string {
  const hay = `${raw ?? ""} ${title}`.toLowerCase();
  const rules: [string, string[]][] = [
    ["Electronics", ["electronic", "tv", "television", "laptop", "headphone", "earbud", "audio", "camera", "phone", "computer", "tablet", "smart home", "wearable", "speaker", "monitor", "keyboard"]],
    ["Gaming", ["gaming", "video game", "console", "xbox", "playstation", "nintendo", "pc gaming"]],
    ["Fashion", ["fashion", "apparel", "clothing", "shoe", "sneaker", "dress", "denim", "handbag", "watch", "jewelry", "accessories", "footwear"]],
    ["Home", ["furniture", "home", "kitchen", "bedding", "decor", "appliance", "mattress", "cookware", "bath"]],
    ["Grocery", ["grocery", "food", "beverage", "snack", "coffee", "tea"]],
    ["Health", ["health", "beauty", "skincare", "vitamin", "supplement", "personal care", "cosmetic"]],
    ["Sports", ["sport", "fitness", "outdoor", "camping", "exercise", "bike", "yoga", "golf", "running"]],
    ["Pets", ["pet", "dog", "cat"]],
    ["Kids", ["kid", "baby", "toy", "children", "toddler"]],
    ["Tools", ["tool", "hardware", "drill", "saw"]],
    ["Travel", ["travel", "luggage", "hotel", "flight", "backpack"]],
  ];
  for (const [cat, kws] of rules) {
    if (kws.some((k) => hay.includes(k))) return cat;
  }
  return isCategory(raw ?? "") ? (raw as string) : "Other";
}

function categoryText(row: Record<string, string>): string {
  return [
    row["Category"],
    row["Sub Category"],
    row["Merchant Category"],
    row["Merchant Sub Category"],
  ]
    .filter(Boolean)
    .join(" ");
}

// ── Mode A: Affiliate API ─────────────────────────────────────────────

/** Parse a CSV API response into header→value rows. */
function parseCsvResponse(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0], ",");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i], ",");
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** One authenticated API call. Throws on transport or auth ("Invalid Request") errors. */
async function apiCall(
  c: Creds,
  action: string,
  params: Record<string, string> = {}
): Promise<Record<string, string>[]> {
  const q = new URLSearchParams({
    version: API_VERSION,
    action,
    affiliateId: c.affiliateId,
    token: c.token,
    format: "csv",
    ...params,
  });
  const url = `${API_BASE}${API_PATH}?${q.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: buildAuthHeaders(c.token, c.secret, action) });
  } catch (err) {
    throw new Error(
      `[shareasale] ${action}: network error — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`[shareasale] ${action}: HTTP ${res.status}`);
  // The API returns 200 OK with an "Invalid Request" body on auth failures.
  if (/^\s*Invalid Request/i.test(text)) {
    throw new Error(
      `[shareasale] ${action}: "Invalid Request" — check SHAREASALE_AFFILIATE_ID / ` +
        `SHAREASALE_API_TOKEN / SHAREASALE_API_SECRET and server clock (signature includes the current time).`
    );
  }
  return parseCsvResponse(text);
}

/**
 * Normalize one getProducts CSV row → RawDeal.
 * Column names verbatim from recorded API traffic.
 */
export function normalizeProductRow(
  row: Record<string, string>,
  affiliateId: string
): RawDeal | null {
  const productId = str(row["productId"]);
  const title = str(row["Name"]);
  const merchantId = str(row["Merchant Id"]);
  const price = num(row["Price"]);
  if (!productId || !title || !merchantId || !price) return null;

  // Skip anything not purchasable right now.
  const status = str(row["Status"]);
  if (status && !/in\s*stock/i.test(status)) return null;

  const org = str(row["Organization"]);
  return {
    externalId: `shareasale-${merchantId}-${productId}`,
    title: title.slice(0, 200),
    description: str(row["Description"] ?? row["Short Description"])?.slice(0, 3000),
    salePrice: price,
    originalPrice: num(row["Retail Price"]),
    affiliateUrl: buildProductLink(affiliateId, merchantId, productId),
    imageUrl: httpUrl(row["Big Image"]) ?? httpUrl(row["Thumbnail"]),
    category: mapCategory(categoryText(row), title),
    storeName: (org ?? `ShareASale merchant ${merchantId}`).slice(0, 100),
    affiliateNetwork: "ShareASale",
    gtin: str(row["UPC"]) ?? str(row["ISBN"]),
    mpn: str(row["Part Number"]),
  };
}

/**
 * Normalize one couponDeals CSV row → RawDeal.
 * Column names verbatim from recorded API traffic:
 *   Deal Id, Merchant Id, Merchant, Start Date, End Date, Publish Date, Title,
 *   BigImage, Tracking URL, SmallImage, Category, Description, Restrictions,
 *   Keywords, Coupon Code, Edit Date, Store Id
 * NOTE: coupon deals carry no price, so they cannot satisfy RawDeal's
 * required salePrice — rows are skipped (logged) until pricing is available.
 */
export function normalizeCouponRow(row: Record<string, string>): RawDeal | null {
  const dealId = str(row["Deal Id"]);
  const title = str(row["Title"]);
  const trackingUrl = httpUrl(row["Tracking URL"]);
  const merchant = str(row["Merchant"]);
  const merchantId = str(row["Merchant Id"]);
  if (!dealId || !title || !trackingUrl) return null;

  const endDate = parseApiDate(row["End Date"]);
  if (endDate && endDate.getTime() < Date.now()) return null; // expired

  // No price columns exist on coupon deals — cannot become a RawDeal yet.
  return null;

  // When pricing becomes available, the mapping is:
  // {
  //   externalId: `shareasale-coupon-${dealId}`,
  //   title: title.slice(0, 200),
  //   description: str(row["Description"])?.slice(0, 3000),
  //   salePrice: <price>,
  //   couponCode: str(row["Coupon Code"])?.slice(0, 60),
  //   affiliateUrl: trackingUrl, // pre-tagged to your account — use as-is
  //   imageUrl: httpUrl(row["BigImage"]) ?? httpUrl(row["SmallImage"]),
  //   category: mapCategory(str(row["Category"]), title),
  //   storeName: (merchant ?? `ShareASale merchant ${merchantId}`).slice(0, 100),
  //   affiliateNetwork: "ShareASale",
  //   expiresAt: endDate,
  // }
}

// ── Mode B: per-merchant datafeed CSVs ─────────────────────────────────

/**
 * Normalize one pipe-delimited datafeed row → RawDeal.
 * Column names match ShareASale's affiliate datafeed download format.
 * We build the affiliate-tagged m-pr.cfm link ourselves (the feed's Link
 * column is the plain merchant product URL).
 */
export function normalizeFeedRow(
  row: Record<string, string>,
  affiliateId: string
): RawDeal | null {
  const productId = str(row["ProductID"]);
  const title = str(row["Name"]);
  const merchantId = str(row["MerchantID"]);
  const price = num(row["Price"]);
  if (!productId || !title || !merchantId || !price) return null;

  const status = str(row["status"]);
  if (status && !/in\s*stock/i.test(status)) return null;

  const retail = num(row["RetailPrice"]);
  if (FEED_DISCOUNT_ONLY && !(retail && retail > price)) return null;

  const merchant = str(row["Merchant"]);
  return {
    externalId: `shareasale-${merchantId}-${productId}`,
    title: title.slice(0, 200),
    description:
      str(row["Description"])?.slice(0, 3000) ?? str(row["shortDescription"])?.slice(0, 3000),
    salePrice: price,
    originalPrice: retail,
    affiliateUrl: buildProductLink(affiliateId, merchantId, productId),
    imageUrl: httpUrl(row["BigImage"]) ?? httpUrl(row["Thumbnail"]),
    category: mapCategory(categoryText(row), title),
    storeName: (merchant ?? `ShareASale merchant ${merchantId}`).slice(0, 100),
    affiliateNetwork: "ShareASale",
    gtin: str(row["UPC"]) ?? str(row["ISBN"]),
    mpn: str(row["partnumber"]),
  };
}

async function fetchDatafeed(
  url: string,
  affiliateId: string,
  push: (d: RawDeal | null) => boolean
): Promise<{ rows: number; kept: number }> {
  let rows = 0;
  let kept = 0;
  for await (const row of streamFeedRows(
    { url },
    {
      delimiter: "|",
      limit: FEED_LIMIT,
      // Cheap pre-filter before mapping: purchasable + (optionally) discounted.
      rowFilter: (r) => {
        const st = (r["status"] || "").toLowerCase();
        if (st && !/in\s*stock/.test(st)) return false;
        const p = parseFloat((r["Price"] || "").replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(p) || p <= 0) return false;
        if (FEED_DISCOUNT_ONLY) {
          const rp = parseFloat((r["RetailPrice"] || "").replace(/[^0-9.]/g, ""));
          if (!(Number.isFinite(rp) && rp > p)) return false;
        }
        return true;
      },
    }
  )) {
    rows++;
    if (push(normalizeFeedRow(row, affiliateId))) kept++;
  }
  return { rows, kept };
}

// ── Adapter ─────────────────────────────────────────────────────────────

function csvList(env: string | undefined): string[] {
  return (env || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export class ShareASaleAdapter implements AffiliateAdapter {
  name = "shareasale";

  async fetchDeals(): Promise<RawDeal[]> {
    const c = creds();
    if (!c) {
      // Graceful no-op: warn loudly in logs, ingest nothing. The job runner
      // records found=0 rather than failing the whole pipeline.
      console.warn(
        "[shareasale] SHAREASALE_AFFILIATE_ID / SHAREASALE_API_TOKEN / " +
          "SHAREASALE_API_SECRET not set — skipping. Set them in .env to enable " +
          "the ShareASale feed (see README → Datafeeds)."
      );
      return [];
    }

    const deals: RawDeal[] = [];
    const seen = new Set<string>();
    const push = (d: RawDeal | null): boolean => {
      if (!d) return false;
      if (seen.has(d.externalId)) return false; // in-batch dedupe on merchant+externalId
      seen.add(d.externalId);
      if (deals.length >= MAX_DEALS) return false;
      deals.push(d);
      return true;
    };

    // ── Mode B: datafeed CSVs (bulk, no per-product API calls) ──
    const feedUrls = csvList(process.env.SHAREASALE_DATAFEED_URLS);
    for (const url of feedUrls) {
      try {
        const { rows, kept } = await fetchDatafeed(url, c.affiliateId, push);
        console.log(`[shareasale] Datafeed ${url}: ${rows} rows scanned, ${kept} deals kept.`);
      } catch (err) {
        // One bad feed must not kill the whole run.
        console.error(
          `[shareasale] Datafeed failed (${url}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // ── Mode A: Affiliate API ──
    const merchantIds = csvList(process.env.SHAREASALE_MERCHANT_IDS);
    const keywords = csvList(process.env.SHAREASALE_KEYWORDS);
    if (keywords.length === 0) keywords.push("sale"); // sensible default
    let apiCalls = 0;

    try {
      // getProducts requires a keyword; scope per merchant when configured.
      const scopes = merchantIds.length > 0 ? merchantIds : [""];
      for (const mid of scopes) {
        for (const kw of keywords) {
          if (apiCalls >= MAX_API_CALLS) break;
          const params: Record<string, string> = { keyword: kw };
          if (mid) params.merchantId = mid;
          try {
            const rows = await apiCall(c, "getProducts", params);
            let kept = 0;
            for (const r of rows) {
              if (push(normalizeProductRow(r, c.affiliateId))) kept++;
            }
            console.log(
              `[shareasale] getProducts keyword="${kw}"${mid ? ` merchant=${mid}` : ""}: ` +
                `${rows.length} rows, ${kept} deals kept.`
            );
          } catch (err) {
            // Auth-level failures must fail loudly (bad credentials / clock
            // skew) — re-throw so the job runner logs the failure instead of
            // silently ingesting nothing. Transient errors just skip this call.
            if (err instanceof Error && /Invalid Request/.test(err.message)) throw err;
            console.error(
              `[shareasale] getProducts failed (keyword="${kw}"${mid ? ` merchant=${mid}` : ""}): ` +
                `${err instanceof Error ? err.message : String(err)}`
            );
          }
          apiCalls++;
          if (apiCalls < MAX_API_CALLS) await sleep(REQUEST_GAP_MS); // pacing
        }
        if (apiCalls >= MAX_API_CALLS) break;
      }
      if (apiCalls >= MAX_API_CALLS) {
        console.warn(
          `[shareasale] Hit MAX_API_CALLS (${MAX_API_CALLS}) — remaining merchants/keywords skipped. ` +
            "Narrow SHAREASALE_MERCHANT_IDS / SHAREASALE_KEYWORDS if you need full coverage."
        );
      }

      // couponDeals: current coupons (opt-in; price-less rows are skipped).
      if (INCLUDE_COUPONS) {
        const couponScopes = merchantIds.length > 0 ? merchantIds : [""];
        for (const mid of couponScopes) {
          if (apiCalls >= MAX_API_CALLS) break;
          const params: Record<string, string> = { current: "1" };
          if (mid) params.merchantId = mid;
          try {
            const rows = await apiCall(c, "couponDeals", params);
            let skipped = 0;
            for (const r of rows) {
              const d = normalizeCouponRow(r);
              if (d) push(d);
              else skipped++;
            }
            console.log(
              `[shareasale] couponDeals${mid ? ` merchant=${mid}` : ""}: ${rows.length} rows, ` +
                `${skipped} skipped (no pricing — coupons can't become deals under the current schema).`
            );
          } catch (err) {
            if (err instanceof Error && /Invalid Request/.test(err.message)) throw err;
            console.error(
              `[shareasale] couponDeals failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
          apiCalls++;
          if (apiCalls < MAX_API_CALLS) await sleep(REQUEST_GAP_MS);
        }
      }
    } catch (err) {
      // Auth-level failures ("Invalid Request") surface here — fail loudly so
      // the user fixes credentials instead of silently ingesting nothing.
      throw err;
    }

    console.log(`[shareasale] Normalized ${deals.length} deals total.`);
    return deals;
  }
}
