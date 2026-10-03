import { Resend } from "resend";
import { SITE } from "./site";

// Email via Resend. In dev (no RESEND_API_KEY), emails are logged to the
// console instead of sent — the signup/unsubscribe flows work end-to-end
// without a key.

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.RESEND_FROM_EMAIL ?? "DealRiz <deals@dealriz.com>";

export type SendResult = { sent: boolean; dev: boolean; id?: string };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  if (!resend) {
    console.log(
      `[email:dev] To: ${opts.to}\nSubject: ${opts.subject}\n---\n${opts.html.slice(0, 500)}...\n---`
    );
    return { sent: false, dev: true };
  }
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return { sent: true, dev: false, id: data?.id };
}

export function unsubscribeUrl(token: string): string {
  return `${SITE.url}/api/alerts/unsubscribe?token=${token}`;
}

export function digestEmailHtml(
  deals: { title: string; slug: string; salePrice: number; aiScore: number | null }[],
  token: string
): string {
  const rows = deals
    .map(
      (d) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
          <a href="${SITE.url}/deals/${d.slug}" style="color:#0ea5e9;font-weight:600;text-decoration:none;">${escapeHtml(d.title)}</a><br/>
          <span style="color:#0f172a;font-weight:700;">$${d.salePrice.toFixed(2)}</span>
          ${d.aiScore != null ? `<span style="color:#6366f1;"> · DealScore ${d.aiScore}</span>` : ""}
        </td>
      </tr>`
    )
    .join("");

  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
    <h1 style="font-size:22px;">This week's top deals on ${SITE.name}</h1>
    <p style="color:#475569;">Hand-picked and AI-scored. Prices change fast — grab them while they're live.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="font-size:12px;color:#64748b;margin-top:24px;">
      Affiliate Disclosure: DealRiz may earn a commission when you buy through links in this email,
      at no extra cost to you.<br/>
      DealRiz · ${SITE.domain}<br/>
      <a href="${unsubscribeUrl(token)}">Unsubscribe</a>
    </p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
