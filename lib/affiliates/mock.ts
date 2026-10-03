import type { AffiliateAdapter, RawDeal } from "./types";

/**
 * MockAdapter — deterministic fake affiliate feed for local development.
 *
 * Generates ~40 believable deals across all 12 categories with real-world
 * merchants, plausible prices, coupon codes and expiry dates. Lets you build
 * and test the entire pipeline (ingest → score → publish → SEO) with $0 cost
 * and no affiliate approvals.
 *
 * NEVER use this in production — it exists only so `npm run dev` and the seed
 * script have realistic data.
 */

type MockSpec = {
  store: string;
  network: string;
  title: string;
  description: string;
  sale: number;
  original?: number;
  coupon?: string;
  category: string;
  badge?: string;
  // expiry offset in hours from "now"; omit = no expiry
  expiresInHours?: number;
};

const NOW = Date.now();
const h = (hours: number) => new Date(NOW + hours * 3_600_000);

const SPECS: MockSpec[] = [
  // ── Electronics ──────────────────────────────────────────────
  { store: "Best Buy", network: "CJ Affiliate", category: "Electronics", badge: "HOT", expiresInHours: 50,
    title: "Samsung 65\" Crystal UHD 4K Smart TV (2025 Model)",
    description: "Crystal Processor 4K upscaling, Object Tracking Sound and AirSlim design. Includes free delivery.",
    sale: 549.99, original: 799.99 },
  { store: "Amazon", network: "Amazon Associates", category: "Electronics", expiresInHours: 120,
    title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    description: "Industry-leading noise canceling, 30-hour battery, multipoint connection. Black.",
    sale: 328.0, original: 399.99 },
  { store: "Walmart", network: "Walmart Affiliates", category: "Electronics", badge: "HOT", expiresInHours: 72,
    title: "Apple AirPods Pro (2nd Generation) with MagSafe Case",
    description: "Adaptive Transparency, Personalized Spatial Audio and up to 2x stronger active noise cancellation.",
    sale: 169.0, original: 249.0 },
  { store: "Dell", network: "CJ Affiliate", category: "Electronics", coupon: "XPSDEAL", expiresInHours: 168,
    title: "Dell XPS 13 Laptop — Snapdragon X Elite, 16GB RAM, 512GB SSD",
    description: "Copilot+ PC with 45 TOPS NPU, 13.4\" FHD+ display and 18-hour battery life.",
    sale: 899.99, original: 1199.99 },
  { store: "Anker", network: "ShareASale", category: "Electronics", expiresInHours: 120,
    title: "Anker 737 Power Bank (PowerCore 24K), 120W 3-Port",
    description: "24,000mAh capacity with Smart Digital Display. Charges a 16\" MacBook Pro at full speed.",
    sale: 89.99, original: 149.99 },

  // ── Fashion ──────────────────────────────────────────────────
  { store: "Nike", network: "Impact", category: "Fashion", expiresInHours: 96,
    title: "Nike Air Zoom Pegasus 41 Running Shoes",
    description: "Responsive Zoom Air cushioning with engineered mesh upper. Men's and women's colorways.",
    sale: 97.97, original: 140.0 },
  { store: "Macy's", network: "CJ Affiliate", category: "Fashion", expiresInHours: 144,
    title: "Levi's 511 Slim Fit Stretch Jeans",
    description: "Classic slim fit with added stretch. Multiple washes in stock.",
    sale: 41.7, original: 69.5 },
  { store: "Adidas", network: "Impact", category: "Fashion", expiresInHours: 100,
    title: "Adidas Ultraboost Light Running Shoes",
    description: "Lightest Ultraboost ever with BOOST midsole energy return.",
    sale: 114.0, original: 190.0 },
  { store: "Coach Outlet", network: "CJ Affiliate", category: "Fashion", badge: "LIMITED", expiresInHours: 48,
    title: "Coach Pebble Leather Central Tote",
    description: "Polished pebble leather tote with inside zip pocket. Outlet exclusive pricing.",
    sale: 179.0, original: 398.0 },

  // ── Home ─────────────────────────────────────────────────────
  { store: "Dyson", network: "Impact", category: "Home", badge: "HOT", expiresInHours: 120,
    title: "Dyson V15 Detect Cordless Vacuum",
    description: "Laser Slim Fluffy head reveals microscopic dust; piezo sensor counts particles. 60-min run time.",
    sale: 549.99, original: 749.99 },
  { store: "Target", network: "Impact", category: "Home", expiresInHours: 168,
    title: "KitchenAid Artisan Series 5-Qt Stand Mixer",
    description: "10 speeds, 59-point planetary mixing. Includes flat beater, dough hook and wire whip.",
    sale: 379.0, original: 499.99 },
  { store: "Amazon", network: "Amazon Associates", category: "Home", expiresInHours: 72,
    title: "Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Qt",
    description: "Pressure cook, slow cook, rice cooker, steamer, sauté, yogurt maker and warmer in one.",
    sale: 69.95, original: 119.95 },
  { store: "Brooklinen", network: "ShareASale", category: "Home", coupon: "COZY20", expiresInHours: 144,
    title: "Brooklinen Luxe Core Sheet Set, Queen",
    description: "480-thread-count long-staple cotton sateen. Extra 20% off with code at checkout.",
    sale: 159.2, original: 199.0 },

  // ── Grocery ──────────────────────────────────────────────────
  { store: "Thrive Market", network: "ShareASale", category: "Grocery",
    title: "Thrive Market Annual Membership — 33% Off",
    description: "Organic groceries and clean essentials delivered, up to 30% off retail every day.",
    sale: 39.95, original: 59.95 },
  { store: "Blue Apron", network: "Impact", category: "Grocery", expiresInHours: 200,
    title: "Blue Apron: $110 Off Across Your First 5 Boxes",
    description: "Chef-designed meal kits with pre-portioned ingredients. New customers only.",
    sale: 59.99, original: 169.99 },
  { store: "Whole Foods Market", network: "Amazon Associates", category: "Grocery", coupon: "GROCERY20", expiresInHours: 90,
    title: "Whole Foods Market: $20 Off $80 Grocery Delivery",
    description: "Fresh produce, meat and pantry staples delivered in 2 hours. Code applies at checkout.",
    sale: 60.0, original: 80.0 },

  // ── Health ───────────────────────────────────────────────────
  { store: "GNC", network: "CJ Affiliate", category: "Health", coupon: "GNC15", expiresInHours: 96,
    title: "GNC Pro Performance 100% Whey Protein, 5 lb",
    description: "25g protein per serving, BCAAs and digestive enzymes. Multiple flavors.",
    sale: 64.99, original: 94.99 },
  { store: "Amazon", network: "Amazon Associates", category: "Health", expiresInHours: 120,
    title: "Philips Sonicare 4100 Electric Toothbrush",
    description: "Sonicare technology, pressure sensor and 2-week battery. QuadPacer timer.",
    sale: 39.96, original: 59.96 },
  { store: "Best Buy", network: "CJ Affiliate", category: "Health", badge: "HOT", expiresInHours: 48,
    title: "Fitbit Charge 6 Fitness Tracker",
    description: "Heart rate, SpO2, ECG, 40 exercise modes and built-in GPS. 7-day battery.",
    sale: 99.95, original: 159.95 },
  { store: "Therabody", network: "Impact", category: "Health", expiresInHours: 168,
    title: "Theragun Mini (2nd Generation) Percussion Massager",
    description: "Pocket-sized deep tissue treatment with 3 speeds and USB-C charging.",
    sale: 149.0, original: 199.0 },

  // ── Sports ───────────────────────────────────────────────────
  { store: "REI", network: "Impact", category: "Sports", expiresInHours: 168,
    title: "REI Co-op Half Dome 2 Tent with Footprint",
    description: "2-person, 3-season backpacking tent. Free footprint included in this bundle.",
    sale: 179.93, original: 259.95 },
  { store: "Dick's Sporting Goods", network: "CJ Affiliate", category: "Sports", expiresInHours: 72,
    title: "Bowflex SelectTech 552 Adjustable Dumbbells (Pair)",
    description: "Adjust from 5 to 52.5 lbs with a dial. Replaces 15 sets of weights.",
    sale: 299.0, original: 429.0 },
  { store: "YETI", network: "Impact", category: "Sports", expiresInHours: 144,
    title: "YETI Tundra 45 Hard Cooler",
    description: "Rotomolded construction holds ice for days. Bear-resistant certified.",
    sale: 240.0, original: 325.0 },

  // ── Gaming ───────────────────────────────────────────────────
  { store: "GameStop", network: "CJ Affiliate", category: "Gaming", badge: "HOT", expiresInHours: 48,
    title: "Nintendo Switch OLED Model — White Joy-Con",
    description: "7\" OLED screen, 64GB storage, enhanced audio and wide adjustable stand.",
    sale: 299.99, original: 349.99 },
  { store: "Steam", network: "ShareASale", category: "Gaming", expiresInHours: 120,
    title: "Steam Deck 512GB OLED Handheld",
    description: "HDR OLED display, 90Hz refresh, 6nm APU. Your Steam library on the go.",
    sale: 449.0, original: 549.0 },
  { store: "Best Buy", network: "CJ Affiliate", category: "Gaming", expiresInHours: 96,
    title: "Sony DualSense Wireless Controller for PS5",
    description: "Haptic feedback and adaptive triggers. White.",
    sale: 54.0, original: 74.99 },

  // ── Travel ───────────────────────────────────────────────────
  { store: "Expedia", network: "CJ Affiliate", category: "Travel", coupon: "TRAVEL25", expiresInHours: 168,
    title: "Expedia: Extra 25% Off Select Hotels",
    description: "Book by Sunday for stays through next quarter. Code stacks with member prices.",
    sale: 150.0, original: 200.0 },
  { store: "Macy's", network: "CJ Affiliate", category: "Travel", expiresInHours: 72,
    title: "Samsonite Freeform 28\" Expandable Spinner Luggage",
    description: "Ultralight polypropylene shell, 10-year warranty. Multiple colors.",
    sale: 159.99, original: 319.99 },
  { store: "Booking.com", network: "Impact", category: "Travel", expiresInHours: 144,
    title: "Booking.com: 15% Off Genius-Level Stays",
    description: "Thousands of participating properties worldwide. Free cancellation on most rooms.",
    sale: 127.5, original: 150.0 },

  // ── Pets ─────────────────────────────────────────────────────
  { store: "Chewy", network: "CJ Affiliate", category: "Pets", expiresInHours: 120,
    title: "Blue Buffalo Life Protection Formula Adult Chicken 34-lb Bag",
    description: "Real chicken first, LifeSource Bits antioxidants. Autoship-eligible.",
    sale: 58.98, original: 76.99 },
  { store: "Petco", network: "Impact", category: "Pets", coupon: "PETCO10", expiresInHours: 96,
    title: "Frisco 72\" Faux Fur Cat Tree",
    description: "Multi-level condo with scratching posts and plush perches.",
    sale: 79.99, original: 129.99 },
  { store: "Amazon", network: "Amazon Associates", category: "Pets", badge: "LIMITED", expiresInHours: 48,
    title: "Furbo 360° Dog Camera with Treat Tossing",
    description: "Full HD camera, 2-way audio, barking alerts and treat dispenser.",
    sale: 139.0, original: 210.0 },

  // ── Kids ─────────────────────────────────────────────────────
  { store: "LEGO", network: "Rakuten Advertising", category: "Kids", expiresInHours: 144,
    title: "LEGO Super Mario Adventures Starter Course (71360)",
    description: "231-piece interactive starter set with Bluetooth Mario figure.",
    sale: 41.99, original: 59.99 },
  { store: "Target", network: "Impact", category: "Kids", expiresInHours: 120,
    title: "Melissa & Doug Wooden Building Blocks Set, 100 pcs",
    description: "Solid wood blocks in 4 colors and 9 shapes. Ages 2+.",
    sale: 34.99, original: 49.99 },
  { store: "Amazon", network: "Amazon Associates", category: "Kids", expiresInHours: 72,
    title: "Fisher-Price Laugh & Learn Smart Stages Chair",
    description: "50+ sing-along songs and phrases that grow with baby from 12–36 months.",
    sale: 27.99, original: 44.99 },

  // ── Tools ────────────────────────────────────────────────────
  { store: "Home Depot", network: "CJ Affiliate", category: "Tools", badge: "HOT", expiresInHours: 48,
    title: "DeWalt 20V MAX Drill/Driver Kit with 2 Batteries",
    description: "Brushless motor, 2-speed transmission, includes charger and contractor bag.",
    sale: 99.0, original: 159.0 },
  { store: "Home Depot", network: "CJ Affiliate", category: "Tools", expiresInHours: 168,
    title: "Milwaukee M18 5-Tool Combo Kit",
    description: "Hammer drill, impact driver, Sawzall, circular saw and LED light with 2 XC batteries.",
    sale: 399.0, original: 599.0 },
  { store: "Lowe's", network: "CJ Affiliate", category: "Tools", expiresInHours: 96,
    title: "Craftsman 230-Piece Mechanics Tool Set",
    description: "SAE and metric sockets, ratchets and wrenches in a 3-drawer case.",
    sale: 129.0, original: 199.0 },

  // ── Other ────────────────────────────────────────────────────
  { store: "Tile", network: "ShareASale", category: "Other", expiresInHours: 120,
    title: "Tile Mate Bluetooth Tracker, 4-Pack",
    description: "Find keys, bags and more with the Tile app. 250-ft Bluetooth range.",
    sale: 59.99, original: 99.99 },
  { store: "Hydro Flask", network: "Impact", category: "Other", expiresInHours: 96,
    title: "Hydro Flask 32 oz Wide Mouth Water Bottle",
    description: "TempShield insulation keeps drinks cold 24h. Dishwasher safe.",
    sale: 31.96, original: 44.95 },
];

export class MockAdapter implements AffiliateAdapter {
  name = "mock";

  async fetchDeals(): Promise<RawDeal[]> {
    // Simulate a tiny network delay so job logs look realistic.
    await new Promise((r) => setTimeout(r, 150));

    return SPECS.map((s, i) => {
      const slugBase = s.store.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return {
        externalId: `mock-${slugBase}-${String(i + 1).padStart(3, "0")}`,
        title: s.title,
        description: s.description,
        salePrice: s.sale,
        originalPrice: s.original,
        couponCode: s.coupon,
        // Mock affiliate link: merchant URL + tracking params (replace with real
        // network links when you wire a production adapter).
        affiliateUrl: `https://www.${slugBase}.com/product/mock-${i + 1}?utm_source=dealriz&utm_medium=affiliate&tag=dealriz-20`,
        category: s.category,
        badge: s.badge,
        storeName: s.store,
        affiliateNetwork: s.network,
        expiresAt: s.expiresInHours ? h(s.expiresInHours) : undefined,
        // Deterministic placeholder images (picsum.photos) so the demo
        // exercises image-dependent paths: Catch of the Day, card art,
        // and the auto-approve rule's image requirement. DEV ONLY —
        // real adapters must supply genuine product images.
        imageUrl: `https://picsum.photos/seed/dealriz-${i + 1}/640/480`,
      };
    });
  }
}
