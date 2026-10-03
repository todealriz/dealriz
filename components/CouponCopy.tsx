"use client";

import { useState } from "react";

// One-click coupon copy with visual feedback.
export function CouponCopy({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="group flex items-center gap-2 rounded-lg border-2 border-dashed border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-bold tracking-wider text-brand-700 transition hover:border-brand-500 hover:bg-brand-100"
      aria-label={`Copy coupon code ${code}`}
      title="Click to copy"
    >
      <span className="font-mono">{code}</span>
      <span className="text-xs font-semibold text-brand-500 group-hover:text-brand-700">
        {copied ? "✓ Copied!" : "⧉ Copy"}
      </span>
    </button>
  );
}
