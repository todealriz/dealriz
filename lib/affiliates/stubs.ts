import type { AffiliateAdapter, RawDeal } from "./types";

/**
 * Production affiliate network adapters — STUBS.
 *
 * Each class below documents the exact env vars and official API docs.
 * To go live: implement fetchDeals() per the docs, add your credentials to
 * .env, and register the adapter in lib/affiliates/index.ts.
 *
 * IMPORTANT (applies to all networks):
 *  - Never scrape merchant sites. Use licensed APIs only — scraping violates
 *    most affiliate terms (notably Amazon's Operating Agreement) and will get
 *    your account terminated.
 *  - Amazon Associates: you must generate 3 qualifying sales within 180 days
 *    to keep the account AND to get PA-API access. Until then, use SiteStripe
 *    links pasted via the admin submission form.
 */

function notConfigured(name: string, envVars: string[], docs: string): never {
  throw new Error(
    `[${name}] adapter not implemented. Set ${envVars.join(", ")} and implement ` +
      `fetchDeals() per ${docs}`
  );
}

// ── Amazon Product Advertising API 5.0 ──────────────────────────
// Env: AMAZON_PAAPI_ACCESS_KEY, AMAZON_PAAPI_SECRET_KEY, AMAZON_PAAPI_PARTNER_TAG
// Docs: https://webservices.amazon.com/paapi5/documentation/
// Note: access requires 3 qualifying sales in the last 180 days.
export class AmazonPaapiAdapter implements AffiliateAdapter {
  name = "amazon-paapi";
  async fetchDeals(): Promise<RawDeal[]> {
    return notConfigured(
      this.name,
      ["AMAZON_PAAPI_ACCESS_KEY", "AMAZON_PAAPI_SECRET_KEY", "AMAZON_PAAPI_PARTNER_TAG"],
      "https://webservices.amazon.com/paapi5/documentation/"
    );
  }
}

// ── ShareASale (part of Awin) ───────────────────────────────────
// Env: SHAREASALE_API_TOKEN, SHAREASALE_API_SECRET, SHAREASALE_AFFILIATE_ID
// Docs: https://account.shareasale.com/a-apiManager.cfm (API reference)
// Coupon/deal endpoints: "Deals" and "Coupon Deals" API resources.
export class ShareASaleAdapter implements AffiliateAdapter {
  name = "shareasale";
  async fetchDeals(): Promise<RawDeal[]> {
    return notConfigured(
      this.name,
      ["SHAREASALE_API_TOKEN", "SHAREASALE_API_SECRET", "SHAREASALE_AFFILIATE_ID"],
      "https://account.shareasale.com/a-apiManager.cfm"
    );
  }
}

// ── CJ Affiliate ────────────────────────────────────────────────
// Env: CJ_API_TOKEN (Personal Access Token), CJ_CID (publisher/company id)
// Docs: https://developers.cj.com/ (Product Search / GraphQL API)
export class CJAdapter implements AffiliateAdapter {
  name = "cj";
  async fetchDeals(): Promise<RawDeal[]> {
    return notConfigured(
      this.name,
      ["CJ_API_TOKEN", "CJ_CID"],
      "https://developers.cj.com/"
    );
  }
}

// ── Impact ──────────────────────────────────────────────────────
// Env: IMPACT_ACCOUNT_SID, IMPACT_AUTH_TOKEN
// Docs: https://integrations.impact.com/impact-brand/reference (REST API)
export class ImpactAdapter implements AffiliateAdapter {
  name = "impact";
  async fetchDeals(): Promise<RawDeal[]> {
    return notConfigured(
      this.name,
      ["IMPACT_ACCOUNT_SID", "IMPACT_AUTH_TOKEN"],
      "https://integrations.impact.com/impact-brand/reference"
    );
  }
}
