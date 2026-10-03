"use client";

import { useEffect } from "react";
import Script from "next/script";

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

export type AdFormat = "leaderboard" | "rectangle" | "in-feed" | "responsive";

/** Full publisher ID, e.g. "ca-pub-1234567890123456". Inlined at build time. */
const CLIENT_ID = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

/**
 * Loads the AdSense library once per page. Render from the root layout only;
 * renders nothing until NEXT_PUBLIC_ADSENSE_CLIENT_ID is configured.
 */
export function AdSenseScript() {
  if (!CLIENT_ID) return null;
  return (
    <Script
      id="adsense-lib"
      strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT_ID}`}
      crossOrigin="anonymous"
    />
  );
}

const FORMAT_ATTRS: Record<AdFormat, { adFormat: string; fullWidth: boolean }> = {
  leaderboard: { adFormat: "horizontal", fullWidth: false },
  rectangle: { adFormat: "rectangle", fullWidth: false },
  "in-feed": { adFormat: "fluid", fullWidth: false },
  responsive: { adFormat: "auto", fullWidth: true },
};

/**
 * Fixed space reserved for the ad in BOTH modes (placeholder and real unit),
 * so enabling AdSense later never causes layout shift.
 */
const RESERVED_SIZE: Record<AdFormat, string> = {
  leaderboard: "min-h-[90px] w-full", // 728×90 / 970×90
  rectangle: "h-[250px] w-[300px] max-w-full", // 300×250
  "in-feed": "h-full min-h-[300px] w-full", // ≈ one deal card in the grid
  responsive: "min-h-[100px] w-full",
};

type AdSlotProps = {
  /**
   * AdSense ad-unit ID (numeric, from your AdSense account). Until real IDs
   * exist, any descriptive string works — placeholders render while
   * NEXT_PUBLIC_ADSENSE_CLIENT_ID is unset.
   */
  slot: string;
  format?: AdFormat;
  className?: string;
  /** Human label shown on the placeholder, e.g. "Homepage leaderboard". */
  label?: string;
};

/**
 * Reserved ad space. Renders a real AdSense unit once
 * NEXT_PUBLIC_ADSENSE_CLIENT_ID is set; otherwise a clearly-labeled dashed
 * placeholder that holds the exact space the ad will occupy.
 *
 * Kept clear of "Get This Deal" CTAs per AdSense accidental-click policy.
 */
export function AdSlot({ slot, format = "responsive", className = "", label }: AdSlotProps) {
  useEffect(() => {
    if (!CLIENT_ID) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSense blocked (ad blocker, etc.) — reserved space stays empty.
    }
  }, []);

  if (!CLIENT_ID) {
    return (
      <div
        aria-hidden="true"
        className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-100/70 px-4 py-6 text-center ${RESERVED_SIZE[format]} ${className}`}
      >
        <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">
          Advertisement
        </span>
        <span className="text-xs text-slate-400">{label ?? slot}</span>
      </div>
    );
  }

  const { adFormat, fullWidth } = FORMAT_ATTRS[format];
  return (
    <div className={`${RESERVED_SIZE[format]} ${className}`}>
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%" }}
        data-ad-client={CLIENT_ID}
        data-ad-slot={slot}
        data-ad-format={adFormat}
        {...(fullWidth ? { "data-full-width-responsive": "true" } : {})}
      />
    </div>
  );
}
