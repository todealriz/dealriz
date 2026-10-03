// The 12 DealRiz deal categories. Keep in sync with the mock adapter
// and the admin submission form.
export const CATEGORIES = [
  "Electronics",
  "Fashion",
  "Home",
  "Grocery",
  "Health",
  "Sports",
  "Gaming",
  "Travel",
  "Pets",
  "Kids",
  "Tools",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string | undefined | null): value is Category {
  return !!value && (CATEGORIES as readonly string[]).includes(value);
}

// Short blurb per category used on cards/SEO text.
export const CATEGORY_BLURBS: Record<Category, string> = {
  Electronics: "TVs, headphones, laptops, smart home and more.",
  Fashion: "Shoes, apparel, bags and accessories.",
  Home: "Furniture, kitchen, appliances and decor.",
  Grocery: "Meal kits, pantry staples and memberships.",
  Health: "Fitness, personal care and wellness.",
  Sports: "Outdoor gear, training and recovery.",
  Gaming: "Consoles, games, PC gear and accessories.",
  Travel: "Hotels, luggage and booking deals.",
  Pets: "Food, toys and gear for your animals.",
  Kids: "Toys, learning and family favorites.",
  Tools: "Power tools, hand tools and workshop.",
  Other: "Everything else worth a look.",
};
