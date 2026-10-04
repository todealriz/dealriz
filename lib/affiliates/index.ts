import type { AffiliateAdapter } from "./types";
import { MockAdapter } from "./mock";
import { ImpactAdapter } from "./impact";
import { ShareASaleAdapter } from "./shareasale";
// Production adapters are registered here once implemented.
// import { AmazonPaapiAdapter, CJAdapter } from "./stubs";

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
 */
function buildAdapters(): AffiliateAdapter[] {
  const adapters: AffiliateAdapter[] = [new MockAdapter()];
  if (process.env.ENABLE_IMPACT_FEED === "true") {
    adapters.push(new ImpactAdapter());
  }
  if (process.env.ENABLE_SHAREASALE_FEED === "true") {
    adapters.push(new ShareASaleAdapter());
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
