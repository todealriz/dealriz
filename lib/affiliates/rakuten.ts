import type { AffiliateAdapter, RawDeal } from "./types";
import { mapCategory } from "./shareasale"; // shared keyword→category mapping (no side effects)

// ─────────────────────────────────────────────────────────────────────────────
// Rakuten Advertising (LinkShare) affiliate adapter.
//
// Uses the Product Search web service — the publisher API for product-level
// deal discovery.
//
// API contract — VERIFIED (not guessed):
//   Auth (OAuth2 client credentials):
//     POST {tokenUrl}  (default https://api.linksynergy.com/token;
//            override with RAKUTEN_TOKEN_URL — some tenants use
//            api.rakutenmarketing.com/token instead)
//     Headers: Authorization: Basic base64(clientId:clientSecret)
//              Content-Type: application/x-www-form-urlencoded
//              Accept: application/json   ← REQUIRED. Without it the token
//              endpoint returns XML that cannot be parsed as the documented
//              JSON shape.
//     Body:    grant_type=client_credentials&scope={SID}
//              (Rakuten uses the OAuth2 "scope" field as the publisher Site ID
//              — unusual, but verified.)
//     Response JSON: { access_token, token_type: "Bearer", expires_in }
//     Tokens last ~1 hour; we cache in-module and refresh proactively.
//   Product search:
//     GET https://api.linksynergy.com/productsearch/1.0
//     Query: token={access_token}  ← legacy XML endpoints take the token as
//            a QUERY PARAM, not an Authorization header
//            &keyword={kw} &mid={advertiserId} &pagenumber={n} &max={100}
//     Response: XML — <result><TotalMatches/><TotalPages/>
//            <PageNumberRequested/><item>…</item></result>
//     Item elements (verified): mid, merchantname, linkid, createdon, sku,
//            productname, category>primary|secondary, price, saleprice,
//            upccode, description>short|long, keywords, linkurl, imageurl.
//     NOTE: the response carries NO availability/stock field, so out-of-stock
//     filtering is not possible here (documented as a limitation, not faked).
//   Click URL: prefer the API-returned <linkurl> (already tagged to your
//     publisher account). Deterministic fallback format (verified):
//     https://click.linksynergy.com/deeplink?id={SID}&mid={MID}&u={encoded URL}
//     — only usable when we have a destination URL, so items without <linkurl>
//     are skipped.
//   Sources: Rakuten publisher docs (developers.rakutenadvertising.com —
//     reference pages require login) cross-checked against the maintained
//     open-source Meltano tap tap-rakutenadvertising (streams.py/client.py),
//     which implements /productsearch/1.0 with exactly the params and XML
//     shape above, and against a third-party Rakuten adapter's findings doc
//     (token-host variance, Accept: application/json requirement, scope=SID).
//
// ACCESS FRICTION (documented, real):
//   A freshly approved Rakuten publisher account does NOT necessarily have
//   API access — the "API Credentials" tab (Client ID / Client Secret) is
//   hidden until Rakuten's Publisher Solutions team grants the capability
//   (reported turnaround ~3–7 business days). If you cannot find API
//   credentials in the dashboard, contact Publisher Solutions and ask for
//   Web Services / API access. This adapter warns and no-ops until the
//   credentials exist.
//
// RATE LIMITS / TERMS (in-code compliance notes):
//   - Licensed API only — never scrape merchant sites (account termination
//     risk, same as Amazon's Operating Agreement).
//   - Exact published API rate limits could not be verified (docs behind
//     login). The adapter paces calls ~1.5s apart (REQUEST_GAP_MS), caps API
//     calls per run (MAX_API_CALLS), caps pages per keyword (MAX_PAGES) and
//     deals per run (RAKUTEN_MAX_DEALS, default 500). The scheduled ingest
//     already runs at most a few times per day via GitHub Actions.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = (process.env.RAKUTEN_API_BASE || "https://api.linksynergy.com").replace(/\/$/, "");
const TOKEN_URL = process.env.RAKUTEN_TOKEN_URL || `${API_BASE}/token`;
const PRODUCT_SEARCH_PATH = "/productsearch/1.0";
const PAGE_SIZE = 100; // matches the reference tap; Rakuten's documented page size
const REQUEST_GAP_MS = 1500; // conservative pacing between API calls
const MAX_API_CALLS = 25; // hard cap on API calls per fetchDeals() run
const MAX_PAGES = Math.max(1, parseInt(process.env.RAKUTEN_MAX_PAGES || "5", 10) || 5);
const MAX_DEALS = Math.max(1, parseInt(process.env.RAKUTEN_MAX_DEALS || "500", 10) || 500);

type Creds = { clientId: string; clientSecret: string; sid: string };

function creds(): Creds | null {
  const clientId = (process.env.RAKUTEN_CLIENT_ID || "").trim();
  const clientSecret = (process.env.RAKUTEN_CLIENT_SECRET || "").trim();
  const sid = (process.env.RAKUTEN_SID || "").trim();
  if (!clientId || !clientSecret || !sid) return null;
  return { clientId, clientSecret, sid };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── OAuth2 token exchange ─────────────────────────────────────────────

/** In-module token cache (tokens last ~1 hour). Keyed by clientId+sid. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Build the token-exchange request. Exported for unit tests.
 * Verified: Basic auth, scope={SID} body param, Accept: application/json
 * (without it the endpoint returns XML).
 */
export function buildTokenRequest(
  clientId: string,
  clientSecret: string,
  sid: string,
  tokenUrl: string = TOKEN_URL
): { url: string; method: string; headers: Record<string, string>; body: string } {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64");
  return {
    url: tokenUrl,
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(sid)}`,
  };
}

async function getAccessToken(c: Creds): Promise<string> {
  const cacheKey = `${c.clientId}:${c.sid}`;
  const cached = tokenCache.get(cacheKey);
  // Proactive refresh: <5 minutes of life left → fetch a new token now.
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;

  const { url, method, headers, body } = buildTokenRequest(c.clientId, c.clientSecret, c.sid);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (err) {
    throw new Error(
      `[rakuten] token exchange: network error — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `[rakuten] token exchange: HTTP ${res.status} — check RAKUTEN_CLIENT_ID / ` +
        `RAKUTEN_CLIENT_SECRET / RAKUTEN_SID. (If the API Credentials tab is missing ` +
        `from your dashboard, ask Rakuten Publisher Solutions for Web Services access.) ` +
        `Body: ${text.slice(0, 200)}`
    );
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `[rakuten] token exchange: expected JSON but got: ${text.slice(0, 120)} — ` +
        `the endpoint may have ignored our Accept: application/json header.`
    );
  }
  // Documented key is access_token; accept "token" defensively (minor variance).
  const token = typeof data.access_token === "string" ? data.access_token
    : typeof data.token === "string" ? data.token : undefined;
  if (!token) {
    throw new Error(
      `[rakuten] token exchange: no access_token in response: ${text.slice(0, 200)}`
    );
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

// ── Minimal XML parsing (no new dependencies) ─────────────────────────
// Rakuten's productsearch returns XML. We parse just what we need with
// targeted regexes: <item> blocks, then flat fields inside each block
// (category/price/description are shallow-nested and handled by extracting
// the sub-block first). CDATA and entities are decoded.

const ENTITY_MAP: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X"
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITY_MAP[ent] ?? m;
    });
}

/**
 * Extract the text of the first <tag>…</tag> inside an XML block.
 * Exported for unit tests.
 */
export function xmlField(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return undefined;
  const v = decodeEntities(m[1]).trim();
  return v ? v : undefined;
}

/** Extract the raw inner XML of the first <tag>…</tag> (for nested blocks). */
export function xmlBlock(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : undefined;
}

/** Split a productsearch response into its <item> blocks. Exported for tests. */
export function xmlItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

/** Root-level numeric field (TotalMatches / TotalPages / PageNumberRequested). */
function xmlRootInt(xml: string, tag: string): number | undefined {
  // Only look before the first <item> so item-level numbers can't match.
  const head = xml.split(/<item(?:\s[^>]*)?>/i)[0] ?? xml;
  const v = xmlField(head, tag);
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

// ── Normalization ─────────────────────────────────────────────────────

const num = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const httpUrl = (v: string | undefined): string | undefined =>
  v && /^https?:\/\//i.test(v) ? v : undefined;

/**
 * Normalize one <item> block → RawDeal. Exported for unit tests.
 * Element names verified against the maintained tap-rakutenadvertising
 * ProductSearchStream parser (mid, merchantname, linkid, sku, productname,
 * category>primary|secondary, price, saleprice, upccode, description>short|long,
 * linkurl, imageurl).
 */
export function normalizeItem(itemXml: string): RawDeal | null {
  const mid = xmlField(itemXml, "mid");
  const sku = xmlField(itemXml, "sku") ?? xmlField(itemXml, "linkid");
  const title = xmlField(itemXml, "productname");
  const merchant = xmlField(itemXml, "merchantname");
  if (!mid || !sku || !title) return null;

  // price = retail/list, saleprice = current price. Either may be absent.
  const priceBlock = xmlBlock(itemXml, "price");
  const saleBlock = xmlBlock(itemXml, "saleprice");
  // price/saleprice elements may carry attributes (currency) with the number
  // as text content — decodeEntities(trim) of the inner text.
  const priceText = priceBlock !== undefined ? decodeEntities(priceBlock).trim() : xmlField(itemXml, "price");
  const saleText = saleBlock !== undefined ? decodeEntities(saleBlock).trim() : xmlField(itemXml, "saleprice");
  const retail = num(priceText || undefined);
  const sale = num(saleText || undefined);
  const salePrice = sale ?? retail;
  if (!salePrice) return null;

  // Prefer the API-returned click URL (already tagged to your account).
  const affiliateUrl = httpUrl(xmlField(itemXml, "linkurl"));
  if (!affiliateUrl) return null;

  const categoryBlock = xmlBlock(itemXml, "category");
  const categoryText = [
    categoryBlock ? xmlField(categoryBlock, "primary") : undefined,
    categoryBlock ? xmlField(categoryBlock, "secondary") : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const descBlock = xmlBlock(itemXml, "description");
  const description =
    (descBlock ? xmlField(descBlock, "short") ?? xmlField(descBlock, "long") : undefined)?.slice(0, 3000);

  return {
    externalId: `rakuten-${mid}-${sku}`.slice(0, 120),
    title: title.slice(0, 200),
    description,
    salePrice,
    originalPrice: retail && retail > salePrice ? retail : undefined,
    affiliateUrl,
    imageUrl: httpUrl(xmlField(itemXml, "imageurl")),
    category: mapCategory(categoryText, title),
    storeName: (merchant ?? `Rakuten advertiser ${mid}`).slice(0, 100),
    affiliateNetwork: "Rakuten Advertising",
    gtin: xmlField(itemXml, "upccode")?.slice(0, 40),
  };
}

/**
 * Build the deterministic deeplink fallback.
 * Verified format: https://click.linksynergy.com/deeplink?id={SID}&mid={MID}&u={url}
 * Only usable when a destination URL is known — productsearch items without
 * <linkurl> are skipped instead (no destination to deeplink to).
 */
export function buildDeeplink(sid: string, mid: string, destinationUrl: string): string {
  const q = new URLSearchParams({ id: sid, mid, u: destinationUrl });
  return `https://click.linksynergy.com/deeplink?${q.toString()}`;
}

// ── API calls ─────────────────────────────────────────────────────────

interface SearchPage {
  items: string[];
  totalPages: number;
  pageNumber: number;
}

/** One productsearch call. Throws on transport or auth errors. */
async function productSearchPage(
  token: string,
  params: Record<string, string>
): Promise<SearchPage> {
  const q = new URLSearchParams({ token, max: String(PAGE_SIZE), ...params });
  const url = `${API_BASE}${PRODUCT_SEARCH_PATH}?${q.toString()}`;
  let res: Response;
  try {
    // NOTE: legacy XML endpoints take the token as a query param, NOT an
    // Authorization header (verified in the maintained tap-rakutenadvertising).
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `[rakuten] productsearch: network error — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `[rakuten] productsearch: HTTP ${res.status} — the access token may be expired ` +
        `or lack product-search permission. Body: ${text.slice(0, 200)}`
    );
  }
  if (/<\s*(error|fault)/i.test(text.slice(0, 2000))) {
    throw new Error(
      `[rakuten] productsearch: API returned an error document: ${text.slice(0, 300)}`
    );
  }
  const items = xmlItems(text);
  return {
    items,
    totalPages: xmlRootInt(text, "TotalPages") ?? 1,
    pageNumber: xmlRootInt(text, "PageNumberRequested") ?? xmlRootInt(text, "PageNumber") ?? 1,
  };
}

// ── Adapter ─────────────────────────────────────────────────────────────

function csvList(env: string | undefined): string[] {
  return (env || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export class RakutenAdapter implements AffiliateAdapter {
  name = "rakuten";

  async fetchDeals(): Promise<RawDeal[]> {
    const c = creds();
    if (!c) {
      // Graceful no-op: warn loudly in logs, ingest nothing. The job runner
      // records found=0 rather than failing the whole pipeline.
      console.warn(
        "[rakuten] RAKUTEN_CLIENT_ID / RAKUTEN_CLIENT_SECRET / RAKUTEN_SID not set — " +
          "skipping. Get them from the Rakuten publisher dashboard → Account → " +
          "Applications (API Credentials tab; may require Publisher Solutions " +
          "approval first). See README → Rakuten Advertising."
      );
      return [];
    }

    // Fail fast on auth so a bad credential set is loud, not silent.
    const token = await getAccessToken(c);

    const deals: RawDeal[] = [];
    const seen = new Set<string>();
    const push = (d: RawDeal | null): boolean => {
      if (!d) return false;
      if (seen.has(d.externalId)) return false; // in-batch dedupe on mid+sku
      seen.add(d.externalId);
      if (deals.length >= MAX_DEALS) return false;
      deals.push(d);
      return true;
    };

    const advertiserIds = csvList(process.env.RAKUTEN_ADVERTISER_IDS);
    const keywords = csvList(process.env.RAKUTEN_KEYWORDS);
    if (keywords.length === 0) keywords.push("sale"); // sensible default
    const scopes = advertiserIds.length > 0 ? advertiserIds : [""];

    let apiCalls = 0;
    for (const mid of scopes) {
      for (const kw of keywords) {
        let page = 1;
        let totalPages = 1;
        while (page <= totalPages && page <= MAX_PAGES) {
          if (apiCalls >= MAX_API_CALLS) break;
          const params: Record<string, string> = { keyword: kw, pagenumber: String(page) };
          if (mid) params.mid = mid;
          try {
            const { items, totalPages: tp } = await productSearchPage(token, params);
            totalPages = Math.max(1, tp);
            let kept = 0;
            for (const itemXml of items) {
              if (push(normalizeItem(itemXml))) kept++;
            }
            console.log(
              `[rakuten] productsearch keyword="${kw}"${mid ? ` mid=${mid}` : ""} ` +
                `page ${page}/${totalPages}: ${items.length} items, ${kept} deals kept.`
            );
          } catch (err) {
            console.error(
              `[rakuten] productsearch failed (keyword="${kw}"${mid ? ` mid=${mid}` : ""} ` +
                `page ${page}): ${err instanceof Error ? err.message : String(err)}`
            );
            break; // don't hammer further pages after a failure
          }
          apiCalls++;
          page++;
          if (apiCalls < MAX_API_CALLS && page <= totalPages && page <= MAX_PAGES) {
            await sleep(REQUEST_GAP_MS); // pacing
          }
        }
        if (apiCalls >= MAX_API_CALLS) break;
        if (deals.length >= MAX_DEALS) break;
      }
      if (apiCalls >= MAX_API_CALLS || deals.length >= MAX_DEALS) break;
    }
    if (apiCalls >= MAX_API_CALLS) {
      console.warn(
        `[rakuten] Hit MAX_API_CALLS (${MAX_API_CALLS}) — remaining keywords/advertisers skipped. ` +
          "Narrow RAKUTEN_ADVERTISER_IDS / RAKUTEN_KEYWORDS if you need full coverage."
      );
    }

    console.log(`[rakuten] Normalized ${deals.length} deals total.`);
    return deals;
  }
}
