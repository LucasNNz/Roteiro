import { put } from "@vercel/blob";
import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { attachCorvoFile, getCorvoJob } from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 160);
}

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 }); }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const token = request.headers.get("x-corvo-upload-token")?.trim() || (typeof body.uploadToken === "string" ? body.uploadToken.trim() : "");
  const requestedName = typeof body.fileName === "string" ? safeName(body.fileName) : "";
  if (!jobId || !token) return NextResponse.json({ ok: false, message: "Informe jobId e token." }, { status: 400 });
  if (!blobAvailable()) return NextResponse.json({ ok: false, message: "Vercel Blob não configurado." }, { status: 503 });

  try {
    const job = await getCorvoJob(jobId);
    if (!job || job.uploadToken !== token) return NextResponse.json({ ok: false, message: "Trabalho ou token inválido." }, { status: 404 });
    if (job.request.specialist !== "ANALISTA") return NextResponse.json({ ok: false, message: "O pacote de entrada pertence ao trabalho do Analista." }, { status: 409 });

    const images = (job.files || []).filter((file) => file.type === "COLLECTOR_IMAGE");
    if (!images.length) return NextResponse.json({ ok: false, message: "Nenhuma imagem do Collector foi recebida." }, { status: 409 });
    const expectedCount = job.request.ids?.length || 0;
    if (expectedCount && images.length !== expectedCount) {
      return NextResponse.json({ ok: false, message: `O Analista espera ${expectedCount} imagens, mas o app recebeu ${images.length}.` }, { status: 409 });
    }

    const zip = new JSZip();
    const failures: string[] = [];
    for (const image of images) {
      try {
        const response = await fetch(image.url, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const bytes = await response.arrayBuffer();
        zip.file(image.name, bytes);
      } catch (error) {
        failures.push(`${image.name}|${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) {
      return NextResponse.json({ ok: false, message: `Não foi possível recuperar ${failures.length} imagem(ns) do armazenamento.`, failures }, { status: 502 });
    }
    zip.file("CORVO_ANALISE_INPUT.json", JSON.stringify({
      protocol: "corvo-analysis-input/1",
      jobId,
      projectId: job.request.projetoId || "",
      generatedAt: new Date().toISOString(),
      total: images.length,
      included: images.length - failures.length,
      failed: failures.length,
      files: images.map((image) => ({ name: image.name, url: image.url, contentType: image.contentType, size: image.size })),
      failures,
    }, null, 2));
    if (failures.length) zip.file("FALHAS_DE_EMPACOTAMENTO.txt", failures.join("\n"));

    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const fileName = requestedName || `${safeName(job.request.projetoId || jobId)}_COLLECTOR_ANALISE.zip`;
    const blob = await put(`corvoquiz/${jobId}/${fileName}`, content, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/zip",
      cacheControlMaxAge: 60 * 60 * 24 * 7,
    });
    const updated = await attachCorvoFile(jobId, token, {
      type: "COLLECTOR_ZIP",
      name: fileName,
      url: blob.url,
      downloadUrl: blob.downloadUrl,
      contentType: "application/zip",
      size: content.byteLength,
      createdAt: new Date().toISOString(),
    });
    if (!updated) return NextResponse.json({ ok: false, message: "Trabalho não encontrado ou expirado." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      jobId,
      file: updated.files?.find((file) => file.type === "COLLECTOR_ZIP" && file.name === fileName),
      imageCount: images.length,
      failures,
    });
  } catch (error) {
    return storageFailure(error);
  }
}
