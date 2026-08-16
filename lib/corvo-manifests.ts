export type CorvoManifestKind =
  | "ANALYSIS"
  | "REFINEMENT"
  | "GENERATION"
  | "FALLBACK"
  | "THUMBNAIL"
  | "YOUTUBE"
  | "UNKNOWN";

export type CorvoManifestItem = {
  id: string;
  status?: string;
  file?: string;
  reason?: string;
  refinement?: "LEVE" | "FORTE" | string;
  generationPrompt?: string;
  errorCode?: string;
  origin?: "GERADOR" | "REFINADOR" | string;
  destination?: "GERADOR" | "REFINADOR" | string;
  retryPrompt?: string;
};

export type CorvoManifestSummary = {
  kind: CorvoManifestKind;
  version?: string;
  status?: string;
  expectedFile?: string;
  expectedFiles?: string[];
  expectsBridgeFile: boolean;
  failed: boolean;
  errorCode?: string;
  reason?: string;
  items?: CorvoManifestItem[];
};

function field(text: string, name: string) {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*=\\s*([^\\n\\r]*)`, "i"));
  return match?.[1]?.trim() || undefined;
}

function sectionField(text: string, name: string) {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*=\\s*([^\\n\\r]*)`, "i"));
  return match?.[1]?.trim() || undefined;
}

function parseItems(text: string): CorvoManifestItem[] {
  const matches = [...text.matchAll(/(?:^|\n)\s*\[ID:([^\]]+)\]\s*\n?/gi)];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.search(/(?:^|\n)\s*\[END\]/i);
    const body = text.slice(start, end >= 0 ? end : text.length);
    const status = sectionField(body, "STATUS")?.toUpperCase();
    const refinement = sectionField(body, "REFINAMENTO")?.toUpperCase();
    const origin = sectionField(body, "ORIGEM")?.toUpperCase();
    const destination = sectionField(body, "DESTINO")?.toUpperCase();
    return {
      id: String(match[1] || "").trim(),
      status,
      file: sectionField(body, "ARQUIVO"),
      reason: sectionField(body, "MOTIVO"),
      refinement,
      generationPrompt: sectionField(body, "PROMPT_GERACAO"),
      errorCode: sectionField(body, "ERROR_CODE")?.toUpperCase(),
      origin,
      destination,
      retryPrompt: sectionField(body, "PROMPT_RETRY"),
    };
  }).filter((item) => item.id);
}

export function parseCorvoManifest(resultado: string): CorvoManifestSummary {
  const text = resultado.trim();
  const header = text.match(/^\s*\[CORVO_([A-Z_]+)\]/i)?.[1]?.toUpperCase() || "";
  const kind: CorvoManifestKind = header === "IMAGE_ANALYSIS"
    ? "ANALYSIS"
    : header === "IMAGE_REFINEMENT"
      ? "REFINEMENT"
      : header === "IMAGE_GENERATION"
        ? "GENERATION"
        : header === "IMAGE_FALLBACK"
          ? "FALLBACK"
          : header === "THUMBNAIL"
            ? "THUMBNAIL"
            : header.includes("YOUTUBE")
              ? "YOUTUBE"
              : "UNKNOWN";
  const status = field(text, "STATUS")?.toUpperCase();
  const expectedFile = field(text, "ARQUIVO");
  const errorCode = field(text, "ERROR_CODE")?.toUpperCase();
  const reason = field(text, "MOTIVO");
  const items = parseItems(text);
  const failed = status === "FALHOU"
    || items.some((item) => item.status === "FALHOU")
    || /(?:^|\n)\s*STATUS\s*=\s*FALHOU\s*(?:\n|$)/i.test(text);
  const successfulOutputFiles = items
    .filter((item) => (kind === "GENERATION" && item.status === "GERADA") || (kind === "REFINEMENT" && item.status === "REFINADA"))
    .map((item) => item.file)
    .filter((value): value is string => Boolean(value));
  const expectedFiles = successfulOutputFiles.length
    ? successfulOutputFiles
    : expectedFile ? [expectedFile] : [];
  const expectsBridgeFile = (
    (kind === "THUMBNAIL" && status === "GERADA")
    || (kind === "GENERATION" && successfulOutputFiles.length > 0)
    || (kind === "REFINEMENT" && successfulOutputFiles.length > 0)
  ) && expectedFiles.length > 0;

  return {
    kind,
    version: field(text, "VERSION"),
    status,
    expectedFile: expectedFiles[0],
    expectedFiles,
    expectsBridgeFile,
    failed: kind === "GENERATION" || kind === "REFINEMENT" ? items.length > 0 && items.every((item) => item.status === "FALHOU") : failed,
    errorCode: errorCode || (items.length === 1 ? items[0].errorCode : undefined),
    reason: reason || (items.length === 1 ? items[0].reason : undefined),
    items,
  };
}
