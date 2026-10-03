"use client";

import { useState } from "react";

// Share buttons: X, WhatsApp, copy link.
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Share:</span>
      <a
        className={btn}
        href={`https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
      >
        𝕏 <span className="hidden sm:inline">Post</span>
      </a>
      <a
        className={btn}
        href={`https://wa.me/?text=${encodedTitle}%20${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on WhatsApp"
      >
        ✆ <span className="hidden sm:inline">WhatsApp</span>
      </a>
      <button className={btn} onClick={copyLink} aria-label="Copy deal link">
        {copied ? "✓ Copied" : "⧉ Copy link"}
      </button>
    </div>
  );
}
