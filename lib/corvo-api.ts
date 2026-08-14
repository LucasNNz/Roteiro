import { NextRequest, NextResponse } from "next/server";
import type { CorvoIdea } from "./corvo-jobs";

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

export function storageFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha no armazenamento de trabalhos.";
  return NextResponse.json({ ok: false, message }, { status: 503 });
}
