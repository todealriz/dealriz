import { z } from "zod";
import { CATEGORIES } from "./categories";

// Shared Zod schemas for all API inputs. Every route validates before touching the DB.

// Deal lifecycle status (SQLite has no enums, so this is a validated string).
export const DEAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const dealStatusSchema = z.enum(DEAL_STATUSES);

export const dealFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().optional(),
  minDiscount: z.coerce.number().int().min(0).max(90).optional(),
  // price band keys used by the /deals filter UI
  price: z.enum(["any", "under25", "25-100", "100-500", "500plus"]).optional(),
  sort: z
    .enum(["newest", "discount", "price-asc", "price-desc", "score", "rank"])
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(48).optional(),
});

export type DealFilters = z.infer<typeof dealFiltersSchema>;

export const PRICE_BANDS: Record<
  NonNullable<DealFilters["price"]>,
  { min?: number; max?: number; label: string }
> = {
  any: { label: "Any price" },
  under25: { max: 25, label: "Under $25" },
  "25-100": { min: 25, max: 100, label: "$25 – $100" },
  "100-500": { min: 100, max: 500, label: "$100 – $500" },
  "500plus": { min: 500, label: "$500+" },
};

export const adminDealSubmitSchema = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  salePrice: z.coerce.number().positive().max(1_000_000),
  originalPrice: z.coerce.number().positive().max(1_000_000).optional(),
  affiliateUrl: z.string().url().max(2000),
  storeName: z.string().trim().min(2).max(80),
  category: z.enum(CATEGORIES),
  couponCode: z.string().trim().max(40).optional().or(z.literal("")),
  imageUrl: z.string().url().max(2000).optional().or(z.literal("")),
  badge: z.string().trim().max(20).optional().or(z.literal("")),
  expiresAt: z.string().optional().or(z.literal("")),
});

export const adminDealActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  // Admin ranking override: boostFactor 1.0–2.0 multiplies rankScore;
  // pinnedUntil (ISO datetime) pins the deal above all unpinned deals
  // until it lapses. Omit pinnedUntil (or pass null) to unpin.
  z.object({
    action: z.literal("boost"),
    boostFactor: z.coerce.number().min(1.0).max(2.0),
    pinnedUntil: z.string().datetime({ offset: true }).nullable().optional(),
  }),
]);

export const subscribeSchema = z.object({
  email: z.string().email().max(160),
  keyword: z.string().trim().max(60).optional().or(z.literal("")),
  category: z.string().trim().optional().or(z.literal("")),
});

export const jobTriggerSchema = z.object({
  job: z.enum(["ingest", "score", "expire", "digest", "all", "scheduled"]),
});

// RawDeal shape shared by every affiliate adapter (validated on ingest).
export const rawDealSchema = z.object({
  externalId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  description: z.string().max(3000).optional(),
  salePrice: z.number().positive(),
  originalPrice: z.number().positive().optional(),
  couponCode: z.string().max(60).optional(),
  affiliateUrl: z.string().url(),
  imageUrl: z.string().url().optional(),
  category: z.string(),
  badge: z.string().max(24).optional(),
  storeName: z.string().min(1).max(100),
  storeSlug: z.string().max(100).optional(),
  affiliateNetwork: z.string().max(60).optional(),
  expiresAt: z.coerce.date().optional(),
  // Cross-network dedupe identifiers (optional; e.g. UPC/EAN/ISBN).
  // When present, ingest dedupes across networks on gtin in addition
  // to the per-network externalId.
  gtin: z.string().max(40).optional(),
  mpn: z.string().max(60).optional(),
});
