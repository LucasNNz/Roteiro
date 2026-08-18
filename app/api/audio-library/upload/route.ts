import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { AUDIO_LIBRARY_KEY_HEADER, isSharedAudioLibraryKey } from "@/lib/audio/library-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 250 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/webm",
  "application/ogg",
];


function sameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function storageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function POST(request: Request) {
  if (!isSharedAudioLibraryKey(request.headers.get(AUDIO_LIBRARY_KEY_HEADER))) {
    return NextResponse.json({ code: "LIBRARY_KEY_INVALID", message: "A chave da biblioteca compartilhada do Forma não confere." }, { status: 401 });
  }
  if (!sameOriginRequest(request)) {
    return NextResponse.json({ code: "ORIGIN_NOT_ALLOWED", message: "Este upload só pode ser iniciado pelo próprio Forma." }, { status: 403 });
  }
  if (!storageConfigured()) {
    return NextResponse.json({ code: "BLOB_NOT_CONFIGURED", message: "Conecte um Vercel Blob Store ao projeto Forma antes de sincronizar." }, { status: 503 });
  }
  try {
    const body = await request.json() as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname.startsWith("forma/audio/assets/")) throw new Error("Caminho de upload não permitido.");
        let payload: { assetId?: string; scope?: string } = {};
        try { payload = clientPayload ? JSON.parse(clientPayload) as typeof payload : {}; } catch {}
        if (payload.scope !== "scene" && payload.scope !== "project") throw new Error("Tipo de áudio inválido.");
        return {
          allowedContentTypes: ALLOWED_AUDIO_TYPES,
          maximumSizeInBytes: MAX_AUDIO_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60 * 60 * 24 * 365,
          tokenPayload: JSON.stringify({ assetId: payload.assetId || null, scope: payload.scope }),
        };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível autorizar o upload do áudio.";
    return NextResponse.json({ code: "BLOB_UPLOAD_FAILED", message }, { status: 400 });
  }
}
