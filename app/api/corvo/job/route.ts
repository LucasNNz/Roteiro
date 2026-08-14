import { NextRequest, NextResponse } from "next/server";
import { createCorvoJob, type CorvoJobRequest, CorvoStorageError } from "../../../../lib/corvo-jobs";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, message: "Origem não autorizada." }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, message: "Solicitação inválida." }, { status: 400 }); }

  const formato = body.format === "VÍDEO COMPLETO" ? "VÍDEO COMPLETO" : "REELS";
  const quantidade = body.quantity === "LOTE" ? "LOTE" : "1 VÍDEO";
  const modo = body.mode === "PESQUISAR ANTES" ? "PESQUISAR ANTES" : "RÁPIDO";
  const tema = typeof body.tema === "string" && body.tema.trim() ? body.tema.trim().slice(0, 180) : null;
  const recentes = Array.isArray(body.recentes) ? body.recentes.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const titulo = typeof record.titulo === "string" ? record.titulo.trim().slice(0, 180) : "";
    const itemTema = typeof record.tema === "string" ? record.tema.trim().slice(0, 180) : "";
    return titulo || itemTema ? [{ titulo, tema: itemTema }] : [];
  }).slice(0, 12) : [];

  const jobRequest: CorvoJobRequest = { tema, formato, quantidade, modo, recentes };
  try {
    const job = await createCorvoJob(jobRequest);
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      prompt: `Execute o trabalho CorvoQuiz ${job.id}. Primeiro use buscarSolicitacao com este jobId; ao terminar, use entregarResultado com o mesmo jobId.`,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof CorvoStorageError ? `${error.message} Conecte um Upstash Redis ao projeto na Vercel.` : "Não foi possível criar o trabalho.";
    return NextResponse.json({ ok: false, message }, { status: 503 });
  }
}
