"use client";

import { useEffect, useState } from "react";

// Live countdown to a deal's expiry. Renders nothing when no expiry is set.
export function Countdown({ expiresAt, compact = false }: { expiresAt: string; compact?: boolean }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    const tick = () => {
      const ms = target - Date.now();
      if (ms <= 0) {
        setLabel("Expired");
        return;
      }
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setLabel(
        d > 0 ? `Ends in ${d}d ${h}h` : h > 0 ? `Ends in ${h}h ${m}m` : `Ends in ${m}m`
      );
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!label) return null;
  const urgent = label === "Expired" || /Ends in \d+m/.test(label);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      } ${urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}
      aria-live="polite"
    >
      ⏱ {label}
    </span>
  );
}
