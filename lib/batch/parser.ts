export type BatchQuizKind = "three_options" | "true_false" | "emoji_quiz" | "would_you_rather" | "find_thief" | "chase_lr";
export type BatchGameOutcome = "correct" | "wrong";
export type BatchIssue = { level: "error" | "warning"; message: string; question?: number };
export type BatchQuizQuestion = {
  number: number;
  kind: BatchQuizKind;
  question: string;
  answers: { A: string; B: string; C?: string };
  correct: "A" | "B" | "C" | "green" | "red" | "none";
  outcome?: BatchGameOutcome;
  resultText?: string;
  imageFile?: string;
  imageSrc?: string;
  image1File?: string;
  image1Src?: string;
  image2File?: string;
  image2Src?: string;
  resultImageFile?: string;
  resultImageSrc?: string;
};
export type BatchQuizPlan = {
  projectName: string;
  includeIntro: boolean;
  includeTransitions: boolean;
  questions: BatchQuizQuestion[];
  issues: BatchIssue[];
};

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const yes = (value: unknown, fallback: boolean) => {
  const key = normalize(value);
  if (["sim", "s", "yes", "true", "1", "ativo"].includes(key)) return true;
  if (["nao", "n", "no", "false", "0", "desligado"].includes(key)) return false;
  return fallback;
};
const read = (record: Record<string, string>, ...keys: string[]) => keys.map((key) => record[normalize(key)]).find((value) => value?.trim())?.trim();

function recordsFromText(text: string) {
  const globals: Record<string, string> = {};
  const sections: Array<Record<string, string>> = [];
  let target = globals;
  let previousKey = "";
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      target = {};
      sections.push(target);
      previousKey = "";
      continue;
    }
    const separator = line.indexOf(":");
    if (separator > 0) {
      previousKey = normalize(line.slice(0, separator));
      target[previousKey] = line.slice(separator + 1).trim();
    } else if (previousKey) {
      target[previousKey] = `${target[previousKey]} ${line}`.trim();
    }
  }
  return { globals, sections };
}

function quizKind(value: unknown): BatchQuizKind {
  const key = normalize(value);
  if (["ache_o_ladrao", "ache_ladrao", "ladrao_ab", "find_thief", "game_find_thief", "game_find_thief_ab"].includes(key)) return "find_thief";
  if (["perseguicao", "perseguicao_esquerda_direita", "corrida_esquerda_direita", "chase_lr", "game_chase", "game_chase_lr"].includes(key)) return "chase_lr";
  if (["emoji_quiz", "quiz_emoji", "quiz_emojis", "emojis", "descubra_pelos_emojis", "descubra_emojis"].includes(key)) return "emoji_quiz";
  if (["qual_voce_prefere", "o_que_voce_prefere", "voce_prefere", "would_you_rather", "prefere"].includes(key)) return "would_you_rather";
  if (key.includes("verdadeiro") || key.includes("falso") || ["vf", "v_f", "true_false"].includes(key)) return "true_false";
  return "three_options";
}

function gameOutcome(value: unknown): BatchGameOutcome {
  const key = normalize(value);
  if (["errado", "errada", "erro", "falha", "fail", "wrong", "incorreto", "incorreta", "perdeu", "escape"].includes(key)) return "wrong";
  return "correct";
}

function warnMissingImage(issues: BatchIssue[], number: number, fieldLabel: string) {
  issues.push({ level: "warning", question: number, message: `${fieldLabel}: imagem não informada; o preset manterá a imagem padrão.` });
}

function parseGameAB(record: Record<string, string>, number: number, kind: "find_thief" | "chase_lr", question: string, issues: BatchIssue[]): BatchQuizQuestion {
  const isThief = kind === "find_thief";
  const A = read(record, "a", "alternativa_a", "esquerda", "texto1", "texto_1") ?? (isThief ? "A · SUSPEITO 1" : "ESQUERDA");
  const B = read(record, "b", "alternativa_b", "direita", "texto2", "texto_2") ?? (isThief ? "B · SUSPEITO 2" : "DIREITA");
  const rawCorrect = normalize(read(record, "correta", "resposta", "correct"));
  const correctA = ["a", "1", "esquerda", "left", "suspeito_1", "personagem_1"].includes(rawCorrect);
  const correctB = ["b", "2", "direita", "right", "suspeito_2", "personagem_2"].includes(rawCorrect);
  if (!correctA && !correctB) issues.push({ level: "error", question: number, message: isThief ? "A resposta correta precisa ser A ou B." : "A resposta correta precisa ser ESQUERDA/A ou DIREITA/B." });

  const imageFile = read(record, "cenario", "imagem_cenario", "fundo", "imagem_fundo", "scene", "background", "imagem");
  const image1File = isThief
    ? read(record, "personagem_a", "suspeito_a", "suspeito_1", "imagem_a", "imagem1", "imagem_1", "image1")
    : read(record, "ladrao", "alvo", "target", "personagem_a", "imagem_a", "imagem1", "imagem_1", "image1");
  const image2File = isThief
    ? read(record, "personagem_b", "suspeito_b", "suspeito_2", "imagem_b", "imagem2", "imagem_2", "image2")
    : read(record, "policial", "perseguidor", "pursuer", "personagem_b", "imagem_b", "imagem2", "imagem_2", "image2");
  if (!imageFile) warnMissingImage(issues, number, "Cenário");
  if (!image1File) warnMissingImage(issues, number, isThief ? "Personagem A" : "Ladrão/alvo");
  if (!image2File) warnMissingImage(issues, number, isThief ? "Personagem B" : "Perseguidor");

  const explicitOutcome = read(record, "desfecho", "estado_resultado", "resultado_tipo", "outcome");
  const resultValue = read(record, "resultado");
  const resultAsOutcome = resultValue && ["correto", "correta", "acerto", "acertou", "success", "certo", "errado", "errada", "erro", "falha", "fail", "wrong", "incorreto", "incorreta"].includes(normalize(resultValue)) ? resultValue : undefined;
  const outcome = gameOutcome(explicitOutcome ?? resultAsOutcome);
  const resultText = read(record, "texto_resultado", "mensagem_resultado", "result_text", "result_message") ?? (resultAsOutcome ? undefined : resultValue);

  return {
    number,
    kind,
    question,
    answers: { A, B },
    correct: correctB ? "B" : "A",
    outcome,
    ...(resultText ? { resultText } : {}),
    ...(imageFile ? { imageFile } : {}),
    ...(image1File ? { image1File } : {}),
    ...(image2File ? { image2File } : {}),
  };
}

export function parseBatchQuizText(text: string): BatchQuizPlan {
  const issues: BatchIssue[] = [];
  const { globals, sections } = recordsFromText(text);
  if (!sections.length) issues.push({ level: "error", message: "Nenhuma pergunta encontrada. Separe cada pergunta com [1], [2]…" });
  if (sections.length > 100) issues.push({ level: "error", message: "O lote aceita no máximo 100 perguntas por vez." });
  const questions = sections.slice(0, 100).map((record, index): BatchQuizQuestion => {
    const number = index + 1;
    const kind = quizKind(read(record, "tipo"));
    const question = read(record, "pergunta", "titulo") ?? "";
    if (!question) issues.push({ level: "error", question: number, message: "Pergunta não informada." });

    if (kind === "find_thief" || kind === "chase_lr") return parseGameAB(record, number, kind, question, issues);

    if (kind === "three_options") {
      const imageFile = read(record, "imagem", "arquivo", "image");
      if (!imageFile) warnMissingImage(issues, number, "Imagem");
      const A = read(record, "a", "alternativa_a") ?? "";
      const B = read(record, "b", "alternativa_b") ?? "";
      const C = read(record, "c", "alternativa_c") ?? "";
      if (!A || !B || !C) issues.push({ level: "error", question: number, message: "Informe as alternativas A, B e C." });
      const answer = String(read(record, "correta", "resposta", "correct") ?? "").trim().toUpperCase();
      if (!["A", "B", "C"].includes(answer)) issues.push({ level: "error", question: number, message: "A resposta correta precisa ser A, B ou C." });
      return { number, kind, question, answers: { A, B, C }, correct: (["A", "B", "C"].includes(answer) ? answer : "A") as "A" | "B" | "C", ...(imageFile ? { imageFile } : {}) };
    }

    if (kind === "true_false") {
      const imageFile = read(record, "imagem", "arquivo", "image");
      if (!imageFile) warnMissingImage(issues, number, "Imagem");
      const A = read(record, "verde", "verdadeiro", "true", "a") ?? "VERDADEIRO";
      const B = read(record, "vermelho", "falso", "false", "b") ?? "FALSO";
      const answer = normalize(read(record, "correta", "resposta", "correct"));
      const red = ["vermelho", "falso", "false", "red", "b"].includes(answer);
      const green = ["verde", "verdadeiro", "true", "green", "a"].includes(answer);
      if (!red && !green) issues.push({ level: "error", question: number, message: "A resposta correta precisa ser VERDE/VERDADEIRO ou VERMELHO/FALSO." });
      return { number, kind, question, answers: { A, B }, correct: red ? "red" : "green", ...(imageFile ? { imageFile } : {}) };
    }

    if (kind === "emoji_quiz") {
      const image1File = read(record, "imagem1", "imagem_1", "emoji1", "emoji_1", "image1", "image_1");
      const image2File = read(record, "imagem2", "imagem_2", "emoji2", "emoji_2", "image2", "image_2");
      const resultText = read(record, "resultado", "resposta", "result", "result_text", "texto_resultado") ?? "";
      const resultImageFile = read(record, "imagem_resultado", "resultado_imagem", "result_image", "resultimage", "imagemresultado");
      if (!image1File) warnMissingImage(issues, number, "Imagem 1");
      if (!image2File) warnMissingImage(issues, number, "Imagem 2");
      if (!resultText) issues.push({ level: "error", question: number, message: "Informe RESULTADO com o texto revelado pelo preset de emojis." });
      return {
        number,
        kind,
        question,
        answers: { A: "", B: "" },
        correct: "none",
        resultText,
        ...(image1File ? { image1File } : {}),
        ...(image2File ? { image2File } : {}),
        ...(resultImageFile ? { resultImageFile } : {}),
      };
    }

    const A = read(record, "a", "esquerda", "texto1", "texto_1", "left", "left_text") ?? "";
    const B = read(record, "b", "direita", "texto2", "texto_2", "right", "right_text") ?? "";
    const image1File = read(record, "imagem_a", "imagem1", "imagem_1", "image_a", "image1", "left_image", "imagem_esquerda");
    const image2File = read(record, "imagem_b", "imagem2", "imagem_2", "image_b", "image2", "right_image", "imagem_direita");
    if (!A || !B) issues.push({ level: "error", question: number, message: "Informe as duas opções A e B para QUAL_VOCE_PREFERE." });
    if (!image1File) warnMissingImage(issues, number, "Imagem A");
    if (!image2File) warnMissingImage(issues, number, "Imagem B");
    return {
      number,
      kind,
      question,
      answers: { A, B },
      correct: "none",
      ...(image1File ? { image1File } : {}),
      ...(image2File ? { image2File } : {}),
    };
  });
  return {
    projectName: (read(globals, "projeto", "nome") ?? "Quiz em lote").slice(0, 80),
    includeIntro: yes(read(globals, "entrada"), true),
    includeTransitions: yes(read(globals, "transicoes", "transição", "transicao"), true),
    questions,
    issues,
  };
}

export const BATCH_TXT_EXAMPLE = `PROJETO: Quiz CorvoQuiz
ENTRADA: SIM
TRANSICOES: SIM

[1]
TIPO: 3_OPCOES
PERGUNTA: Qual destes animais consegue imitar a voz humana?
A: CORVO
B: COELHO
C: GALINHA
CORRETA: A
IMAGEM: 001-corvo.png

[2]
TIPO: VERDADEIRO_FALSO
PERGUNTA: O pinguim consegue voar?
VERDE: VERDADEIRO
VERMELHO: FALSO
CORRETA: FALSO
IMAGEM: 002-pinguim.jpg

[3]
TIPO: EMOJI_QUIZ
PERGUNTA: DESCUBRA PELOS EMOJIS
IMAGEM1: 003-fogo.png
IMAGEM2: 003-mao.png
RESULTADO: CONTROLAR FOGO
IMAGEM_RESULTADO: 003-controlar-fogo.jpg

[4]
TIPO: QUAL_VOCE_PREFERE
PERGUNTA: QUAL VOCÊ PREFERE?
A: VOAR
B: SUPER VELOCIDADE
IMAGEM_A: 004-voar.jpg
IMAGEM_B: 004-velocidade.jpg

[5]
TIPO: ACHE_O_LADRAO
PERGUNTA: QUAL DOS DOIS É O LADRÃO?
A: A · SUSPEITO 1
B: B · SUSPEITO 2
CORRETA: B
DESFECHO: CORRETA
CENARIO: 005-rua.jpg
PERSONAGEM_A: 005-suspeito-a.png
PERSONAGEM_B: 005-suspeito-b.png
TEXTO_RESULTADO: ACERTOU! ERA B · SUSPEITO 2

[6]
TIPO: PERSEGUICAO
PERGUNTA: PARA QUAL LADO ELE FUGIU?
A: ESQUERDA
B: DIREITA
CORRETA: DIREITA
DESFECHO: ERRADA
CENARIO: 006-rua.jpg
LADRAO: 006-ladrao.png
POLICIAL: 006-policial.png
TEXTO_RESULTADO: O CERTO ERA DIREITA
`;
