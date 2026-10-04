import { isCategory } from "../categories";

/**
 * Shared keyword-based category mapper for affiliate adapters.
 *
 * Maps a network's raw category text (plus the product title as a fallback
 * signal) onto one of the site's 12 categories. Unknown → "Other".
 * Extracted from the ShareASale adapter so all networks map identically.
 */
export function mapCategory(raw: string | undefined, title: string): string {
  const hay = `${raw ?? ""} ${title}`.toLowerCase();
  const rules: [string, string[]][] = [
    ["Electronics", ["electronic", "tv", "television", "laptop", "headphone", "earbud", "audio", "camera", "phone", "computer", "tablet", "smart home", "wearable", "speaker", "monitor", "keyboard"]],
    ["Gaming", ["gaming", "video game", "console", "xbox", "playstation", "nintendo", "pc gaming"]],
    ["Fashion", ["fashion", "apparel", "clothing", "shoe", "sneaker", "dress", "denim", "handbag", "watch", "jewelry", "accessories", "footwear"]],
    ["Home", ["furniture", "home", "kitchen", "bedding", "decor", "appliance", "mattress", "cookware", "bath"]],
    ["Grocery", ["grocery", "food", "beverage", "snack", "coffee", "tea"]],
    ["Health", ["health", "beauty", "skincare", "vitamin", "supplement", "personal care", "cosmetic"]],
    ["Sports", ["sport", "fitness", "outdoor", "camping", "exercise", "bike", "yoga", "golf", "running"]],
    ["Pets", ["pet", "dog", "cat"]],
    ["Kids", ["kid", "baby", "toy", "children", "toddler"]],
    ["Tools", ["tool", "hardware", "drill", "saw"]],
    ["Travel", ["travel", "luggage", "hotel", "flight", "backpack"]],
  ];
  for (const [cat, kws] of rules) {
    if (kws.some((k) => hay.includes(k))) return cat;
  }
  return isCategory(raw ?? "") ? (raw as string) : "Other";
}
