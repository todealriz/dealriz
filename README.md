# DealRiz — AI driven. Deals proven.

A solo-founder-friendly deal aggregation site: curated deals, a transparent
0–100 **DealScore** on every deal, affiliate click tracking, email alerts,
an admin dashboard, and fully automated backend jobs — all on free tiers.

**Stack:** Next.js 14 (App Router) · TypeScript (strict) · Tailwind CSS ·
Prisma (SQLite dev / Postgres prod) · Zod · Resend · GitHub Actions cron.

---

## Quick start (local dev)

```bash
cd dealriz
npm install
cp .env.example .env        # SQLite dev DB works with zero config
npx prisma db push          # create tables in prisma/dev.db
npm run db:seed             # ingest 40 mock deals → auto-approve → score
npm run dev                 # http://localhost:3000
```

Admin dashboard: http://localhost:3000/admin
(In dev with no `ADMIN_API_KEY` set, admin routes are open. In production they
require the key — see below.)

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `prisma generate` + production build (must stay green) |
| `npm start` | Serve the production build |
| `npx prisma db push` | Sync schema to dev DB (no migrations needed for SQLite) |
| `npm run db:seed` | Re-run the mock ingest pipeline (idempotent — dedupes on `externalId`) |
| `npx prisma studio` | Visual DB browser |

---

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Dev: `file:./dev.db`. Prod: Neon Postgres connection string |
| `SITE_URL` | yes | Canonical URL, no trailing slash (sitemap, emails, share links) |
| `ADMIN_API_KEY` | prod | Gate for `/admin` APIs + `/api/jobs/*`. Generate: `openssl rand -hex 32` |
| `AUTO_APPROVE_INGESTED` | no | `true` = new ingested deals go live immediately (default: `false` → moderation queue) |
| `AUTO_APPROVE_MIN_DISCOUNT` | no | Rule-based auto-approve threshold (default `30`): discount% ≥ this + trusted store + image → auto-publish. Price drops always auto-approve |
| `ENABLE_IMPACT_FEED` | no | `true` = register the Impact adapter (needs `IMPACT_*` creds) |
| `IMPACT_CATALOG_ID` | no | Pin one Impact catalog; omit = use the first catalog returned |
| `RESEND_API_KEY` | no | Without it, emails log to console (dev mode) instead of sending |
| `RESEND_FROM_EMAIL` | no | Sender, e.g. `DealRiz <deals@dealriz.com>` |
| `CLICK_SALT` | prod | Salt for the SHA-256 IP hash in click logs |
| `USE_CLAUDE_SCORING` / `ANTHROPIC_API_KEY` | no | Future Claude scoring (stubbed — see below) |
| `NEXT_PUBLIC_ADSENSE_CLIENT_ID` | no | `ca-pub-…` publisher ID — without it, ad slots render placeholders |
| `AMAZON_PAAPI_*`, `SHAREASALE_*`, `CJ_*`, `IMPACT_*` | no | Credentials for real affiliate adapters (see below) |

---

## Deploy (all free tiers — ~$11/yr total for the domain)

1. **Domain:** buy `dealriz.com` at Cloudflare Registrar (~$11/yr), point DNS to Vercel.
2. **Database:** create a free [Neon](https://neon.tech) Postgres project → copy the
   connection string.
3. **GitHub:** push this repo. **Vercel:** Import project → set env vars:
   `DATABASE_URL` (Neon), `SITE_URL=https://dealriz.com`, `ADMIN_API_KEY`,
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CLICK_SALT`.
4. **Schema switch:** Prisma can't drive the provider from env, so for production
   change one line in `prisma/schema.prisma` (`provider = "sqlite"` →
   `"postgresql"`), commit, then in Vercel's build or once locally:
   `prisma migrate deploy` (generate a migration with `prisma migrate dev`
   against Neon first).
5. **Email:** add a [Resend](https://resend.com) API key (3,000 emails/mo free)
   and verify `dealriz.com` as a sending domain.
6. **Seed production:** run the ingest once via the admin UI
   (`/admin` → Jobs → "Ingest affiliate feeds") or curl the trigger endpoint.
7. **Cron:** add GitHub repo secrets `SITE_URL` + `ADMIN_API_KEY` — the workflow
   in `.github/workflows/cron.yml` runs every 6h automatically.

## Cron strategy (why GitHub Actions, not Vercel)

Vercel's Hobby plan only allows **daily** crons; we need 6-hour ingestion.
So `.github/workflows/cron.yml` (free: 2,000 min/mo on private repos, unlimited
on public) POSTs to `/api/jobs/trigger` with `{ "job": "scheduled" }`.

The `scheduled` job is a **smart scheduler** (`lib/jobs.ts`): it always runs
ingest + score, but runs `expire` at most ~daily and the weekly `digest` only
on Mondays — using the `AffiliateJob` table as the last-run watermark, so no
extra state or multiple cron entries are needed. Manual runs are available from
`/admin` → Jobs, or via `workflow_dispatch` in the Actions tab.

---

## How DealScore works (v1)

Deterministic heuristic — **$0, no API calls**. Weights are documented in
`lib/scoring.ts` and every deal stores its component breakdown as JSON
(surfaced in the UI via "How scoring works"):

| Component | Max | Rule |
|---|---|---|
| Base | 20 | every verified deal starts here |
| Discount depth | 40 | `min(discountPct, 80) / 80 × 40` |
| Coupon bonus | 10 | +10 if a coupon code is attached |
| Freshness | 15 | linear decay to 0 over 72h |
| Expiry urgency | 10 | +10 ≤48h left, +5 ≤7 days |
| Price band | 5 | +5 if ≤$100, +2 if ≤$500 |

Scores recompute for unscored or >24h-stale deals on every `score` job run.
**Claude scoring** is stubbed behind `USE_CLAUDE_SCORING=true` +
`ANTHROPIC_API_KEY` (`lib/scoring-claude.ts`, with a suggested prompt) — the
heuristic stays the default so v1 never incurs API costs by accident.

---

## Ranking engine

DealScore answers "is this a good deal?". **RankScore answers "what shows
first?"** — one transparent formula in `lib/ranking.ts` (`computeRankScore`),
used by the homepage grids, the `/deals` default sort, and the admin queue:

| Component | Rule |
|---|---|
| Base | DealScore (0–100) |
| Freshness boost | `+25 × exp(-ageHours/36)` — new deals surface, decays to ~+3 after 72h |
| Discount bonus | `+min(discountPct × 0.3, 15)` — capped so fake "90% off" can't dominate |
| Engagement bonus | `+min(clicks24h, 50) × 0.4` (max +20) — **noise until real traffic exists**; at zero clicks every deal gets +0 |
| Price-drop bonus | `+10` when the price fell >10% vs the 30-day median |
| Penalties | `−10` no image, `−5` no list price |
| Boost multiplier | admin-set `boostFactor` (1.0–2.0) multiplies the total |

**Pins:** a deal with `pinnedUntil` in the future sorts above *all* unpinned
deals. Set via `/admin` → queue → "Apply boost" (boost × + optional pin
datetime). Pins are an explicit human override, not part of the formula.

**Catch of the Day** (`getCatchOfTheDay`) is deterministic per day: highest
(DealScore × freshness) among approved, unexpired, image-bearing deals,
excluding yesterday's pick. The winner's `featuredAt` is stamped so the pick
is stable across ISR revalidations.

**Why commission is excluded:** affiliate commission rates *never* influence
organic ranking — not as a weight, not as a tiebreaker. The rule is written
into `lib/ranking.ts` itself. The brand promise is "we fight for the buyer —
not the seller," and sorting by payout would break it within a month.

**Scaling note:** rank sort scores the freshest 500 matches in memory on
`/deals`. Past a few thousand live deals, persist `rankScore` as a column
refreshed by the score job.

---

## Affiliate adapters — how to go live

Architecture: `AffiliateAdapter` (`lib/affiliates/types.ts`) → `fetchDeals(): Promise<RawDeal[]>`
→ `ingestAdapter()` (`lib/affiliates/ingest.ts`) validates each deal with Zod,
dedupes on `externalId`, upserts the store, and inserts as `PENDING` (human
review in `/admin`) unless `AUTO_APPROVE_INGESTED=true`.

| Adapter | File | Status |
|---|---|---|
| `MockAdapter` | `lib/affiliates/mock.ts` | ✅ live — 40 realistic deals, 12 categories |
| Amazon PA-API 5.0 | `lib/affiliates/stubs.ts` | stub — needs `AMAZON_PAAPI_*` keys + 3 qualifying sales/180d |
| ShareASale | `lib/affiliates/stubs.ts` | stub — needs `SHAREASALE_*` keys |
| CJ Affiliate | `lib/affiliates/stubs.ts` | stub — needs `CJ_API_TOKEN`, `CJ_CID` |
| Impact | `lib/affiliates/impact.ts` | ✅ implemented — needs `IMPACT_*` keys + `ENABLE_IMPACT_FEED=true`; **verify endpoints/fields against the docs before production** |

Each stub names its exact env vars and official API docs link. To add a real
network: implement `fetchDeals()` mapping to `RawDeal`, register it in
`lib/affiliates/index.ts` `ADAPTERS`, remove `MockAdapter`, set env vars.
**Never scrape merchant sites** — use licensed APIs only (Amazon's Operating
Agreement terminates scrapers; the stub file documents this).

**Key pipeline behaviors** (all in `lib/affiliates/ingest.ts`):

- **Deals are derived, not accepted.** A feed row is a product; it becomes a
  deal via discount threshold, price-drop detection, or human approval.
- **Price history:** every ingest records a `PriceSnapshot` per product (on
  price change or >24h since the last). A price **>10% below the 30-day
  median** (≥3 snapshots) sets `isPriceDrop`, auto-publishes the deal
  (bypassing the discount threshold), and adds a rank boost.
- **Dedupe:** per-network on `externalId`, plus cross-network on `gtin`
  (UPC/EAN) when present — the same product via two networks stays one
  listing.
- **Auto-approve:** `AUTO_APPROVE_MIN_DISCOUNT` (default 30) — a new deal
  auto-publishes when discount% ≥ threshold **and** its store is "trusted"
  (it already has ≥1 human-approved deal — new merchants always pass human
  review once) **and** it has an image. `AUTO_APPROVE_INGESTED=true` remains
  the manual override.

**Until approvals land:** paste deals manually via `/admin` → "Submit deal"
(SiteStripe-style affiliate URLs work fine without any API).

---

## Datafeeds

**ShareASale setup (real adapter — `lib/affiliates/shareasale.ts`):**
1. Log in to your ShareASale affiliate dashboard and collect:
   - `SHAREASALE_AFFILIATE_ID` — your affiliate (user) ID, shown at the top of the dashboard; also the `u=` value in any tracking link from Links → "Get a Link/Banner".
   - `SHAREASALE_API_TOKEN` and `SHAREASALE_API_SECRET` — from the API management section of your dashboard (search the dashboard for "API" — exact location may have shifted with the Awin migration).
2. Pick your scope:
   - `SHAREASALE_MERCHANT_IDS` — comma-separated merchant IDs from merchant search (numeric ID in the merchant's profile URL). Optional; empty searches across your joined merchants.
   - `SHAREASALE_KEYWORDS` — comma-separated product-search keywords (default `"sale"`).
   - `SHAREASALE_DATAFEED_URLS` — comma-separated per-merchant product datafeed *download* URLs (dashboard → merchant → Datafeed; the link is personalized to your account). Optional — this is the bulk path, no per-product API calls.
3. Set `ENABLE_SHAREASALE_FEED="true"` in `.env` (Vercel: add all of the above as environment variables).
4. Verify: go to `/admin` → Jobs → run **ingest**, then watch the logs. You should see `[shareasale] getProducts …` / `Datafeed …` lines and `Normalized N deals total.` New merchants land in the moderation queue for one human review; afterwards auto-approve rules apply.

Notes: the API contract (endpoint, signature scheme, `getProducts`/`couponDeals` actions, CSV columns, and the `m-pr.cfm` deep-link format) was verified against real recorded ShareASale API traffic — details in the header of `shareasale.ts`. Affiliate links are built as `https://www.shareasale.com/m-pr.cfm?merchantID={m}&userID={your id}&productID={p}`. The adapter paces API calls (~1.5s), caps calls/deals per run, dedupes in-batch on merchant+product, and warns + ingests nothing when credentials are absent. Coupon deals are fetched only with `SHAREASALE_INCLUDE_COUPONS="true"` and skipped when they carry no pricing (the current schema requires a price).

**Impact setup:** create an account at
[impact.com](https://app.impact.com) → Settings → API for your Account SID
and Auth Token → set `IMPACT_ACCOUNT_SID`, `IMPACT_AUTH_TOKEN`,
`ENABLE_IMPACT_FEED="true"` → run the ingest job from `/admin` → Jobs and
watch the logs. The adapter lists your catalogs and pulls items with
pre-tagged tracking links. **Before trusting it:** the exact catalog/item
endpoints and field names are marked `TODO(verify)` in
`lib/affiliates/impact.ts` — check them against
https://integrations.impact.com/impact-brand/reference with real credentials.

**Generic CSV/TSV feeds** (`lib/affiliates/datafeed.ts`): dependency-free
streaming downloader + parser (never loads the whole file — feeds can be
100MB+). Give it a URL or file path, a delimiter, a column map
(feed headers → uniform fields), and an optional row filter; it returns
normalized rows you map to `RawDeal`. A commented ShareASale-style usage
example is at the bottom of the file — print a few raw rows of your
merchant's feed first and adjust the column map, since headers vary per
merchant.

---

## Bulk deal import (spreadsheet upload)

Tired of one-by-one entry? **Admin → Bulk import tab**: pick a file, hit **Preview**
(dry run — validates everything, shows the first 25 valid rows + per-row errors),
then **Confirm import**. Optional checkbox publishes immediately instead of sending
deals to the moderation queue.

- **Formats:** Excel `.xlsx`/`.xls`, CSV, TSV, TXT (delimiter auto-detected) — **or paste
  a Google Sheets link** (sheet must be shared as "Anyone with the link can view"; imports
  the first sheet, or the tab in the link's `?gid=`). Max **5MB** and **2,000 rows** per upload.
- **Template:** the tab has a "Download template" link (or `GET /api/admin/import/template`).
- **Columns** (headers are case-insensitive; common aliases accepted):

| Column | Required | Aliases |
|---|---|---|
| `title` | ✅ | name, product |
| `salePrice` | ✅ | price, sale price, deal price |
| `affiliateUrl` | ✅ | url, link, affiliate link |
| `storeName` | ✅ | store, merchant, retailer |
| `originalPrice` | – | listPrice, list price, was, msrp, compare at |
| `category` | – | cat (must be one of the 12 site categories, else row errors) |
| `imageUrl` | – | image, img, thumbnail |
| `description` | – | desc, details |
| `couponCode` | – | coupon, promo code, code |
| `badge` | – | tag, label |
| `expiresAt` | – | expires, expiry, end date |
| `externalId` | – | id, sku (used for dedupe; auto-derived from the URL when omitted) |
| `gtin` | – | upc, ean, isbn, barcode |

- **Dedupe:** rows matching an existing deal by `externalId`, normalized affiliate URL
  (tracking params ignored), or `gtin` are skipped and reported as duplicates.
- **Auto-approve:** imported deals default to PENDING; with "Publish immediately" they go
  live APPROVED and are DealScored on the spot (no waiting for the score cron).
- **New dependency:** `xlsx` (SheetJS) for Excel parsing. If you already have
  `node_modules`, run `npm install` after pulling — otherwise the import route 500s
  on `.xlsx` uploads.

## Admin: bulk moderation & deletion

The **Moderation queue** tab (`/admin`, key auth) now has:

- **Checkboxes** per deal + **Select all**, with **Approve selected** / **Reject selected**
  buttons (each asks for confirmation first). Calls `POST /api/admin/deals/bulk`
  with `{ids, action}` — same behavior as single approve/reject, up to 500 ids
  per call, returns `{approved, rejected}`.
- A **status filter** (Pending / Approved / Rejected) so you can find live deals,
  not just the pending queue.
- A **Delete** button on every row (with a confirm dialog). This is a **permanent**
  delete: the deal plus its click logs and price snapshots are removed in one
  transaction. (`DELETE /api/admin/deals/[id]` → `{ok: true}`, 404 for unknown id.)

Note: the `/admin` link was removed from the public header/footer — the route
still works at `https://dealriz.com/admin` with your admin key, and
`/robots.txt` blocks it from crawlers.

## API reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/go/[id]` | — | Logs click (hashed IP) → 302 to affiliate URL |
| GET | `/api/deals` | — | JSON deal feed (`q`, `category`, `minDiscount`, `price`, `sort`, `page`) |
| POST | `/api/alerts/subscribe` | — | `{email, keyword?, category?}` |
| GET | `/api/alerts/unsubscribe?token=` | — | One-click unsubscribe page |
| GET | `/api/admin/deals?status=` | key | Moderation queue |
| POST | `/api/admin/deals` | key | Submit deal → PENDING |
| PATCH | `/api/admin/deals/[id]` | key | `{action: "approve"\|"reject"}` or `{action: "boost", boostFactor: 1.0–2.0, pinnedUntil?: ISO datetime\|null}` |
| DELETE | `/api/admin/deals/[id]` | key | **Permanent** delete (removes click logs + price snapshots too) |
| POST | `/api/admin/deals/bulk` | key | Bulk moderation: `{ids: string[1–500], action: "approve"\|"reject"}` → `{approved, rejected}` |
| POST | `/api/admin/import` | key | Bulk import: multipart `file` (.xlsx/.xls/.csv/.tsv/.txt) **or** `sheetUrl` (shared Google Sheets link), `dryRun=1` to preview, `autoApprove=1` to publish immediately (default → PENDING) |
| GET | `/api/admin/import/template` | key | Download CSV import template (exact headers + 2 example rows) |
| GET | `/api/admin/analytics` | key | Live/pending counts, clicks 7d/30d, top deals, job history |
| POST | `/api/jobs/trigger` | key | `{job: "ingest"\|"score"\|"expire"\|"digest"\|"all"\|"scheduled"}` |

Auth = `X-Admin-Key` header matching `ADMIN_API_KEY`.

## SEO

- Dynamic `/sitemap.xml` (live deals + stores, try/catch so builds never fail without a DB)
- `/robots.txt` (blocks `/admin`, `/api/admin`, `/api/jobs`)
- JSON-LD `Product` schema on every deal page, **Organization JSON-LD on the
  homepage** (name/url/logo for brand signals), OG + Twitter Card meta site-wide
- ISR `revalidate = 300s` on listing/detail/store pages, semantic HTML, clean slugs
- No public link to `/admin` anywhere in the site chrome (obscurity + key auth);
  `/robots.txt` blocks `/admin`, `/api/admin`, `/api/jobs` from crawlers

## Advertising (AdSense — reserved slots)

Ad space is reserved now; real ads load later via config. While
`NEXT_PUBLIC_ADSENSE_CLIENT_ID` is unset, every slot renders a dashed
"Advertisement" placeholder holding the exact space the ad will occupy
(no layout shift when you go live).

| `slot` prop (placeholder) | Page | Format | Replace with |
|---|---|---|---|
| `homepage-leaderboard` | `/` below category strip | leaderboard | Ad unit ID |
| `homepage-sidebar-rectangle` | `/` sidebar | 300×250 | Ad unit ID |
| `homepage-infeed` | `/` deal grid (~8th card) | in-feed | Ad unit ID |
| `deals-leaderboard` | `/deals` above grid | leaderboard | Ad unit ID |
| `detail-sidebar-rectangle` | `/deals/[slug]` below buy box | 300×250 | Ad unit ID |
| `detail-incontent` | `/deals/[slug]` before related | responsive | Ad unit ID |

Slots are deliberately kept clear of the "Get This Deal" CTAs (AdSense
accidental-click policy). No ads render on `/admin` or `/legal/*`.

**Going live with real ads:**

1. Get an approved AdSense account (google.com/adsense) for `dealriz.com`
   (note: AdSense requires meaningful content + traffic; approval typically
   takes days–weeks for a new site — the placeholders cover you until then).
2. In AdSense, create one ad unit per slot above (Display ads) and copy each
   numeric ad-unit ID.
3. In `components/AdSlot.tsx` usages, replace each `slot="…"` placeholder
   string with the real numeric ID.
4. Set `NEXT_PUBLIC_ADSENSE_CLIENT_ID="ca-pub-XXXXXXXXXXXXXXXX"` in Vercel
   env vars and redeploy (it's a `NEXT_PUBLIC_` var, so it needs a rebuild
   to take effect). The AdSense library loads automatically from the root
   layout; placeholders disappear and real units render.

**ads.txt:** `/ads.txt` is served by the app (public, no auth — Google's crawlers
must fetch it). Set `ADSENSE_PUBLISHER_ID="ca-pub-XXXXXXXXXXXXXXXX"` (the same
publisher ID, no prefix) in Vercel env vars and redeploy; the route then serves
`google.com, ca-pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`. Until the var is
set, it serves `#`-comment instructions instead. (`ADSENSE_PUBLISHER_ID` is a
server-side var, so no rebuild-sensitive `NEXT_PUBLIC_` prefix is needed —
a plain redeploy picks it up.)

## Compliance notes

- FTC affiliate disclosure: site-wide banner, per-card "Affiliate link" label,
  `/legal/disclosure` page (16 CFR § 255)
- CAN-SPAM: one-click unsubscribe + physical-address/footer disclosure in digests
- Click logs store SHA-256-hashed IPs only; cookie consent banner; legal pages
  are **templates — have an attorney review before launch**

## What's intentionally NOT in v1

AI chat widget, community voting, B2B dashboard, Pro subscriptions, price
history charts, browser extension, user accounts. Each was cut to keep the
solo-founder scope shippable — add only after traffic validates the core loop:
**publish deals → get clicks → earn commissions → grow the email list**.
