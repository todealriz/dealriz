import { randomBytes } from "crypto";

// URL-safe slug from a deal/store title, e.g. "Sony WH-1000XM5!" -> "sony-wh-1000xm5"
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Unique slug: base + short random suffix (collision-safe for ingest).
export function uniqueSlug(title: string): string {
  const suffix = randomBytes(3).toString("hex");
  return `${slugify(title) || "deal"}-${suffix}`;
}
