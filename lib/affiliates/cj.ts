import type { AffiliateAdapter, RawDeal } from "./types";
import { mapCategory } from "./category-map";

// ─────────────────────────────────────────────────────────────────────────────
// CJ Affiliate (Commission Junction) — Product Catalog Search API.
//
// API contract — VERIFIED (not guessed):
//   Endpoint:   GET https://product-search.api.cj.com/v2/product-search
//   Auth:       Authorization: Bearer <personal-access-token>
//               (Personal Access Tokens — current/recommended. Created at
//               https://developers.cj.com → Account → Personal Access Tokens.
//               Legacy "developer keys" are deprecated and do NOT work with
//               current APIs.)
//   Params:     website-id      REQUIRED — your Website ID / PID
//                                 (CJ account → Account → Web Site Settings)
//               advertiser-ids  "joined" (default), "notjoined", or a
//                                 comma-separated list of advertiser CIDs
//               keywords        free-text product search (we default to "sale")
//               records-per-page  (default 100; we request 100)
//               page-number     1-based pagination
//               currency        e.g. USD
//               publisher-id    OPTIONAL — your publisher CID, sent only when
//                                 CJ_CID is set (some accounts require it)
//   Response:   XML: <cj-api><products total-matched records-returned
//               page-number><product>…</product></products></cj-api>
//               Per product: ad-id, advertiser-id, advertiser-name, buy-url,
//               click-url (PRE-TAGGED affiliate tracking link — we use it
//               as-is; CJ uses per-advertiser tracking domains like
//               www.tkqlhce.com/click-<pid>-<adid>-…), description, image-url,
//               in-stock (true/false), isbn, manufacturer-name,
//               manufacturer-sku, name, price>amount, retail-price>amount,
//               sale-price>amount, sku, upc.
//   Errors:     non-2xx HTTP, or a 200 body containing <error-message>….
//               We detect both and throw loudly (bad token / bad params must
//               surface in job logs, not silently ingest nothing).
//   Source:     contract cross-checked against (a) the official CJ developer
//               docs as scraped 2026-03-10
//               (github.com/finedesignz/cj-mcp-server/CJ_API_REFERENCE.md,
//               "Product Feed" + "Authentication" sections), (b) CJ's
//               long-standing REST product-search parameter/field names as
//               recalled independently in the task brief, and (c) a
//               community PHP SDK tested with real CJ credentials
//               (github.com/luizsilva-dev/cj-sdk-php), which confirms:
//               Bearer PAT auth, website-id as the required identifier,
//               and that the GraphQL ads.api.cj.com product endpoint does
//               NOT exist — REST v2 product-search is the working path.
//
// RATE LIMITS / TERMS (in-code compliance notes):
//   - This adapter only calls CJ's licensed publisher API. Never scrape
//     merchant sites (account termination risk, same as Amazon's Operating
//     Agreement and ShareASale's terms).
//   - Exact published product-search rate limits could not be verified
//     (docs behind login). The adapter paces calls ~1.5s apart
//     (REQUEST_GAP_MS), caps calls per run (MAX_API_CALLS), and caps deals
//     per run (CJ_MAX_DEALS, default 500). If CJ throttles you, lower the
//     caps / run the job less often. The scheduled ingest already runs at
//     most a few times per day via GitHub Actions.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://product-search.api.cj.com";
const API_PATH = "/v2/product-search";
const REQUEST_GAP_MS = 1500; // conservative pacing between API calls
const MAX_API_CALLS = 10; // hard cap on API calls per fetchDeals() run
// Page size we request (CJ allows up to 100). Env-tunable; clamped to 1–100.
const RECORDS_PER_PAGE = Math.max(
  1,
  Math.min(100, parseInt(process.env.CJ_RECORDS_PER_PAGE || "100", 10) || 100)
);
const MAX_DEALS = Math.max(
  1,
  parseInt(process.env.CJ_MAX_DEALS || "500", 10) || 500
);

type Creds = {
  token: string;
  websiteId: string;
  cid?: string;
  advertiserIds: string; // "joined" | "notjoined" | "id1,id2"
  keywords: string[];
};

function creds(): Creds | null {
  const token = (process.env.CJ_API_TOKEN || "").trim();
  const websiteId = (process.env.CJ_WEBSITE_ID || "").trim();
  if (!token || !websiteId) return null;
  const cid = (process.env.CJ_CID || "").trim() || undefined;
  const advertiserIds =
    (process.env.CJ_ADVERTISER_IDS || "").trim() || "joined";
  const keywords = (process.env.CJ_KEYWORDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (keywords.length === 0) keywords.push("sale"); // sensible default
  return { token, websiteId, cid, advertiserIds, keywords };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ── Dependency-free XML field extraction ─────────────────────────────────
// The product-search API returns XML; we extract known flat fields with
// targeted regexes (no new npm dependencies allowed). CDATA wrappers and
// the common XML entities are unwrapped/decoded.

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Extract <name>…</name> text from an XML block (case-insensitive). */
export function xmlField(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return undefined;
  const v = decodeEntities(unwrapCdata(m[1])).trim();
  return v || undefined;
}

/** Extract <name><amount>…</amount></name> as a positive number. */
export function xmlAmount(block: string, name: string): number | undefined {
  const m = block.match(
    new RegExp(`<${name}>\\s*<amount>([\\s\\S]*?)</amount>`, "i")
  );
  return m ? num(m[1]) : undefined;
}

/** Split a <products>…</products> body into individual <product> blocks. */
export function splitProducts(xml: string): string[] {
  const blocks: string[] = [];
  const re = /<product>([\s\S]*?)<\/product>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) blocks.push(m[1]);
  return blocks;
}

/** Pagination attributes from <products total-matched="…" records-returned="…" page-number="…">. */
export function productsMeta(xml: string): {
  totalMatched: number;
  recordsReturned: number;
  pageNumber: number;
} {
  const m = xml.match(/<products\b([^>]*)>/i);
  const attrs = m ? m[1] : "";
  const get = (n: string) => {
    const mm = attrs.match(new RegExp(`${n}\\s*=\\s*"([^"]*)"`, "i"));
    return mm ? parseInt(mm[1], 10) : 0;
  };
  return {
    totalMatched: get("total-matched") || 0,
    recordsReturned: get("records-returned") || 0,
    pageNumber: get("page-number") || 0,
  };
}

// ── API call ──────────────────────────────────────────────────────────────

/**
 * One product-search API call. Returns the raw XML body.
 * Throws on transport errors, non-2xx HTTP, or an <error-message> body.
 */
export async function cjProductSearch(
  c: Creds,
  params: Record<string, string>
): Promise<string> {
  const q = new URLSearchParams({
    "website-id": c.websiteId,
    "advertiser-ids": c.advertiserIds,
    "records-per-page": String(RECORDS_PER_PAGE),
    currency: "USD",
    ...params,
  });
  if (c.cid) q.set("publisher-id", c.cid);
  const url = `${API_BASE}${API_PATH}?${q.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${c.token}` },
    });
  } catch (err) {
    throw new Error(
      `[cj] product-search: network error — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    const errMsg = xmlField(text, "error-message");
    throw new Error(
      `[cj] product-search: HTTP ${res.status}${errMsg ? ` — ${errMsg}` : ""}. ` +
        "Check CJ_API_TOKEN (Personal Access Token) and CJ_WEBSITE_ID."
    );
  }
  const errMsg = xmlField(text, "error-message");
  if (errMsg) {
    throw new Error(
      `[cj] product-search: API error — ${errMsg}. ` +
        "Check CJ_API_TOKEN and CJ_WEBSITE_ID."
    );
  }
  return text;
}

// ── Normalization ─────────────────────────────────────────────────────────

/**
 * Normalize one <product> XML block → RawDeal (or null to skip).
 *
 * Price semantics (CJ feed): <price> = current price, <sale-price> = the
 * discounted price when on sale, <retail-price> = MSRP/list.
 * salePrice = sale-price ?? price. originalPrice = the higher "was" price.
 */
export function normalizeProduct(block: string): RawDeal | null {
  const adId = xmlField(block, "ad-id");
  const advertiserId = xmlField(block, "advertiser-id");
  const title = xmlField(block, "name");
  if (!adId || !advertiserId || !title) return null;

  // Skip anything explicitly out of stock. Absent field → keep (can't verify).
  const inStock = xmlField(block, "in-stock");
  if (inStock && !/^true$/i.test(inStock)) return null;

  const price = xmlAmount(block, "price");
  const salePriceAmt = xmlAmount(block, "sale-price");
  const retailPriceAmt = xmlAmount(block, "retail-price");
  const current = salePriceAmt ?? price;
  if (!current) return null;

  // click-url is the PRE-TAGGED affiliate tracking link (per-advertiser CJ
  // domain, e.g. https://www.tkqlhce.com/click-<pid>-<adid>-…). Use as-is.
  // Without it the click earns nothing, so the product is skipped.
  const clickUrl = httpUrl(xmlField(block, "click-url"));
  if (!clickUrl) return null;

  const was =
    retailPriceAmt && retailPriceAmt > current
      ? retailPriceAmt
      : salePriceAmt && price && price > current
        ? price
        : undefined;

  const description = xmlField(block, "description");
  const advertiserName = xmlField(block, "advertiser-name");
  return {
    externalId: `cj-${advertiserId}-${adId}`,
    title: title.slice(0, 200),
    description: description?.slice(0, 3000),
    salePrice: current,
    originalPrice: was,
    affiliateUrl: clickUrl,
    imageUrl: httpUrl(xmlField(block, "image-url")),
    category: mapCategory(undefined, `${title} ${description ?? ""}`),
    storeName: (advertiserName ?? `CJ advertiser ${advertiserId}`).slice(0, 100),
    affiliateNetwork: "CJ Affiliate",
    gtin: xmlField(block, "upc") ?? xmlField(block, "isbn"),
    mpn: xmlField(block, "manufacturer-sku") ?? xmlField(block, "sku"),
  };
}

// ── Adapter ───────────────────────────────────────────────────────────────

export class CJAdapter implements AffiliateAdapter {
  name = "cj";

  async fetchDeals(): Promise<RawDeal[]> {
    const c = creds();
    if (!c) {
      // Graceful no-op: warn loudly in logs, ingest nothing. The job runner
      // records found=0 rather than failing the whole pipeline.
      console.warn(
        "[cj] CJ_API_TOKEN / CJ_WEBSITE_ID not set — skipping. Set them in .env " +
          "to enable the CJ Affiliate feed (see README → CJ Affiliate). " +
          "Token: developers.cj.com → Account → Personal Access Tokens. " +
          "Website ID: CJ account → Account → Web Site Settings."
      );
      return [];
    }

    const deals: RawDeal[] = [];
    const seen = new Set<string>();
    const push = (d: RawDeal | null): boolean => {
      if (!d) return false;
      if (seen.has(d.externalId)) return false; // in-batch dedupe on advertiser+ad id
      seen.add(d.externalId);
      if (deals.length >= MAX_DEALS) return false;
      deals.push(d);
      return true;
    };

    let apiCalls = 0;
    try {
      for (const kw of c.keywords) {
        // Paginate through this keyword's results.
        for (let page = 1; ; page++) {
          if (apiCalls >= MAX_API_CALLS) break;
          let xml: string;
          try {
            xml = await cjProductSearch(c, {
              keywords: kw,
              "page-number": String(page),
            });
          } catch (err) {
            // Auth/param failures must fail loudly — re-throw so the job
            // runner logs the failure instead of silently ingesting nothing.
            // (All cjProductSearch errors are auth/param/transport level.)
            throw err;
          }
          apiCalls++;

          const blocks = splitProducts(xml);
          let kept = 0;
          for (const b of blocks) {
            if (push(normalizeProduct(b))) kept++;
          }
          const meta = productsMeta(xml);
          console.log(
            `[cj] keywords="${kw}" page=${page}: ${blocks.length} products, ` +
              `${kept} deals kept (total-matched=${meta.totalMatched}).`
          );

          // Stop paginating: short page, nothing returned, or deal cap hit.
          if (blocks.length < RECORDS_PER_PAGE) break;
          if (deals.length >= MAX_DEALS) break;

          if (apiCalls < MAX_API_CALLS) await sleep(REQUEST_GAP_MS); // pacing
        }
        if (apiCalls >= MAX_API_CALLS || deals.length >= MAX_DEALS) break;
      }
      if (apiCalls >= MAX_API_CALLS) {
        console.warn(
          `[cj] Hit MAX_API_CALLS (${MAX_API_CALLS}) — remaining keywords/pages skipped. ` +
            "Narrow CJ_KEYWORDS / CJ_ADVERTISER_IDS if you need full coverage."
        );
      }
    } catch (err) {
      // Auth-level failures surface here — fail loudly so the user fixes
      // credentials instead of silently ingesting nothing.
      throw err;
    }

    console.log(`[cj] Normalized ${deals.length} deals total.`);
    return deals;
  }
}
