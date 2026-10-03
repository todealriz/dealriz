import type { AffiliateAdapter, RawDeal } from "./types";
import { isCategory } from "../categories";

// ─────────────────────────────────────────────────────────────────────────────
// Impact Radius adapter (Best Buy, Walmart, Target, and 1,000s of other
// merchants run their affiliate programs on Impact — one integration can
// cover several of the user's target merchants).
//
// Env: IMPACT_ACCOUNT_SID, IMPACT_AUTH_TOKEN (HTTP Basic: SID as username,
// AuthToken as password). Optional: IMPACT_CATALOG_ID to pin one catalog,
// ENABLE_IMPACT_FEED="true" to register the adapter (see lib/affiliates/index.ts).
//
// ⚠️  VERIFY BEFORE PRODUCTION — the exact catalog/item endpoints and field
// names below are best-effort from Impact's public docs and MUST be checked
// against https://integrations.impact.com/impact-brand/reference with real
// credentials. The adapter is written to fail loudly (throw) on unexpected
// shapes rather than silently ingest garbage.
//
// Docs: https://integrations.impact.com/impact-brand/reference
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.impact.com/Mediapartners";

function creds(): { sid: string; token: string } | null {
  const sid = process.env.IMPACT_ACCOUNT_SID;
  const token = process.env.IMPACT_AUTH_TOKEN;
  if (!sid || !token) return null;
  return { sid, token };
}

function authHeader(sid: string, token: string): string {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

// TODO(verify): confirm the catalog listing path. Candidates seen in docs:
//   GET /Mediapartners/{AccountSID}/Catalogs
// Check the response envelope — items may sit under `Catalogs`, `Data`, etc.
async function listCatalogs(sid: string, token: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${API_BASE}/${sid}/Catalogs`, {
    headers: { Authorization: authHeader(sid, token), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`[impact] Catalogs request failed: ${res.status}`);
  const json = await res.json();
  // TODO(verify): adjust to the real envelope/field names.
  const list = json.Catalogs ?? json.Data ?? json.catalogs ?? [];
  return (Array.isArray(list) ? list : []).map((c: Record<string, unknown>) => ({
    id: String(c.Id ?? c.id ?? ""),
    name: String(c.Name ?? c.name ?? "catalog"),
  }));
}

// TODO(verify): confirm the item listing path + pagination + field names.
// Candidate: GET /Mediapartners/{AccountSID}/Catalogs/{catalogId}/Items?PageSize=100&Page=1
// Expected fields per item (verify each): unique id, Name/Title, CurrentPrice,
// OriginalPrice/ListPrice, ImageUrl, TrackingLink (pre-tagged to your account),
// Category/Subcategory, UPC/EAN (→ gtin), MPN, StockAvailability.
async function fetchCatalogItems(
  sid: string,
  token: string,
  catalogId: string,
  maxPages = 5
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  for (let page = 1; page <= maxPages; page++) {
    // TODO(verify): exact path and query params.
    const url =
      `${API_BASE}/${sid}/Catalogs/${catalogId}/Items` +
      `?PageSize=100&Page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: authHeader(sid, token), Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`[impact] Items request failed: ${res.status} (catalog ${catalogId})`);
    const json = await res.json();
    // TODO(verify): adjust to the real envelope.
    const batch = json.Items ?? json.Data ?? json.items ?? [];
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * Map an Impact category string onto our 12 categories by keyword.
 * Unknown → "Other" (ingest clamps it anyway).
 */
function mapCategory(raw: string | undefined, title: string): string {
  const hay = `${raw ?? ""} ${title}`.toLowerCase();
  const rules: [string, string[]][] = [
    ["Electronics", ["electronic", "tv", "laptop", "headphone", "audio", "camera", "phone", "computer", "tablet", "smart home", "wearable"]],
    ["Fashion", ["fashion", "apparel", "clothing", "shoe", "sneaker", "dress", "denim", "handbag", "watch", "jewelry"]],
    ["Home", ["furniture", "home", "kitchen", "bedding", "decor", "appliance", "mattress", "cookware"]],
    ["Grocery", ["grocery", "food", "beverage", "snack", "coffee"]],
    ["Health", ["health", "beauty", "skincare", "vitamin", "fitness", "supplement"]],
    ["Sports", ["sport", "fitness", "outdoor", "camping", "exercise", "bike"]],
    ["Gaming", ["gaming", "video game", "console", "xbox", "playstation", "nintendo"]],
    ["Travel", ["travel", "luggage", "hotel", "flight"]],
    ["Pets", ["pet", "dog", "cat"]],
    ["Kids", ["kid", "baby", "toy", "children"]],
    ["Tools", ["tool", "hardware", "drill", "saw"]],
  ];
  for (const [cat, kws] of rules) {
    if (kws.some((k) => hay.includes(k))) return cat;
  }
  return isCategory(raw ?? "") ? (raw as string) : "Other";
}

export class ImpactAdapter implements AffiliateAdapter {
  name = "impact";

  async fetchDeals(): Promise<RawDeal[]> {
    const c = creds();
    if (!c) {
      // Graceful no-op: warn loudly in logs, ingest nothing. The job runner
      // records found=0 rather than failing the whole pipeline.
      console.warn(
        "[impact] IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN not set — skipping. " +
          "Set them in .env to enable the Impact feed."
      );
      return [];
    }

    const catalogs = await listCatalogs(c.sid, c.token);
    if (catalogs.length === 0) {
      console.warn("[impact] No catalogs returned — check API access for this account.");
      return [];
    }
    const pinned = process.env.IMPACT_CATALOG_ID;
    const catalog = (pinned && catalogs.find((x) => x.id === pinned)) || catalogs[0];
    console.log(`[impact] Using catalog "${catalog.name}" (${catalog.id})`);

    const items = await fetchCatalogItems(c.sid, c.token, catalog.id);
    const deals: RawDeal[] = [];

    for (const it of items) {
      // TODO(verify): field names below are best-effort — confirm each against
      // the real API response before trusting this in production.
      const id = str(it.Id ?? it.id ?? it.Sku ?? it.sku);
      const title = str(it.Name ?? it.Title ?? it.name ?? it.title);
      const price = num(it.CurrentPrice ?? it.Price ?? it.price);
      // Impact returns the tracking link pre-tagged to YOUR account — prefer
      // it over constructing URLs. TODO(verify): confirm the field name.
      const url = str(it.TrackingLink ?? it.TrackingURL ?? it.trackingLink ?? it.Url ?? it.url);
      if (!id || !title || !price || !url) continue;

      const listPrice = num(it.OriginalPrice ?? it.ListPrice ?? it.originalPrice);
      // Only real discounts (or explicit sale flags) become deals — the
      // ingest pipeline derives "deal-ness"; we just pass products through.
      // TODO(verify): confirm sale/stock field names.
      const stock = str(it.StockAvailability ?? it.Availability ?? it.stock);
      if (stock && /out of stock|unavailable/i.test(stock)) continue;

      deals.push({
        externalId: `impact-${catalog.id}-${id}`,
        title: title.slice(0, 200),
        description: str(it.Description ?? it.description)?.slice(0, 3000),
        salePrice: price,
        originalPrice: listPrice,
        couponCode: str(it.CouponCode ?? it.couponCode),
        affiliateUrl: url,
        imageUrl: str(it.ImageUrl ?? it.ImageURL ?? it.imageUrl),
        category: mapCategory(str(it.Category ?? it.category), title),
        badge: undefined,
        // TODO(verify): advertiser/merchant field name.
        storeName: str(it.Advertiser ?? it.Merchant ?? it.advertiser) ?? "Impact Merchant",
        affiliateNetwork: "Impact",
        gtin: str(it.UPC ?? it.EAN ?? it.upc ?? it.ean),
        mpn: str(it.MPN ?? it.mpn),
      });
    }

    console.log(`[impact] Normalized ${deals.length} products from ${items.length} catalog items.`);
    return deals;
  }
}
