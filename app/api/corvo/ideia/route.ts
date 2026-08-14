import { NextRequest, NextResponse } from "next/server";

type CorvoIdea = { tema:string; titulo:string };

function readApiKey(request:NextRequest) {
  const headerKey = request.headers.get("x-api-key")?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return headerKey || (authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "");
}

function normalizeIdeas(body:Record<string, unknown>):CorvoIdea[] {
  const source = Array.isArray(body.ideias) ? body.ideias : [{ tema:body.tema, titulo:body.titulo }];
  return source.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const tema = typeof record.tema === "string" ? record.tema.trim() : "";
    const titulo = typeof record.titulo === "string" ? record.titulo.trim() : "";
    if (!tema) return [];
    return [{ tema:tema.slice(0, 180), titulo:(titulo || tema).slice(0, 180) }];
  }).slice(0, 6);
}

export async function POST(request:NextRequest) {
  const expectedKey = process.env.CorvoAPI_KEY_IDEIA?.trim();
  if (!expectedKey) return NextResponse.json({ ok:false, message:"CorvoAPI_KEY_IDEIA não configurada no servidor." }, { status:503 });
  if (readApiKey(request) !== expectedKey) return NextResponse.json({ ok:false, message:"Chave da API inválida." }, { status:401 });

  let body:Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok:false, message:"JSON inválido." }, { status:400 }); }

  const ideias = normalizeIdeas(body);
  if (!ideias.length) return NextResponse.json({ ok:false, message:"Envie tema/titulo ou uma lista de ideias." }, { status:400 });

  const id = `corvo_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const token = Buffer.from(JSON.stringify(ideias), "utf8").toString("base64url");
  const appUrl = new URL(request.url);
  appUrl.pathname = "/";
  appUrl.search = `?ideias=${token}`;
  appUrl.hash = "";

  return NextResponse.json({
    ok:true,
    id,
    message:`${ideias.length} ideia${ideias.length === 1 ? "" : "s"} pronta${ideias.length === 1 ? "" : "s"}. Abra appUrl para selecionar no CorvoQuiz.`,
    appUrl:appUrl.toString(),
    ideias,
  });
}

export async function GET() {
  return NextResponse.json({ ok:true, service:"CorvoQuiz Ideias", version:"1.0.0" });
}
