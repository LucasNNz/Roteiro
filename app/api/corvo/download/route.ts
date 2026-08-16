import { NextRequest, NextResponse } from "next/server";
import { getCorvoJob } from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";
import { CorvoBlobReadError, corvoBlobPathname, openCorvoBlob } from "../../../../lib/corvo-blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROXY_FILE_SIZE = 480 * 1024 * 1024;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "x-corvo-upload-token, content-type",
    "Access-Control-Expose-Headers": "content-type, content-length, content-disposition, etag, x-corvo-download-source",
    "Cache-Control": "no-store",
  };
}

function safeDownloadName(value: string) {
  const cleaned = value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180);
  return cleaned || "corvo-arquivo";
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() || "";
  const rawUrl = request.nextUrl.searchParams.get("url")?.trim() || "";
  const requestedName = safeDownloadName(request.nextUrl.searchParams.get("name") || "");
  const token = request.headers.get("x-corvo-upload-token")?.trim() || request.nextUrl.searchParams.get("token")?.trim() || "";

  if (!jobId || !token || !rawUrl) {
    return NextResponse.json({ ok: false, message: "Informe jobId, token e url do arquivo." }, { status: 400, headers: corsHeaders() });
  }

  const key = corvoBlobPathname(rawUrl);
  if (!key || !key.startsWith(`corvoquiz/${jobId}/`)) {
    return NextResponse.json({ ok: false, message: "Objeto R2 não permitido para este trabalho." }, { status: 400, headers: corsHeaders() });
  }

  try {
    const job = await getCorvoJob(jobId);
    if (!job || !job.uploadToken || job.uploadToken !== token) {
      return NextResponse.json({ ok: false, message: "Trabalho ou token inválido." }, { status: 404, headers: corsHeaders() });
    }

    const result:any = await openCorvoBlob(rawUrl);
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ ok: false, message: "Arquivo não encontrado no Cloudflare R2." }, { status: 404, headers: corsHeaders() });
    }

    const size = Number(result.blob?.size || 0);
    if (size > MAX_PROXY_FILE_SIZE) {
      return NextResponse.json({ ok: false, message: "Arquivo grande demais para envio ao ChatGPT." }, { status: 413, headers: corsHeaders() });
    }

    const fileName = requestedName || safeDownloadName(result.blob.pathname.split("/").at(-1) || "corvo-arquivo");
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", result.blob.contentType || "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename="${fileName.replaceAll('"', "")}"`);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Corvo-Download-Source", String(result.source || "cloudflare-r2-proxy"));
    if (size) headers.set("Content-Length", String(size));
    if (result.blob.etag) headers.set("ETag", result.blob.etag);

    return new NextResponse(result.stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof CorvoBlobReadError) {
      return NextResponse.json({ ok:false, code:error.code, message:error.message, attempts:error.attempts }, { status:error.status === 403 ? 503 : 502, headers:corsHeaders() });
    }
    const fallback = storageFailure(error);
    const headers = new Headers(fallback.headers);
    for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
    return new NextResponse(fallback.body, { status: fallback.status, statusText: fallback.statusText, headers });
  }
}
