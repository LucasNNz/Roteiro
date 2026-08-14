import { NextRequest, NextResponse } from "next/server";
import {
  createCorvoJob,
  type CorvoJobRequest,
  type CorvoSpecialist,
  CorvoStorageError,
} from "../../../../lib/corvo-jobs";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function buildIdeasPrompt(request: CorvoJobRequest) {
  const recentText = request.recentes.length
    ? request.recentes.map((item, index) => `${index + 1}. ${item.titulo || item.tema}${item.tema && item.tema !== item.titulo ? ` — ${item.tema}` : ""}`).join("\n")
    : "Nenhuma produção recente informada.";
  return [
    "Crie exatamente quatro ideias de quiz diferentes entre si, em português do Brasil.",
    "Cada ideia deve apresentar claramente TÍTULO, TEMA, CONCEITO e POR QUE PODE FUNCIONAR.",
    "Evite repetir as produções recentes, títulos genéricos e promessas enganosas.",
    request.modo === "PESQUISAR ANTES" ? "Pesquise sinais recentes antes de escolher as ideias." : "Priorize ideias rápidas, claras e visualmente fortes.",
    "",
    `DIREÇÃO OU TEMA: ${request.tema || "SEM TEMA — faça a descoberta automaticamente"}`,
    `FORMATO: ${request.formato}`,
    `QUANTIDADE DA PRODUÇÃO: ${request.quantidade}`,
    `MODO: ${request.modo}`,
    "",
    "PRODUÇÕES RECENTES A EVITAR:",
    recentText,
  ].join("\n");
}

function buildScriptPrompt(request: CorvoJobRequest) {
  return [
    "Transforme a ideia aprovada abaixo em um roteiro completo de quiz para o CorvoQuiz.",
    "Não volte para descoberta de ideias. Preserve o conceito aprovado.",
    "Entregue o roteiro final completo em texto, pronto para ser salvo como ROTEIRO.TXT e importado no Forma.",
    "Consulte e respeite o contrato técnico do Forma disponível no seu Knowledge.",
    "Textos destinados ao vídeo devem ser curtos, diretos e em MAIÚSCULAS.",
    "Valide respostas factuais e evite perguntas ambíguas.",
    "",
    `PROJETO: ${request.projetoId || "NÃO INFORMADO"}`,
    `TÍTULO APROVADO: ${request.titulo || "NÃO INFORMADO"}`,
    `TEMA APROVADO: ${request.tema || "NÃO INFORMADO"}`,
    `FORMATO: ${request.formato}`,
    `QUANTIDADE DA PRODUÇÃO: ${request.quantidade}`,
    `MODO: ${request.modo}`,
  ].join("\n");
}

function buildPromptImagesRequest(request: CorvoJobRequest) {
  return [
    "Leia o roteiro completo abaixo e determine todas as imagens que precisam ser procuradas para produzi-lo.",
    "Crie prompts de busca objetivos, visuais e sem texto na imagem.",
    "Respeite cada campo de imagem e cada cena do roteiro, incluindo duas imagens quando o preset exigir IMAGEM_A e IMAGEM_B.",
    "Retorne somente um TXT limpo, com uma busca por linha, exatamente no formato ID|PROMPT.",
    "Use IDs únicos e sequenciais como 01, 02, 03. Não use tabela, comentários ou bloco Markdown.",
    "Esse TXT será enviado diretamente ao Corvo Collector na etapa seguinte.",
    "",
    `PROJETO: ${request.projetoId || "NÃO INFORMADO"}`,
    `TÍTULO: ${request.titulo || "NÃO INFORMADO"}`,
    `TEMA: ${request.tema || "NÃO INFORMADO"}`,
    `FORMATO: ${request.formato}`,
    "",
    "ROTEIRO COMPLETO:",
    request.roteiro || "",
  ].join("\n");
}

function buildPrompt(request: CorvoJobRequest) {
  if (request.specialist === "ROTEIRO") return buildScriptPrompt(request);
  if (request.specialist === "PROMPTS") return buildPromptImagesRequest(request);
  return buildIdeasPrompt(request);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, message: "Origem não autorizada." }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, message: "Solicitação inválida." }, { status: 400 }); }

  const requestedSpecialist = text(body.specialist, 30).toUpperCase();
  const specialist: CorvoSpecialist = requestedSpecialist === "ROTEIRO" || requestedSpecialist === "PROMPTS" ? requestedSpecialist : "IDEIAS";
  const formato = body.format === "VÍDEO COMPLETO" ? "VÍDEO COMPLETO" : "REELS";
  const quantidade = body.quantity === "LOTE" ? "LOTE" : "1 VÍDEO";
  const modo = body.mode === "PESQUISAR ANTES" ? "PESQUISAR ANTES" : "RÁPIDO";
  const tema = text(body.tema, 300) || null;
  const titulo = text(body.titulo, 300);
  const projetoId = text(body.projetoId, 180);
  const roteiro = text(body.roteiro, 120_000);
  const recentes = Array.isArray(body.recentes) ? body.recentes.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const itemTitle = text(record.titulo, 180);
    const itemTopic = text(record.tema, 180);
    return itemTitle || itemTopic ? [{ titulo: itemTitle, tema: itemTopic }] : [];
  }).slice(0, 12) : [];

  if (specialist === "ROTEIRO" && (!titulo || !tema)) {
    return NextResponse.json({ ok: false, message: "Informe título e tema aprovados para criar o roteiro." }, { status: 400 });
  }
  if (specialist === "PROMPTS" && !roteiro) {
    return NextResponse.json({ ok: false, message: "O roteiro completo é obrigatório para gerar os prompts." }, { status: 400 });
  }

  const jobRequest: CorvoJobRequest = { specialist, tema, formato, quantidade, modo, recentes, projetoId, titulo, roteiro };
  try {
    const job = await createCorvoJob(jobRequest);
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status, specialist, prompt: buildPrompt(jobRequest) }, { status: 202 });
  } catch (error) {
    const message = error instanceof CorvoStorageError ? `${error.message} Conecte um Upstash Redis ao projeto na Vercel.` : "Não foi possível criar o trabalho.";
    return NextResponse.json({ ok: false, message }, { status: 503 });
  }
}
