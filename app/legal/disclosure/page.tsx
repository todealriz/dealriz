import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Affiliate Disclosure",
  description: `How ${SITE.name} earns money: affiliate commissions, clearly disclosed.`,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function DisclosurePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        <b>Template notice:</b> this page is a starting template, not legal advice.
        Have an attorney review it before launch.
      </p>
      <h1 className="mt-6 text-3xl font-black">Affiliate Disclosure</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: October 2026</p>

      <Section title="How DealRiz makes money">
        <p>
          {SITE.name} ("we") is reader-supported. When you click a deal link on this
          site and make a purchase, we may earn an affiliate commission from the
          merchant — at <b>no extra cost to you</b>. This is how we keep the site free.
        </p>
      </Section>

      <Section title="Our affiliate partners">
        <p>
          We participate in affiliate programs including, but not limited to,
          Amazon Associates, ShareASale, CJ Affiliate, Impact, Rakuten Advertising
          and Walmart Affiliates. The specific network behind a store is shown on
          store pages where available.
        </p>
      </Section>

      <Section title="Amazon Associates disclosure">
        <p>
          As an Amazon Associate, we earn from qualifying purchases. Amazon and
          all related marks are trademarks of Amazon.com, Inc. or its affiliates.
        </p>
      </Section>

      <Section title="Editorial independence">
        <p>
          Commissions do not determine which deals we publish or how they are
          scored. Our DealScore is computed by a published, deterministic formula
          (see "How scoring works" on any deal page). Sponsored placements, if we
          ever offer them, will always be clearly labeled as sponsored — never
          disguised as organic deals.
        </p>
      </Section>

      <Section title="FTC compliance">
        <p>
          This disclosure is provided in accordance with the FTC's Endorsement
          Guides (16 CFR Part 255). Affiliate links are additionally labeled
          on every deal card, deal page and email with "Affiliate link —
          commission may apply."
        </p>
      </Section>

      <Section title="Questions">
        <p>
          Contact us at deals@{SITE.domain} with any questions about our
          affiliate relationships.
        </p>
      </Section>
    </div>
  );
}
