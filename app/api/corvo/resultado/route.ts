import { NextRequest, NextResponse } from "next/server";
import { authorizeAction, normalizeIdeas, storageFailure } from "../../../../lib/corvo-api";
import { completeCorvoJob, getCorvoJob } from "../../../../lib/corvo-jobs";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() || "";
  if (!jobId) return NextResponse.json({ ok: false, message: "Informe jobId." }, { status: 400 });
  try {
    const job = await getCorvoJob(jobId);
    if (!job) return NextResponse.json({ ok: false, message: "Trabalho não encontrado ou expirado." }, { status: 404 });
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status, ideias: job.status === "DONE" ? job.ideias : undefined });
  } catch (error) { return storageFailure(error); }
}

export async function POST(request: NextRequest) {
  const unauthorized = authorizeAction(request);
  if (unauthorized) return unauthorized;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 }); }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const ideias = normalizeIdeas(body);
  if (!jobId || !ideias.length) return NextResponse.json({ ok: false, message: "Envie jobId e uma lista de ideias válidas." }, { status: 400 });
  try {
    const job = await completeCorvoJob(jobId, ideias);
    if (!job) return NextResponse.json({ ok: false, message: "Trabalho não encontrado ou expirado." }, { status: 404 });
    return NextResponse.json({ ok: true, jobId, status: job.status, ideiasRecebidas: ideias.length, message: "Resultado entregue ao CorvoQuiz." });
  } catch (error) { return storageFailure(error); }
}
