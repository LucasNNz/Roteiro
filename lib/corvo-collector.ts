export const CORVO_COLLECTOR_EXTENSION_ID = "eaekknadnghlpncgbhnmldofajelmlbo";

export type SourceMode = "PINTEREST" | "GOOGLE" | "MIXED";
export type SelectionMode = "AUTO" | "MANUAL";
export type GuideItem = {
  id: string;
  query: string;
  formaField?: string;
  targetFile?: string;
  sceneId?: string;
  slot?: "A" | "B" | string;
};

export type Candidate = {
  previewUrl: string;
  url?: string;
  bestUrl?: string;
  urlCandidates?: string[];
  candidateCount?: number;
  width?: number;
  height?: number;
  source?: string;
  title?: string;
};

export type CandidateGroup = {
  id: string;
  query: string;
  count: number;
  providerMode?: SourceMode;
  pageTitle?: string;
  pageUrl?: string;
  candidates: Candidate[];
};

export type RankedGroup = CandidateGroup & {
  ranked: Array<{ candidate: Candidate; index: number; score: number }>;
  principalIndex: number;
  reserveIndices: number[];
  selectionMode: SelectionMode;
};

function cleanPromptParagraph(value: string) {
  return String(value || "")
    .replace(/^\s*```(?:text|txt)?\s*$/gim, "")
    .replace(/^\s*```\s*$/gim, "")
    .trim()
    // O contrato atual do Corvo usa 1 parágrafo = 1 asset físico. Quebras de
    // linha simples dentro do mesmo parágrafo são apenas wrapping visual e não
    // devem virar JOBs adicionais.
    .replace(/\s*\n\s*/g, " ")
    .replace(/[\t ]{2,}/g, " ")
    .trim();
}

export function isStructuredGuideText(text: string) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .some((line) => /^[#>*\-\s]*[A-Za-z0-9_-]+\s*\|\s*\S/.test(line.trim()));
}

type ChromeWindow = Window & {
  chrome?: {
    runtime?: {
      sendMessage?: (
        extensionId: string,
        message: unknown,
        callback: (response: unknown) => void,
      ) => void;
      lastError?: { message?: string };
    };
  };
};

export function parseGuideText(text: string): GuideItem[] {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  const lines = normalized.split("\n").map((line) => line.trim()).filter((line) => line && !/^```/.test(line));
  const pipeLines = lines.filter((line) => /^[#>*\-\s]*[A-Za-z0-9_-]+\s*\|\s*\S/.test(line));

  // Contrato novo: UM PARÁGRAFO = UMA IMAGEM FÍSICA, com uma linha em branco
  // entre prompts. Mantemos o parser antigo de ID|... para compatibilidade.
  let source:string[];
  if (pipeLines.length) {
    source = pipeLines;
  } else {
    const withoutFence = normalized
      .replace(/^\s*```(?:text|txt)?\s*$/gim, "")
      .replace(/^\s*```\s*$/gim, "")
      .trim();
    let paragraphs = withoutFence
      .split(/\n\s*\n+/)
      .map(cleanPromptParagraph)
      .filter((value) => value && !/^(prompts?|buscas?|imagens?)\s*:?\s*$/i.test(value));

    // Compatibilidade com TXT antigos sem linha vazia: se não houver nenhum
    // separador de parágrafo, cada linha não vazia continua sendo um prompt.
    if (paragraphs.length <= 1 && !/\n\s*\n/.test(withoutFence)) {
      const legacyLines = withoutFence
        .split("\n")
        .map(cleanPromptParagraph)
        .filter((value) => value && !/^(prompts?|buscas?|imagens?)\s*:?\s*$/i.test(value));
      if (legacyLines.length > 1) paragraphs = legacyLines;
    }
    source = paragraphs;
  }

  return source.map((line, index) => {
    const cleaned = line.replace(/^[#>*\-\s]+/, "").trim();
    const parts = cleaned.split("|").map((value) => value.trim());
    if (parts.length > 1) {
      const rawId = String(parts.shift() || "").trim();
      const slotMatch = rawId.match(/^(.+?)[_-](A|B)$/i);
      const normalizedScene = slotMatch && /^\d+$/.test(slotMatch[1]) ? slotMatch[1].padStart(2, "0") : slotMatch?.[1];
      const id = slotMatch ? `${normalizedScene}_${slotMatch[2].toUpperCase()}` : (/^\d+$/.test(rawId) ? rawId.padStart(2, "0") : rawId);
      const formaField = String(parts[0] || "").toUpperCase();
      if (parts.length >= 3 && /^IMAGEM(?:_[AB]|\d+|_RESULTADO)?$/.test(formaField)) {
        const targetFile = String(parts.shift() || "").trim();
        const fileName = String(parts.shift() || "").trim();
        return {
          id,
          formaField:targetFile,
          targetFile:fileName,
          sceneId:slotMatch ? normalizedScene : undefined,
          slot:slotMatch ? slotMatch[2].toUpperCase() : undefined,
          query:parts.join("|").trim(),
        };
      }
      return {
        id,
        query:parts.join("|").trim(),
        sceneId:slotMatch ? normalizedScene : undefined,
        slot:slotMatch ? slotMatch[2].toUpperCase() : undefined,
      };
    }
    const numbered = cleaned.match(/^(\d{1,4})\s*[.):\-]\s*(.+)$/);
    return numbered
      ? { id: numbered[1].padStart(2, "0"), query: numbered[2].trim() }
      : { id: String(index + 1).padStart(2, "0"), query: cleaned };
  }).filter((item) => item.query);
}

export function sendCollectorMessage<T>(
  type: string,
  payload?: unknown,
  extensionId = CORVO_COLLECTOR_EXTENSION_ID,
): Promise<T> {
  const chromeWindow = window as ChromeWindow;
  if (!chromeWindow.chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("COLLECTOR_NOT_AVAILABLE"));
  }
  return new Promise<T>((resolve, reject) => {
    chromeWindow.chrome?.runtime?.sendMessage?.(
      extensionId,
      { type, payload, protocol: "corvo-collector/1" },
      (response) => {
        const error = chromeWindow.chrome?.runtime?.lastError;
        if (error) reject(new Error(error.message || "COLLECTOR_CONNECTION_ERROR"));
        else resolve(response as T);
      },
    );
  });
}

export function candidateUrl(candidate?: Candidate) {
  return candidate?.bestUrl || candidate?.url || candidate?.previewUrl || "";
}

function candidatePriority(url?: string) {
  const lower = String(url || "").toLowerCase();
  let score = 0;
  if (lower.includes("googleusercontent.com")) score += 2000;
  if (lower.includes("gstatic.com")) score += 1500;
  if (lower.includes("pinimg.com")) {
    if (lower.includes("/originals/")) score += 100000;
    else if (lower.includes("/1200x/")) score += 90000;
    else if (lower.includes("/736x/")) score += 80000;
    else if (lower.includes("/564x/")) score += 70000;
    else if (lower.includes("/474x/")) score += 60000;
    else if (lower.includes("/236x/")) score += 10000;
  }
  return score;
}

export function scoreCandidate(candidate: Candidate, query: string) {
  const longSide = Math.max(Number(candidate.width || 0), Number(candidate.height || 0));
  const area = Number(candidate.width || 0) * Number(candidate.height || 0);
  const title = String(candidate.title || "").toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length >= 3);
  let score = candidatePriority(candidateUrl(candidate));
  score += longSide * 5 + Math.min(area / 100, 3000);
  score += Number(candidate.candidateCount || 0) * 20;
  score += tokens.filter((token) => title.includes(token)).length * 120;
  if ((candidate.source || "").toUpperCase() === "IMG") score += 60;
  if (longSide < 250) score -= 500;
  return Math.round(score);
}

export function rankGroups(groups: CandidateGroup[]): RankedGroup[] {
  return groups.filter(Boolean).map((group) => {
    const ranked = [...(group.candidates || [])]
      .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, group.query) }))
      .sort((a, b) => b.score - a.score);
    return {
      ...group,
      ranked,
      principalIndex: ranked[0]?.index ?? -1,
      reserveIndices: ranked.slice(1, 3).map((item) => item.index),
      selectionMode: "AUTO",
    };
  });
}

export function allCandidateUrls(group: RankedGroup) {
  const urls = group.candidates.flatMap((candidate) => [
    candidate.previewUrl,
    candidate.url,
    candidate.bestUrl,
    ...(candidate.urlCandidates || []),
  ]);
  return [...new Set(urls.map((url) => String(url || "").trim()).filter(Boolean))];
}


export function buildAnalystRawSelections(groups: RankedGroup[], prefix = "video1_", limitPerId = 10) {
  const selections: Array<{ id:string; query:string; outputName:string; urls:string[]; candidateIndex:number }> = [];
  const limit = Math.max(1, Math.min(30, Math.round(Number(limitPerId || 10))));
  for (const group of groups) {
    const safeId = String(group.id || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "_") || "ID";
    // O app NÃO escolhe a vencedora. Ele apenas cria uma shortlist técnica,
    // priorizando as candidatas já ranqueadas por resolução/fonte/relevância textual,
    // para que o Analista faça a decisão visual final entre várias opções reais.
    const ranked = group.ranked?.length
      ? group.ranked.slice(0, limit).map((item) => ({ candidate:item.candidate, originalIndex:item.index }))
      : (group.candidates || []).slice(0, limit).map((candidate, originalIndex) => ({ candidate, originalIndex }));
    ranked.forEach(({ candidate, originalIndex }, shortlistIndex) => {
      const urls = [
        ...(candidate.urlCandidates || []),
        candidate.bestUrl,
        candidate.url,
        candidate.previewUrl,
      ].map((value) => String(value || "").trim()).filter(Boolean);
      const uniqueUrls = [...new Set(urls)];
      if (!uniqueUrls.length) return;
      selections.push({
        id: String(group.id),
        query: group.query,
        outputName: `${prefix}${safeId}_c${String(shortlistIndex + 1).padStart(3, "0")}.jpg`,
        urls: uniqueUrls,
        candidateIndex: originalIndex + 1,
      });
    });
  }
  return selections;
}

export function buildFormaSelections(groups: RankedGroup[], prefix = "video1_") {
  return groups.map((group, index) => {
    const candidate = group.candidates[group.principalIndex];
    if (!candidate) return null;
    const urls = [
      ...(candidate.urlCandidates || []),
      candidate.bestUrl,
      candidate.url,
      candidate.previewUrl,
    ].filter(Boolean) as string[];
    return {
      id: group.id,
      query: group.query,
      outputName: `${prefix}${String(index + 1).padStart(2, "0")}.jpg`,
      urls: [...new Set(urls)],
    };
  }).filter(Boolean);
}
