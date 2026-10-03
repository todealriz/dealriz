// Central site constants. Override via env where noted.
export const SITE = {
  name: "DealRiz",
  tagline: "Shop smarter. Save more.",
  domain: "dealriz.com",
  url: process.env.SITE_URL ?? "https://dealriz.com",
  description:
    "DealRiz scores every deal with AI so you know what's actually worth buying. Curated deals, honest scores, zero hype.",
} as const;

export const DEALS_PER_PAGE = 16;
export const REVALIDATE_SECONDS = 300; // ISR window for listing/detail pages
