import { NextRequest, NextResponse } from "next/server";
import {
  getCorvoJob,
  listCollectorCandidates,
  updateCorvoAnalysisPreparation,
  type CorvoAnalysisPreparationStage,
} from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";

export const runtime = "nodejs";

function isLegacyVercelBlob(value?:string) {
  try { return new URL(String(value || "")).hostname.endsWith(".blob.vercel-storage.com"); } catch { return false; }
}

const STAGES = new Set<CorvoAnalysisPreparationStage>([
  "JOB_CREATED",
  "CANDIDATES_PREPARING",
  "CANDIDATES_STORED",
  "ZIP_BUILDING",
  "ZIP_SAVED",
]);

async function snapshot(jobId:string, token:string) {
  const job = await getCorvoJob(jobId);
  if (!job || job.uploadToken !== token || job.request.specialist !== "ANALISTA") return null;
  const candidates = await listCollectorCandidates(jobId, token) || [];
  const expectedIds = (job.request.ids || []).map((id) => String(id));
  const storedIdSet = new Set(candidates.map((candidate) => String(candidate.id)));
  const missingIds = expectedIds.filter((id) => !storedIdSet.has(id));
  const zipFile = [...(job.files || [])].reverse().find((file) => file.type === "COLLECTOR_ZIP");
  const legacyCandidates = candidates.filter((candidate) => [candidate.url, candidate.downloadUrl, candidate.batchUrl, candidate.batchDownloadUrl].some((url) => isLegacyVercelBlob(url)));
  const legacyZip = Boolean(zipFile && [zipFile.url, zipFile.downloadUrl].some((url) => isLegacyVercelBlob(url)));
  return {
    preparation:job.analysisPreparation || null,
    storedCandidates:candidates.length,
    storedIds:storedIdSet.size,
    expectedIds:expectedIds.length,
    missingIds,
    readyForZip:candidates.length > 0 && missingIds.length === 0,
    zipFile:zipFile || null,
    legacyStorage:legacyZip || legacyCandidates.length > 0,
    legacyStorageCount:(legacyZip ? 1 : 0) + legacyCandidates.length,
    storageProvider:legacyZip || legacyCandidates.length ? "VERCEL_BLOB_LEGACY" : "R2",
  };
}

export async function GET(request:NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() || "";
  const token = request.headers.get("x-corvo-upload-token")?.trim() || "";
  if (!jobId || !token) return NextResponse.json({ ok:false, message:"Informe jobId e token." }, { status:400 });
  try {
    const state = await snapshot(jobId, token);
    if (!state) return NextResponse.json({ ok:false, message:"Trabalho do Analista não encontrado ou expirado." }, { status:404 });
    return NextResponse.json({ ok:true, jobId, ...state });
  } catch (error) {
    return storageFailure(error);
  }
}

export async function POST(request:NextRequest) {
  let body:Record<string,unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok:false, message:"JSON inválido." }, { status:400 }); }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const token = request.headers.get("x-corvo-upload-token")?.trim() || (typeof body.uploadToken === "string" ? body.uploadToken.trim() : "");
  const rawStage = typeof body.stage === "string" ? body.stage.trim().toUpperCase() : "";
  if (!jobId || !token || !STAGES.has(rawStage as CorvoAnalysisPreparationStage)) {
    return NextResponse.json({ ok:false, message:"Informe jobId, token e stage válido." }, { status:400 });
  }
  try {
    const numberOrUndefined = (value:unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : undefined;
    const updated = await updateCorvoAnalysisPreparation(jobId, token, {
      stage:rawStage as CorvoAnalysisPreparationStage,
      expectedCandidates:numberOrUndefined(body.expectedCandidates),
      storedCandidates:numberOrUndefined(body.storedCandidates),
      storedIds:numberOrUndefined(body.storedIds),
      expectedIds:numberOrUndefined(body.expectedIds),
      batchesUploaded:numberOrUndefined(body.batchesUploaded),
      batchTotal:numberOrUndefined(body.batchTotal),
      packageFileName:typeof body.packageFileName === "string" ? body.packageFileName.trim() : undefined,
      collectorPackageId:typeof body.collectorPackageId === "string" ? body.collectorPackageId.trim() : undefined,
      collectorPackageCode:typeof body.collectorPackageCode === "string" ? body.collectorPackageCode.trim() : undefined,
      selectionMode:body.selectionMode === "MANUAL" ? "MANUAL" : body.selectionMode === "AUTO" ? "AUTO" : undefined,
      error:typeof body.error === "string" ? body.error.trim().slice(0,1000) : undefined,
    });
    if (!updated) return NextResponse.json({ ok:false, message:"Trabalho do Analista não encontrado ou expirado." }, { status:404 });
    const state = await snapshot(jobId, token);
    return NextResponse.json({ ok:true, jobId, ...state });
  } catch (error) {
    return storageFailure(error);
  }
}
