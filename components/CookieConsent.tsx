"use client";

import { useEffect, useState } from "react";

const KEY = "dealriz-cookie-consent";

// Simple cookie consent banner. Analytics/marketing cookies must not fire
// before consent — v1 ships no tracking cookies at all, so this is a
// notice + preference record for CCPA/GDPR hygiene.
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const choose = (value: "accepted" | "declined") => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:left-auto sm:right-6 sm:w-96"
    >
      <p className="text-sm font-semibold text-slate-900">We use minimal cookies</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        DealRiz uses only essential cookies to run the site. No advertising
        trackers. See our{" "}
        <a href="/legal/privacy" className="underline">
          privacy policy
        </a>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => choose("accepted")}
          className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
        >
          Accept
        </button>
        <button
          onClick={() => choose("declined")}
          className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
