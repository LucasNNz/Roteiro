import { NextRequest, NextResponse } from "next/server";
import { attachCollectorCandidate, attachCorvoFile, getCorvoJob, listCollectorCandidates, updateCorvoAnalysisPreparation } from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";
import { isCorvoObjectStorageConfigured, putCorvoObject } from "../../../../lib/corvo-blob";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 160);
}

function fileType(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ["THUMBNAIL", "GENERATED_IMAGE", "REFINED_IMAGE", "COLLECTOR_IMAGE", "OTHER"].includes(normalized)
    ? normalized as "THUMBNAIL" | "GENERATED_IMAGE" | "REFINED_IMAGE" | "COLLECTOR_IMAGE" | "OTHER"
    : "OTHER";
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ ok: false, message: "Envie multipart/form-data válido." }, { status: 400 }); }

  const jobId = String(form.get("jobId") || "").trim();
  const token = request.headers.get("x-corvo-upload-token")?.trim() || String(form.get("uploadToken") || "").trim();
  const name = safeName(String(form.get("nomeArquivo") || ""));
  const type = fileType(form.get("tipo"));
  const itemId = safeName(String(form.get("id") || ""));
  const file = form.get("arquivo");
  if (!jobId || !token || !name || !(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "Envie jobId, token, nomeArquivo e arquivo." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ ok: false, message: "Formato de imagem não permitido." }, { status: 415 });
  if (!file.size || file.size > MAX_FILE_SIZE) return NextResponse.json({ ok: false, message: "A imagem deve ter entre 1 byte e 4 MB." }, { status: 413 });
  if (!isCorvoObjectStorageConfigured()) return NextResponse.json({ ok: false, message: "Cloudflare R2 não configurado. Configure as credenciais R2 no projeto." }, { status: 503 });

  try {
    const job = await getCorvoJob(jobId);
    if (!job || job.uploadToken !== token) return NextResponse.json({ ok: false, message: "Trabalho ou token de arquivo inválido." }, { status: 404 });
    if (type === "THUMBNAIL" && job.request.specialist !== "THUMB") {
      return NextResponse.json({ ok: false, message: "Este trabalho não aceita uma thumbnail." }, { status: 409 });
    }
    if (type === "COLLECTOR_IMAGE" && job.request.specialist !== "ANALISTA") {
      return NextResponse.json({ ok: false, message: "Imagens do Collector só podem ser associadas a um trabalho do Analista." }, { status: 409 });
    }
    if (type === "GENERATED_IMAGE" && job.request.specialist !== "GERADOR") {
      return NextResponse.json({ ok: false, message: "Este trabalho não aceita uma imagem gerada." }, { status: 409 });
    }
    if (type === "REFINED_IMAGE" && job.request.specialist !== "REFINADOR") {
      return NextResponse.json({ ok: false, message: "Este trabalho não aceita uma imagem refinada." }, { status: 409 });
    }
    const blobPath = type === "COLLECTOR_IMAGE" ? `corvoquiz/${jobId}/collector/${name}` : `corvoquiz/${jobId}/${name}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const blob = await putCorvoObject(blobPath, bytes, {
      contentType:file.type,
      cacheControl:"private, max-age=0, no-store",
    });
    if (type === "COLLECTOR_IMAGE") {
      if (!itemId) return NextResponse.json({ ok: false, message: "Imagens do Collector precisam informar o ID de origem." }, { status: 400 });
      const candidate = await attachCollectorCandidate(jobId, token, {
        id:itemId,
        name,
        url:blob.url,
        downloadUrl:blob.downloadUrl,
        contentType:file.type,
        size:file.size,
        createdAt:new Date().toISOString(),
      });
      if (!candidate) return NextResponse.json({ ok: false, message: "Trabalho não encontrado, expirado ou incompatível com o Collector." }, { status: 404 });
      const allCandidates = await listCollectorCandidates(jobId, token) || [];
      await updateCorvoAnalysisPreparation(jobId, token, {
        stage:"CANDIDATES_PREPARING",
        storedCandidates:allCandidates.length,
        storedIds:new Set(allCandidates.map((item) => String(item.id))).size,
        error:undefined,
      });
      return NextResponse.json({ ok: true, jobId, status: job.status, file:candidate, storedCandidates:allCandidates.length });
    }
    const updated = await attachCorvoFile(jobId, token, {
      type,
      name,
      url: blob.url,
      downloadUrl: blob.downloadUrl,
      contentType: file.type,
      size: file.size,
      createdAt: new Date().toISOString(),
    });
    if (!updated) return NextResponse.json({ ok: false, message: "Trabalho não encontrado ou expirado." }, { status: 404 });
    return NextResponse.json({ ok: true, jobId, status: updated.status, file: updated.files?.at(-1) });
  } catch (error) {
    if (error instanceof Error && error.message === "FILE_NAME_MISMATCH") {
      return NextResponse.json({ ok: false, message: "O nome do arquivo não corresponde ao manifesto." }, { status: 409 });
    }
    return storageFailure(error);
  }
}
