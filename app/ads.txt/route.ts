// GET /ads.txt — AdSense authorized-sellers file.
//
// Serves the authorized-seller line once ADSENSE_PUBLISHER_ID is set (after
// Google AdSense approval). Until then it serves #-comment instructions so
// crawlers (and the site owner) see exactly what to do. No admin auth —
// ads.txt must be publicly fetchable by Google's crawlers.
export const runtime = "nodejs";

export async function GET() {
  const publisherId = (process.env.ADSENSE_PUBLISHER_ID ?? "").trim();
  const body = publisherId
    ? `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`
    : [
        "# DealRiz ads.txt — no authorized sellers configured yet.",
        "#",
        "# After your Google AdSense account is approved for dealriz.com,",
        "# set ADSENSE_PUBLISHER_ID to your publisher ID (ca-pub-XXXXXXXXXXXXXXXX)",
        "# in your environment and redeploy. This file will then serve:",
        "#   google.com, ca-pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0",
        "",
      ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
