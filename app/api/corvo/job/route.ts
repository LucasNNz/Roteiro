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
    "Ordene as quatro ideias da mais promissora para a menos promissora. A IDEIA 1 deve ser sua recomendação principal e poderá ser escolhida automaticamente pelo CorvoQuiz.",
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
    "",
    "IDEIA APROVADA COMPLETA:",
    request.entrada || `TÍTULO: ${request.titulo || "NÃO INFORMADO"}\nTEMA: ${request.tema || "NÃO INFORMADO"}`,
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

function buildPipelinePrompt(request: CorvoJobRequest) {
  const contracts: Partial<Record<CorvoSpecialist, string[]>> = {
    ANALISTA: [
      "Analise o ZIP completo de candidatas do Collector e preserve todos os IDs.",
      "Para cada ID, localize e compare visualmente TODAS as candidatas antes de escolher uma melhor opção.",
      "Elimine imagens erradas e duplicatas inferiores. Não escolha pela ordem do arquivo.",
      "Classifique a candidata escolhida como PASSOU ou PASSOU_COM_RESSALVAS; se nenhuma servir, use NAO_PASSOU.",
      "Em PASSOU use REFINAMENTO=LEVE e informe ARQUIVO com o nome exato escolhido; em PASSOU_COM_RESSALVAS use REFINAMENTO=FORTE e informe ARQUIVO; em NAO_PASSOU deixe ARQUIVO vazio e forneça PROMPT_GERACAO.",
      "Entregue o manifesto [CORVO_IMAGE_ANALYSIS] VERSION=1.1.",
    ],
    REFINADOR: [
      "Este trabalho pode conter um LOTE de até 10 IDs/imagens. Processe TODOS os IDs recebidos na mesma conversa; não crie uma execução separada por imagem.",
      "Refine somente as imagens aprovadas recebidas, preservando identidade, personagem, jogo, objeto e conceito.",
      "Quando ARQUIVO_SELECIONADO_IMUTAVEL estiver informado, use exatamente essa candidata e jamais a substitua por outro arquivo do mesmo ID.",
      "REFINAMENTO=LEVE pede melhoria técnica; REFINAMENTO=FORTE também pode reenquadrar para 16:9.",
      "Para cada ID devolva um bloco [ID:...] próprio. Cada imagem refinada é FINAL. Em falha de um item, informe ERROR_CODE e MOTIVO apenas naquele ID e continue os demais.",
      "Entregue o manifesto [CORVO_IMAGE_REFINEMENT] VERSION=1.1.",
    ],
    GERADOR: [
      "Este trabalho pode conter um LOTE de até 10 IDs. Processe TODOS os IDs recebidos na mesma conversa; não abra ou peça uma execução separada por item.",
      "Gere somente os IDs reprovados recebidos, respeitando PROMPT_GERACAO, identidade esperada e nome final.",
      "Cada imagem gerada com sucesso é FINAL e não deve voltar ao Refinador.",
      "Para cada ID devolva um bloco [ID:...] próprio. Se um item falhar, informe ERROR_CODE e MOTIVO naquele ID e continue os demais.",
      "Entregue o manifesto [CORVO_IMAGE_GENERATION] VERSION=1.1.",
    ],
    FALLBACK: [
      "Este trabalho pode conter um LOTE de até 10 falhas. Analise TODAS na mesma conversa, sem gerar ou editar imagens e sem tentar burlar políticas.",
      "Para cada ID decida RETRY ou NAO_RECUPERAVEL em seu próprio bloco [ID:...]. Em RETRY, informe DESTINO e PROMPT_RETRY completo.",
      "ARQUIVO_SELECIONADO_IMUTAVEL, quando presente, é uma trava: o retry não pode trocar a candidata escolhida pelo Analista.",
      "Uma falha de um ID não deve impedir decisões para os demais IDs do lote.",
      "Entregue o manifesto [CORVO_IMAGE_FALLBACK] VERSION=1.0.",
    ],
    THUMB: [
      "Crie efetivamente UMA thumbnail horizontal 16:9, de leitura rápida, forte em tamanho pequeno e coerente com o CorvoQuiz.",
      "A imagem deve permanecer disponível na conversa para captura pelo Corvo Bridge.",
      "Em sucesso, informe STATUS=GERADA, ARQUIVO, TIPO_ARQUIVO=THUMBNAIL, CONCEITO e TEXTO_THUMB.",
      "Entregue o manifesto [CORVO_THUMBNAIL] VERSION=1.1.",
    ],
    YOUTUBE: [
      "Prepare o pacote editorial do vídeo sem publicar nada.",
      "Entregue o manifesto [CORVO_YOUTUBE_METADATA] VERSION=1.0.",
      "Inclua TITULO_FINAL, TITULO_ALTERNATIVO_1, TITULO_ALTERNATIVO_2, DESCRICAO, TAGS, HASHTAGS, CATEGORIA, PUBLICO, DATA_RECOMENDADA, HORARIO_RECOMENDADO e ESTRATEGIA_DE_PUBLICACAO.",
      "Não invente métricas do canal. Quando um dado não estiver disponível, deixe o valor vazio ou explique em ESTRATEGIA_DE_PUBLICACAO.",
    ],
  };
  return [
    ...(contracts[request.specialist] || []),
    "",
    `PROJETO: ${request.projetoId || "NÃO INFORMADO"}`,
    `TÍTULO: ${request.titulo || "NÃO INFORMADO"}`,
    `TEMA: ${request.tema || "NÃO INFORMADO"}`,
    `FORMATO: ${request.formato}`,
    `TENTATIVA_ATUAL: ${request.tentativaAtual || 1}`,
    request.origem ? `ORIGEM: ${request.origem}` : "",
    request.ids?.length ? `IDS: ${request.ids.join(",")}` : "",
    "",
    "ENTRADA COMPLETA:",
    request.entrada || request.roteiro || "",
  ].filter((line) => line !== "").join("\n");
}

function buildPrompt(request: CorvoJobRequest) {
  if (request.specialist === "ROTEIRO") return buildScriptPrompt(request);
  if (request.specialist === "PROMPTS") return buildPromptImagesRequest(request);
  if (!["IDEIAS", "ROTEIRO", "PROMPTS"].includes(request.specialist)) return buildPipelinePrompt(request);
  return buildIdeasPrompt(request);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, message: "Origem não autorizada." }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, message: "Solicitação inválida." }, { status: 400 }); }

  const requestedSpecialist = text(body.specialist, 30).toUpperCase();
  const specialists: CorvoSpecialist[] = ["IDEIAS", "ROTEIRO", "PROMPTS", "ANALISTA", "REFINADOR", "GERADOR", "FALLBACK", "THUMB", "YOUTUBE"];
  const specialist: CorvoSpecialist = specialists.includes(requestedSpecialist as CorvoSpecialist) ? requestedSpecialist as CorvoSpecialist : "IDEIAS";
  const formato = body.format === "VÍDEO COMPLETO" ? "VÍDEO COMPLETO" : "REELS";
  const quantidade = body.quantity === "LOTE" ? "LOTE" : "1 VÍDEO";
  const modo = body.mode === "PESQUISAR ANTES" ? "PESQUISAR ANTES" : "RÁPIDO";
  const tema = text(body.tema, 300) || null;
  const titulo = text(body.titulo, 300);
  const projetoId = text(body.projetoId, 180);
  const roteiro = text(body.roteiro, 120_000);
  const entrada = text(body.entrada, 300_000);
  const ids = Array.isArray(body.ids) ? body.ids.map((value) => text(value, 32)).filter(Boolean).slice(0, 500) : [];
  const tentativaAtual = Math.max(1, Math.min(3, Number(body.tentativaAtual) || 1));
  const origem = body.origem === "REFINADOR" ? "REFINADOR" : body.origem === "GERADOR" ? "GERADOR" : undefined;
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
  if (!["IDEIAS", "ROTEIRO", "PROMPTS"].includes(specialist) && !entrada && !roteiro) {
    return NextResponse.json({ ok: false, message: `A entrada completa é obrigatória para o especialista ${specialist}.` }, { status: 400 });
  }

  const jobRequest: CorvoJobRequest = { specialist, tema, formato, quantidade, modo, recentes, projetoId, titulo, roteiro, entrada, ids, tentativaAtual, origem };
  try {
    const job = await createCorvoJob(jobRequest);
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status, specialist, prompt: buildPrompt(jobRequest), uploadToken: job.uploadToken }, { status: 202 });
  } catch (error) {
    const message = error instanceof CorvoStorageError ? `${error.message} Conecte um Upstash Redis ao projeto na Vercel.` : "Não foi possível criar o trabalho.";
    return NextResponse.json({ ok: false, message }, { status: 503 });
  }
}
