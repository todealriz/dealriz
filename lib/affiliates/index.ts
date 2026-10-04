import type { AffiliateAdapter } from "./types";
import { MockAdapter } from "./mock";
import { ImpactAdapter } from "./impact";
import { ShareASaleAdapter } from "./shareasale";
import { RakutenAdapter } from "./rakuten";
import { CJAdapter } from "./cj";
// Production adapters are registered here once implemented.
// import { AmazonPaapiAdapter } from "./stubs";

/**
 * Adapter registry. The ingest job runs every adapter in this list.
 *
 * v1 default: MockAdapter only ($0, no credentials, no approvals needed).
 * To go live: implement a stub adapter, add it here, remove MockAdapter.
 *
 * Impact is registered behind ENABLE_IMPACT_FEED="true" so a half-configured
 * account can never silently join the pipeline. With credentials absent the
 * adapter warns and returns [] (see lib/affiliates/impact.ts).
 * ShareASale follows the same pattern behind ENABLE_SHAREASALE_FEED="true"
 * (see lib/affiliates/shareasale.ts).
 * CJ Affiliate follows the same pattern behind ENABLE_CJ_FEED="true"
 * (see lib/affiliates/cj.ts).
 * Rakuten Advertising follows the same pattern behind ENABLE_RAKUTEN_FEED="true"
 * (see lib/affiliates/rakuten.ts).
 */
function buildAdapters(): AffiliateAdapter[] {
  const adapters: AffiliateAdapter[] = [new MockAdapter()];
  if (process.env.ENABLE_IMPACT_FEED === "true") {
    adapters.push(new ImpactAdapter());
  }
  if (process.env.ENABLE_SHAREASALE_FEED === "true") {
    adapters.push(new ShareASaleAdapter());
  }
  if (process.env.ENABLE_CJ_FEED === "true") {
    adapters.push(new CJAdapter());
  }
  if (process.env.ENABLE_RAKUTEN_FEED === "true") {
    adapters.push(new RakutenAdapter());
  }
  return adapters;
}

export const ADAPTERS: AffiliateAdapter[] = buildAdapters();

/**
 * How many adapters are "real" (non-mock)? Used by the admin dashboard to
 * warn when the site is still running on mock data.
 */
export function liveAdapterCount(): number {
  return ADAPTERS.filter((a) => a.name !== "mock").length;
}
