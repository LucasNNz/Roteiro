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
    "REGRA DO PRESET OU: quando houver comparação A/B, use exatamente TIPO: QUAL_VOCE_PREFERE e informe dois arquivos físicos distintos, IMAGEM_A e IMAGEM_B. Nunca faça A e B apontarem para a mesma imagem e nunca transforme as duas opções em uma única colagem/painel.",
    "NOMES PARA COMPARAÇÃO: prefira nomes pareados e determinísticos com sufixos _A e _B (ex.: video1_01_A.png e video1_01_B.png), pois esses dois arquivos serão associados diretamente a IMAGEM_A e IMAGEM_B no Forma.",
    "REGRA DE CLASSIFICAÇÃO: toda pergunta visual do tipo 1 OU 2, A OU B, REAL OU IA, QUAL É REAL, QUAL É FALSO ou qualquer duelo entre duas imagens deve ser QUAL_VOCE_PREFERE. NÃO use EMOJI_QUIZ para esse caso, mesmo que exista uma resposta factual correta.",
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
    "Leia o roteiro completo abaixo e determine todas as imagens físicas que precisam ser procuradas para produzi-lo.",
    "Crie prompts de busca objetivos, visuais e sem texto na imagem.",
    "REGRA CRÍTICA DO PRESET OU / QUAL_VOCE_PREFERE: cada cena possui DOIS assets independentes. IMAGEM_A e IMAGEM_B jamais podem virar uma única imagem comparativa, colagem, split-screen ou painel.",
    "Para QUAL_VOCE_PREFERE devolva DUAS linhas por cena no formato <ID>_A|IMAGEM_A|NOME_EXATO_DO_ARQUIVO|PROMPT e <ID>_B|IMAGEM_B|NOME_EXATO_DO_ARQUIVO|PROMPT. Exemplo: 01_A|IMAGEM_A|q001-urso-real.jpg|urso polar real sozinho; 01_B|IMAGEM_B|q001-urso-ia.jpg|urso polar artificial sozinho.",
    "Para campos simples, mantenha compatibilidade com ID|PROMPT. Não transforme os sufixos _A e _B em novas perguntas: eles são slots de mídia da mesma cena.",
    "O prompt de cada slot deve descrever SOMENTE aquela opção e proibir a presença da opção oposta.",
    "Retorne somente TXT limpo, uma linha por asset físico. Não use tabela, comentários ou bloco Markdown.",
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
      "Este trabalho pode conter um LOTE de até 10 IDs/imagens. Processe TODOS os IDs recebidos na mesma conversa; não crie uma conversa separada por imagem.",
      "REGRA FÍSICA OBRIGATÓRIA: cada ID/SLOT deve resultar em UMA imagem/asset separado na conversa. IDs como 01_A e 01_B pertencem à mesma cena do preset QUAL_VOCE_PREFERE, mas são DOIS arquivos distintos para IMAGEM_A e IMAGEM_B.",
      "Nunca funda 01_A + 01_B numa única imagem, split-screen, grade, colagem, mosaico, contact sheet, storyboard ou painel. Refine cada slot visualmente como asset independente. Se a ferramenta exibir um contact sheet técnico, o manifesto ainda deve declarar os nomes físicos separados de cada slot.",
      "Refine somente as imagens aprovadas recebidas, preservando identidade, personagem, jogo, objeto e conceito.",
      "Quando ARQUIVO_SELECIONADO_IMUTAVEL estiver informado, use exatamente essa candidata e jamais a substitua por outro arquivo do mesmo ID.",
      "REFINAMENTO=LEVE pede melhoria técnica; REFINAMENTO=FORTE também pode reenquadrar para 16:9.",
      "Para cada ID devolva um bloco [ID:...] próprio. Cada imagem refinada é FINAL. Em falha de um item, informe ERROR_CODE e MOTIVO apenas naquele ID e continue os demais.",
      "Entregue o manifesto [CORVO_IMAGE_REFINEMENT] VERSION=1.1.",
    ],
    GERADOR: [
      "Este trabalho pode conter um LOTE de até 10 IDs LÓGICOS. Processe TODOS os IDs recebidos na mesma conversa; não abra ou peça uma conversa separada por item.",
      "REGRA FÍSICA OBRIGATÓRIA: cada imagem/opção descrita deve resultar em UM arquivo físico individual e separado. Nunca coloque duas imagens/opções no mesmo asset.",
      "Se um ID descrever uma comparação A/B, esquerda/direita, opção 1/2 ou duas imagens, gere dois assets físicos separados, identificados como ID_A e ID_B. A primeira imagem/opção corresponde ao slot _A e a segunda ao slot _B.",
      "Exemplo: 4 IDs lógicos com 2 opções cada devem resultar em 8 arquivos físicos individuais. Nunca gere A+B como comparação única, split-screen, grade, colagem, mosaico, contact sheet, storyboard ou painel final.",
      "Quando PADRAO_ARQUIVO_FINAL_A e PADRAO_ARQUIVO_FINAL_B estiverem presentes, use EXATAMENTE esses nomes para os dois arquivos físicos. PADRAO_ARQUIVO_FINAL é apenas o nome-base lógico da cena.",
      "Cada asset deve conter somente a imagem correspondente ao seu slot. Gere somente os IDs reprovados recebidos, respeitando PROMPT_GERACAO, identidade esperada e nomes finais.",
      "Cada imagem gerada com sucesso é FINAL e não deve voltar ao Refinador.",
      "ENTREGA EM ZIP: depois do lote, reúna adicionalmente todos os assets físicos gerados com sucesso em um único ZIP, sem transformar os arquivos individuais em colagem ou imagem única. As imagens individuais devem continuar existindo separadamente na conversa.",
      "No manifesto, devolva um bloco [ID:...] PARA CADA ASSET FÍSICO. Para comparação use [ID:01_A] e [ID:01_B], cada um com STATUS e ARQUIVO próprios. Se um asset falhar, informe ERROR_CODE e MOTIVO nele e continue os demais.",
      "No [TOTAL], diferencie IDS_LOGICOS e ASSETS_FISICOS quando houver comparações. Informe também ARQUIVO_ZIP se o ZIP tiver sido criado.",
      "Entregue o manifesto [CORVO_IMAGE_GENERATION] VERSION=1.1.",
    ],
    FALLBACK: [
      "Este trabalho pode conter um LOTE de até 10 falhas. Analise TODAS na mesma conversa, sem gerar ou editar imagens e sem tentar burlar políticas.",
      "Para cada ID decida RETRY ou NAO_RECUPERAVEL em seu próprio bloco [ID:...]. Em RETRY, informe DESTINO e PROMPT_RETRY completo.",
      "Se ERROR_CODE=BATCH_COMPOSITE_IMAGE, a falha é recuperável. Para preset QUAL_VOCE_PREFERE preserve os slots A/B: 01_A=IMAGEM_A e 01_B=IMAGEM_B. Use RETRY para a ORIGEM e proíba fundir os dois slots em um único asset final.",
      "ARQUIVO_SELECIONADO_IMUTAVEL, quando presente, é uma trava: o retry não pode trocar a candidata escolhida pelo Analista.",
      "Uma falha de um ID não deve impedir decisões para os demais IDs do lote.",
      "Entregue o manifesto [CORVO_IMAGE_FALLBACK] VERSION=1.0.",
    ],
    THUMB: request.formato === "REELS" ? [
      "Crie efetivamente UMA thumbnail VERTICAL 9:16, de leitura rápida, forte em tamanho pequeno e coerente com o CorvoQuiz.",
      "A composição final deve permanecer vertical 9:16. Não entregue thumbnail horizontal 16:9, mesmo que referências ou exemplos estejam em formato horizontal.",
      "A imagem deve permanecer disponível na conversa para captura pelo Corvo Bridge.",
      "Em sucesso, informe STATUS=GERADA, ARQUIVO, TIPO_ARQUIVO=THUMBNAIL, CONCEITO e TEXTO_THUMB.",
      "Entregue o manifesto [CORVO_THUMBNAIL] VERSION=1.1.",
    ] : [
      "Crie efetivamente UMA thumbnail HORIZONTAL 16:9, de leitura rápida, forte em tamanho pequeno e coerente com o CorvoQuiz.",
      "A composição final deve permanecer horizontal 16:9. Não entregue thumbnail vertical 9:16.",
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
