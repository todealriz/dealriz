import type { z } from "zod";
import type { rawDealSchema } from "../validation";

// A deal exactly as returned by an affiliate network adapter, before
// normalization into our Deal model.
export type RawDeal = z.infer<typeof rawDealSchema>;

// Contract every affiliate source must implement.
//
// HOW TO ADD A REAL NETWORK:
//  1. Create a class implementing AffiliateAdapter in lib/affiliates/.
//  2. Map the network's API response into RawDeal[] (validate each with
//     rawDealSchema in ingest.ts — already done for you).
//  3. Register it in lib/affiliates/index.ts ADAPTERS.
//  4. Add the credentials to .env (see .env.example) — never hardcode keys.
export interface AffiliateAdapter {
  /** Human-readable name, e.g. "amazon-paapi". Also used in job logs. */
  name: string;
  /** Fetch the current deal feed. Throw on auth/network errors so the
   *  job runner can log the failure instead of silently ingesting nothing. */
  fetchDeals(): Promise<RawDeal[]>;
}
