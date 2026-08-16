import { NextRequest, NextResponse } from "next/server";
import { authorizeAction, ideasFromResult, storageFailure } from "../../../../lib/corvo-api";
import { completeCorvoJob, getCorvoJob } from "../../../../lib/corvo-jobs";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() || "";
  if (!jobId) return NextResponse.json({ ok: false, message: "Informe jobId." }, { status: 400 });
  try {
    const job = await getCorvoJob(jobId);
    if (!job) return NextResponse.json({ ok: false, message: "Trabalho não encontrado ou expirado." }, { status: 404 });
    const resultado = job.resultado || (job.ideias?.length ? JSON.stringify({ ideias: job.ideias }) : "");
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      specialist: job.request.specialist || "IDEIAS",
      resultado: ["DONE", "WAITING_FILE", "ERROR"].includes(job.status) ? resultado : undefined,
      ideias: job.status === "DONE" && (!job.request.specialist || job.request.specialist === "IDEIAS") ? ideasFromResult(resultado) : undefined,
      resultadoRecebido: job.resultadoRecebido === true,
      arquivoRecebido: job.arquivoRecebido === true,
      expectedFile: job.expectedFile,
      expectedFiles: job.expectedFiles || [],
      manifest: job.manifest,
      files: job.files || [],
      error: job.error,
    });
  } catch (error) { return storageFailure(error); }
}

export async function POST(request: NextRequest) {
  const unauthorized = authorizeAction(request);
  if (unauthorized) return unauthorized;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 }); }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const resultado = typeof body.resultado === "string" ? body.resultado.trim() : "";
  if (!jobId || !resultado) return NextResponse.json({ ok: false, message: "Envie jobId e resultado preenchidos." }, { status: 400 });
  try {
    const job = await completeCorvoJob(jobId, resultado);
    if (!job) return NextResponse.json({ ok: false, message: "Trabalho não encontrado ou expirado." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      jobId,
      status: job.status,
      message: job.status === "WAITING_FILE"
        ? "Manifesto recebido. Aguardando o arquivo real capturado pelo Corvo Bridge."
        : job.status === "ERROR"
          ? "Falha estruturada recebida pelo CorvoQuiz."
          : "Resultado entregue ao CorvoQuiz.",
    });
  } catch (error) { return storageFailure(error); }
}
