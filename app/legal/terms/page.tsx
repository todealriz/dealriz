import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms governing your use of ${SITE.name}.`,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        <b>Template notice:</b> this page is a starting template, not legal advice.
        Have an attorney review it before launch.
      </p>
      <h1 className="mt-6 text-3xl font-black">Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: October 2026</p>

      <Section title="The service">
        <p>
          {SITE.name} aggregates deals from merchants and scores them with an
          algorithm. Prices, availability and coupon codes change quickly and are
          controlled by the merchant — we do not guarantee any listed price or
          that a deal is still available when you click through.
        </p>
      </Section>

      <Section title="Eligibility">
        <p>
          You must be at least 13 years old to use {SITE.name}. By using the site
          or subscribing to deal alerts, you confirm that you meet this age
          requirement. The site is not directed at children under 13.
        </p>
      </Section>

      <Section title="DealScore is not financial advice">
        <p>
          Our DealScore is an automated heuristic for entertainment and
          informational purposes only. It is not financial advice, and you should
          make purchase decisions based on your own judgment.
        </p>
      </Section>

      <Section title="Affiliate links">
        <p>
          Outbound deal links are affiliate links as described in our{" "}
          <a href="/legal/disclosure" className="text-brand-700 underline">Affiliate Disclosure</a>.
          Purchases are completed on the merchant's site and governed by the
          merchant's terms.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          You agree not to abuse the site: no scraping at disruptive rates, no
          attempts to manipulate deal scores or click tracking, and no unlawful use.
          We may rate-limit or block abusive traffic.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          The site is provided "as is" without warranties. To the maximum extent
          permitted by law, {SITE.name} is not liable for any damages arising from
          your use of the site, expired or inaccurate deals, or purchases made
          through merchant links.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update these terms; material changes will be noted by updating
          the "Last updated" date above. Continued use of the site constitutes
          acceptance.
        </p>
      </Section>
    </div>
  );
}
