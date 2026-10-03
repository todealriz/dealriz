// Site-wide FTC affiliate disclosure banner (16 CFR § 255).
export function DisclosureBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[11px] leading-snug text-amber-900 sm:text-xs">
      <span className="font-bold">Affiliate Disclosure:</span>{" "}
      DealRiz may earn a commission when you buy through links on this site, at no
      extra cost to you.{" "}
      <a href="/legal/disclosure" className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800">
        Learn more
      </a>
    </div>
  );
}
