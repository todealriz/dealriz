import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { jobTriggerSchema } from "@/lib/validation";
import { runJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 300; // ingestion can take a while on serverless

// POST /api/jobs/trigger — { job: "ingest"|"score"|"expire"|"digest"|"all"|"scheduled" }
// Protected by ADMIN_API_KEY. Called by GitHub Actions cron + the /admin UI.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = jobTriggerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid job name", valid: jobTriggerSchema.shape.job.options },
      { status: 400 }
    );
  }

  try {
    const startedAt = new Date();
    const result = await runJob(parsed.data.job);
    return NextResponse.json({
      ok: true,
      job: parsed.data.job,
      startedAt,
      finishedAt: new Date(),
      result,
    });
  } catch (err) {
    console.error(`job ${parsed.data.job} failed:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
