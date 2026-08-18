import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { audioLibrarySummary, parseCloudAudioLibrary } from "@/lib/audio/cloud-library";
import { AUDIO_LIBRARY_KEY_HEADER, isSharedAudioLibraryKey, SHARED_AUDIO_LIBRARY_KEY } from "@/lib/audio/library-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METADATA_PATH = "forma/audio/library-v1.json";
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

function libraryKeyAllowed(request: Request) {
  return isSharedAudioLibraryKey(request.headers.get(AUDIO_LIBRARY_KEY_HEADER));
}

function invalidLibraryKey() {
  return NextResponse.json({
    code: "LIBRARY_KEY_INVALID",
    message: "A chave da biblioteca compartilhada do Forma não confere.",
    libraryKey: SHARED_AUDIO_LIBRARY_KEY,
  }, { status: 401, headers: { "cache-control": "no-store" } });
}


function sameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function forbiddenOrigin() {
  return NextResponse.json({
    code: "ORIGIN_NOT_ALLOWED",
    message: "Esta operação de sincronização só pode ser iniciada pelo próprio Forma.",
  }, { status: 403, headers: { "cache-control": "no-store" } });
}

function storageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function notConfigured() {
  return NextResponse.json({
    code: "BLOB_NOT_CONFIGURED",
    message: "A nuvem do Forma ainda não está conectada a um Vercel Blob Store.",
    backend: "vercel-blob",
    configured: false,
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

function isPortableSource(src: unknown) {
  if (typeof src !== "string" || !src) return true;
  return !src.startsWith("data:") && !src.startsWith("blob:") && !src.startsWith("file:");
}

function libraryContainsOnlyCloudReferences(library: NonNullable<ReturnType<typeof parseCloudAudioLibrary>>) {
  if (library.sceneLibrary.assets.some((asset) => !isPortableSource(asset.src))) return false;
  return library.projectPresets.every((preset) => preset.tracks.every((track) => track.clips.every((clip) => isPortableSource(clip.src) && isPortableSource(clip.cloudSrc))));
}

async function findMetadataBlob() {
  const result = await list({ prefix: METADATA_PATH, limit: 10 });
  return result.blobs.find((blob) => blob.pathname === METADATA_PATH) ?? result.blobs[0] ?? null;
}

export async function GET(request: Request) {
  if (!libraryKeyAllowed(request)) return invalidLibraryKey();
  if (!storageConfigured()) return notConfigured();
  try {
    const blob = await findMetadataBlob();
    if (!blob) {
      return NextResponse.json({ library: null, backend: "vercel-blob", libraryKey: SHARED_AUDIO_LIBRARY_KEY, configured: true, empty: true }, { headers: { "cache-control": "no-store" } });
    }
    const response = await fetch(blob.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Não foi possível ler a metadata da biblioteca (${response.status}).`);
    const library = parseCloudAudioLibrary(await response.json().catch(() => null));
    if (!library) throw new Error("A biblioteca salva na nuvem está inválida.");
    return NextResponse.json({
      library,
      ...audioLibrarySummary(library),
      backend: "vercel-blob",
      libraryKey: SHARED_AUDIO_LIBRARY_KEY,
      configured: true,
      updatedAt: library.updatedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível ler a biblioteca na nuvem.";
    return NextResponse.json({ code: "BLOB_READ_FAILED", message, backend: "vercel-blob", configured: true }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  if (!libraryKeyAllowed(request)) return invalidLibraryKey();
  if (!sameOriginRequest(request)) return forbiddenOrigin();
  if (!storageConfigured()) return notConfigured();
  const announcedSize = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(announcedSize) && announcedSize > MAX_METADATA_BYTES) {
    return NextResponse.json({ code: "METADATA_TOO_LARGE", message: "A metadata da biblioteca excedeu o limite de segurança." }, { status: 413 });
  }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_METADATA_BYTES) {
      return NextResponse.json({ code: "METADATA_TOO_LARGE", message: "A metadata da biblioteca excedeu o limite de segurança." }, { status: 413 });
    }
    const library = parseCloudAudioLibrary(JSON.parse(raw));
    if (!library) return NextResponse.json({ code: "INVALID_LIBRARY", message: "Biblioteca de áudio inválida." }, { status: 400 });
    if (!libraryContainsOnlyCloudReferences(library)) {
      return NextResponse.json({ code: "INLINE_AUDIO_BLOCKED", message: "A metadata ainda contém áudio embutido. Envie os arquivos ao Blob antes de salvar a biblioteca." }, { status: 400 });
    }

    const currentBlob = await findMetadataBlob();
    let currentLibrary = null;
    if (currentBlob) {
      const currentResponse = await fetch(currentBlob.url, { cache: "no-store" });
      if (currentResponse.ok) currentLibrary = parseCloudAudioLibrary(await currentResponse.json().catch(() => null));
    }
    const baseUpdatedAt = request.headers.get("x-forma-cloud-base") || "";
    if (currentLibrary && baseUpdatedAt !== currentLibrary.updatedAt) {
      return NextResponse.json({
        code: "CLOUD_VERSION_CONFLICT",
        message: "A biblioteca mudou em outro aparelho desde a última sincronização.",
        library: currentLibrary,
        updatedAt: currentLibrary.updatedAt,
        ...audioLibrarySummary(currentLibrary),
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }

    await put(METADATA_PATH, JSON.stringify(library), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
    });

    return NextResponse.json({
      ok: true,
      ...audioLibrarySummary(library),
      backend: "vercel-blob",
      libraryKey: SHARED_AUDIO_LIBRARY_KEY,
      configured: true,
      updatedAt: library.updatedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar a biblioteca na nuvem.";
    return NextResponse.json({ code: "BLOB_WRITE_FAILED", message, backend: "vercel-blob", configured: true }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
