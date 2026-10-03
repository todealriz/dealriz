import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SITE.name} collects, uses and protects your data.`,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        <b>Template notice:</b> this page is a starting template, not legal advice.
        Have an attorney review it before launch, especially for CCPA/CPRA and GDPR coverage.
      </p>
      <h1 className="mt-6 text-3xl font-black">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: October 2026</p>

      <Section title="Data we collect">
        <ul className="list-disc pl-5">
          <li><b>Email address</b> — only if you subscribe to deal alerts (optional).</li>
          <li><b>Click data</b> — when you click a deal link we log a timestamp, a SHA-256 hash of your IP address (never the plain IP), user agent and referrer, for analytics.</li>
          <li><b>Cookie preference</b> — stored locally in your browser; we use only essential cookies.</li>
        </ul>
        <p>We do not require accounts, and we do not knowingly collect data from children under 13.</p>
      </Section>

      <Section title="How we use it">
        <p>
          Email addresses are used solely to send the deal alerts and digests you
          requested. Click logs are used to measure which deals perform well and
          to detect abuse. We do not sell personal information.
        </p>
      </Section>

      <Section title="Your rights (CCPA/CPRA & GDPR)">
        <p>
          If you are in California or the EEA/UK, you may request access,
          correction or deletion of your personal data, and may opt out of any
          sale/sharing (we do not sell data). Email privacy@{SITE.domain} and we
          will respond within 30 days. Every marketing email includes a one-click
          unsubscribe link.
        </p>
      </Section>

      <Section title="Data retention">
        <p>
          Click logs are retained for 12 months, then deleted. Unsubscribed email
          addresses are kept on a suppression list (email hash only) to honor
          your choice.
        </p>
      </Section>

      <Section title="Contact">
        <p>Email privacy@{SITE.domain} for any privacy questions or requests.</p>
      </Section>
    </div>
  );
}
