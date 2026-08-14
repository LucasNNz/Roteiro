export const CORVO_COLLECTOR_EXTENSION_ID = "eaekknadnghlpncgbhnmldofajelmlbo";

export type SourceMode = "PINTEREST" | "GOOGLE" | "MIXED";
export type SelectionMode = "AUTO" | "MANUAL";
export type GuideItem = { id: string; query: string };

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
  const lines = text.split(/\n+/).map((line) => line.trim()).filter((line) => line && !/^```/.test(line));
  const pipeLines = lines.filter((line) => /^[#>*\-\s]*[A-Za-z0-9_-]+\s*\|\s*\S/.test(line));
  const source = pipeLines.length ? pipeLines : lines.filter((line) => !/^(prompts?|buscas?|imagens?)\s*:?s*$/i.test(line));
  return source.map((line, index) => {
    const cleaned = line.replace(/^[#>*\-\s]+/, "").trim();
    const parts = cleaned.split("|");
    if (parts.length > 1) return { id: String(parts.shift()).trim(), query: parts.join("|").trim() };
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
