import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { attachCollectorCandidatesBatch, getCorvoJob, listCollectorCandidates, updateCorvoAnalysisPreparation, type CorvoCollectorCandidate } from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";
import { isCorvoObjectStorageConfigured, putCorvoObject } from "../../../../lib/corvo-blob";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BATCH_BYTES = 3_800_000;
const MAX_BATCH_ITEMS = 50;

function safeName(value:string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180);
}

type BatchIndexItem = { id:string; name:string; contentType?:string; size?:number };

export async function POST(request:NextRequest) {
  let form:FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ ok:false, message:"Envie multipart/form-data válido." }, { status:400 }); }

  const jobId = String(form.get("jobId") || "").trim();
  const token = request.headers.get("x-corvo-upload-token")?.trim() || String(form.get("uploadToken") || "").trim();
  const batchName = safeName(String(form.get("nomeArquivo") || ""));
  const rawIndex = String(form.get("indice") || "").trim();
  const file = form.get("arquivo");
  if (!jobId || !token || !batchName || !rawIndex || !(file instanceof File)) {
    return NextResponse.json({ ok:false, message:"Envie jobId, token, nomeArquivo, indice e arquivo." }, { status:400 });
  }
  if (!isCorvoObjectStorageConfigured()) return NextResponse.json({ ok:false, message:"Cloudflare R2 não configurado. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME e R2_ENDPOINT." }, { status:503 });
  if (!file.size || file.size > MAX_BATCH_BYTES) return NextResponse.json({ ok:false, message:`O lote deve ter até ${Math.round(MAX_BATCH_BYTES / 1_000_000 * 10) / 10} MB.` }, { status:413 });
  if (!/\.zip$/i.test(batchName)) return NextResponse.json({ ok:false, message:"O lote precisa ser um ZIP." }, { status:415 });

  let index:BatchIndexItem[];
  try {
    const parsed = JSON.parse(rawIndex);
    if (!Array.isArray(parsed)) throw new Error("INDEX_NOT_ARRAY");
    if (parsed.length > MAX_BATCH_ITEMS) return NextResponse.json({ ok:false, message:`O lote aceita no máximo ${MAX_BATCH_ITEMS} candidatas.` }, { status:413 });
    index = parsed.map((item) => ({
      id:String(item?.id || "").trim().slice(0, 120),
      name:safeName(String(item?.name || "")),
      contentType:String(item?.contentType || "image/jpeg"),
      size:Math.max(0, Number(item?.size || 0)),
    })).filter((item) => item.id && item.name);
  } catch {
    return NextResponse.json({ ok:false, message:"Índice do lote inválido." }, { status:400 });
  }
  if (!index.length || index.length > MAX_BATCH_ITEMS) return NextResponse.json({ ok:false, message:"O lote não possui candidatas válidas." }, { status:400 });
  const uniqueNames = new Set(index.map((item) => item.name.toLocaleLowerCase("pt-BR")));
  if (uniqueNames.size !== index.length) return NextResponse.json({ ok:false, message:"O lote contém nomes de arquivo duplicados." }, { status:409 });

  try {
    const job = await getCorvoJob(jobId);
    if (!job || job.uploadToken !== token || job.request.specialist !== "ANALISTA") {
      return NextResponse.json({ ok:false, message:"Trabalho ou token inválido." }, { status:404 });
    }

    const bytes = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(bytes);
    const zipEntries = new Set(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => safeName(entry.name).toLocaleLowerCase("pt-BR")));
    const missing = index.filter((item) => !zipEntries.has(item.name.toLocaleLowerCase("pt-BR"))).map((item) => item.name);
    if (missing.length) return NextResponse.json({ ok:false, message:`O ZIP do lote não contém ${missing.length} arquivo(s) do índice.`, missing:missing.slice(0, 12) }, { status:409 });

    const blob = await putCorvoObject(`corvoquiz/${jobId}/collector-batches/${batchName}`, Buffer.from(bytes), {
      contentType:"application/zip",
      cacheControl:"private, max-age=0, no-store",
    });
    const createdAt = new Date().toISOString();
    const records:CorvoCollectorCandidate[] = index.map((item) => ({
      id:item.id,
      name:item.name,
      url:blob.url,
      downloadUrl:blob.downloadUrl,
      contentType:item.contentType || "image/jpeg",
      size:item.size || 0,
      createdAt,
      storageMode:"BATCH_ZIP",
      batchName,
      batchUrl:blob.url,
      batchDownloadUrl:blob.downloadUrl,
      batchEntry:item.name,
    }));
    const saved = await attachCollectorCandidatesBatch(jobId, token, records);
    if (!saved) return NextResponse.json({ ok:false, message:"Trabalho não encontrado, expirado ou incompatível com o Collector." }, { status:404 });
    const allCandidates = await listCollectorCandidates(jobId, token) || [];
    await updateCorvoAnalysisPreparation(jobId, token, {
      stage:"CANDIDATES_PREPARING",
      storedCandidates:allCandidates.length,
      storedIds:new Set(allCandidates.map((candidate) => String(candidate.id))).size,
      error:undefined,
    });
    return NextResponse.json({ ok:true, jobId, batchName, batchUrl:blob.url, accepted:saved.length, storedCandidates:allCandidates.length, bytes:file.size });
  } catch (error) {
    return storageFailure(error);
  }
}
