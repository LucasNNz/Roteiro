import { NextRequest, NextResponse } from "next/server";
import { resetCorvoJobForRetry } from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok:false, message:"JSON inválido." }, { status:400 }); }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const token = request.headers.get("x-corvo-upload-token")?.trim() || "";
  if (!jobId || !token) return NextResponse.json({ ok:false, message:"Informe jobId e token do trabalho." }, { status:400 });

  try {
    const job = await resetCorvoJobForRetry(jobId, token);
    if (!job) return NextResponse.json({ ok:false, message:"Trabalho não encontrado, expirado ou token inválido." }, { status:404 });
    return NextResponse.json({ ok:true, jobId:job.id, status:job.status, files:job.files || [] });
  } catch (error) { return storageFailure(error); }
}
