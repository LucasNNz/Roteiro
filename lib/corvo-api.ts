import { NextRequest, NextResponse } from "next/server";
import type { CorvoIdea } from "./corvo-jobs";
import { CorvoBlobReadError } from "./corvo-blob";

export function readApiKey(request: NextRequest) {
  const headerKey = request.headers.get("x-api-key")?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return headerKey || (authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "");
}

export function authorizeAction(request: NextRequest) {
  const expectedKey = process.env.CorvoAPI_KEY_IDEIA?.trim();
  if (!expectedKey) return NextResponse.json({ ok: false, message: "CorvoAPI_KEY_IDEIA não configurada no servidor." }, { status: 503 });
  if (readApiKey(request) !== expectedKey) return NextResponse.json({ ok: false, message: "Chave da API inválida." }, { status: 401 });
  return null;
}

export function normalizeIdeas(body: Record<string, unknown>): CorvoIdea[] {
  const source = Array.isArray(body.ideias) ? body.ideias : [{ tema: body.tema, titulo: body.titulo }];
  return source.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const tema = typeof record.tema === "string" ? record.tema.trim() : "";
    const titulo = typeof record.titulo === "string" ? record.titulo.trim() : "";
    if (!tema || !titulo) return [];
    return [{ tema: tema.slice(0, 180), titulo: titulo.slice(0, 180) }];
  }).slice(0, 6);
}

function cleanResultText(value: string) {
  return value
    .replace(/^[\s>*#-]+/, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ideasFromResult(resultado: string): CorvoIdea[] {
  const text = resultado.trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return normalizeIdeas({ ideias: parsed });
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const normalized = normalizeIdeas(record);
      if (normalized.length) return normalized;
    }
  } catch {}

  const titlePattern = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+[.)-]?\s*)?(?:🔥\s*)?\*{0,2}T[IÍ]TULO\*{0,2}\s*:\s*([^\n]+)/gi;
  const matches = [...text.matchAll(titlePattern)];
  const ideas = matches.flatMap((match, index) => {
    const titulo = cleanResultText(match[1] || "").slice(0, 180);
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const section = text.slice(start, end);
    const themeMatch = section.match(/(?:^|\n)\s*(?:[-*#>]\s*)?\*{0,2}(?:TEMA|CONCEITO|DESCRI[CÇ][AÃ]O)\*{0,2}\s*:\s*([^\n]+)/i);
    const tema = cleanResultText(themeMatch?.[1] || section.split("\n").find((line) => cleanResultText(line)) || titulo).slice(0, 180);
    return titulo && tema ? [{ titulo, tema }] : [];
  }).slice(0, 6);
  if (ideas.length) return ideas;

  const firstLine = cleanResultText(text.split("\n").find((line) => cleanResultText(line)) || "Resultado do Corvo");
  return [{ titulo: firstLine.slice(0, 180), tema: cleanResultText(text).slice(0, 180) }];
}

export function storageFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha no armazenamento de trabalhos.";
  const code = error instanceof CorvoBlobReadError ? error.code : (error instanceof Error ? error.message.split(":", 1)[0] : "STORAGE_FAILED");
  const status = error instanceof CorvoBlobReadError && error.status && error.status >= 400 && error.status < 600 ? error.status : 503;
  return NextResponse.json({
    ok:false,
    code,
    message,
    diagnostics:error instanceof CorvoBlobReadError ? error.diagnostics || [] : [],
    attempts:error instanceof CorvoBlobReadError ? error.attempts || [] : [],
    storageProvider:"R2",
  }, { status });
}
