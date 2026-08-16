import { Redis } from "@upstash/redis";
import { parseCorvoManifest, type CorvoManifestSummary } from "./corvo-manifests";

export type CorvoIdea = { tema: string; titulo: string };
export type CorvoSpecialist =
  | "IDEIAS"
  | "ROTEIRO"
  | "PROMPTS"
  | "ANALISTA"
  | "REFINADOR"
  | "GERADOR"
  | "FALLBACK"
  | "THUMB"
  | "YOUTUBE";

export type CorvoJobStatus =
  | "PENDING"
  | "SENT"
  | "PROCESSING"
  | "WAITING_ACTION"
  | "RESULT_RECEIVED"
  | "WAITING_FILE"
  | "WAITING_FALLBACK"
  | "RETRY_PENDING"
  | "DONE"
  | "ERROR"
  | "EXPIRED";

export type CorvoJobRequest = {
  specialist: CorvoSpecialist;
  tema: string | null;
  formato: "REELS" | "VÍDEO COMPLETO";
  quantidade: "1 VÍDEO" | "LOTE";
  modo: "RÁPIDO" | "PESQUISAR ANTES";
  recentes: Array<{ titulo: string; tema: string }>;
  projetoId?: string;
  titulo?: string;
  roteiro?: string;
  entrada?: string;
  ids?: string[];
  tentativaAtual?: number;
  origem?: "GERADOR" | "REFINADOR";
};

export type CorvoAnalysisPreparationStage =
  | "JOB_CREATED"
  | "CANDIDATES_PREPARING"
  | "CANDIDATES_STORED"
  | "ZIP_BUILDING"
  | "ZIP_SAVED";

export type CorvoAnalysisPreparation = {
  stage: CorvoAnalysisPreparationStage;
  expectedCandidates?: number;
  storedCandidates?: number;
  storedIds?: number;
  expectedIds?: number;
  batchesUploaded?: number;
  batchTotal?: number;
  packageFileName?: string;
  collectorPackageId?: string;
  collectorPackageCode?: string;
  selectionMode?: "AUTO" | "MANUAL";
  error?: string;
  updatedAt: string;
};

export type CorvoJob = {
  id: string;
  status: CorvoJobStatus;
  request: CorvoJobRequest;
  resultado?: string;
  ideias?: CorvoIdea[];
  error?: string;
  resultadoRecebido?: boolean;
  arquivoRecebido?: boolean;
  expectedFile?: string;
  expectedFiles?: string[];
  manifest?: CorvoManifestSummary;
  tentativaAtual?: number;
  uploadToken?: string;
  files?: CorvoJobFile[];
  analysisPreparation?: CorvoAnalysisPreparation;
  createdAt: string;
  updatedAt: string;
};

export type CorvoJobFile = {
  type: "THUMBNAIL" | "GENERATED_IMAGE" | "REFINED_IMAGE" | "COLLECTOR_IMAGE" | "COLLECTOR_ZIP" | "FINAL_ZIP" | "OTHER";
  name: string;
  url: string;
  downloadUrl?: string;
  contentType: string;
  size: number;
  createdAt: string;
};

export type CorvoCollectorCandidate = {
  id: string;
  name: string;
  url: string;
  downloadUrl?: string;
  contentType: string;
  size: number;
  createdAt: string;
  storageMode?: "FILE" | "BATCH_ZIP";
  batchName?: string;
  batchUrl?: string;
  batchDownloadUrl?: string;
  batchEntry?: string;
};

const TTL_SECONDS = 60 * 60 * 24 * 7;
const KEY_PREFIX = "corvoquiz:idea-job:";
const COLLECTOR_KEY_PREFIX = "corvoquiz:collector-candidates:";
let redisClient: Redis | null = null;

declare global {
  var __corvoIdeaJobs: Map<string, CorvoJob> | undefined;
  var __corvoCollectorCandidates: Map<string, Map<string, CorvoCollectorCandidate>> | undefined;
}

const memoryJobs = globalThis.__corvoIdeaJobs ?? new Map<string, CorvoJob>();
globalThis.__corvoIdeaJobs = memoryJobs;
const memoryCollectorCandidates = globalThis.__corvoCollectorCandidates ?? new Map<string, Map<string, CorvoCollectorCandidate>>();
globalThis.__corvoCollectorCandidates = memoryCollectorCandidates;

export class CorvoStorageError extends Error {
  constructor(message = "Armazenamento de trabalhos não configurado.") {
    super(message);
    this.name = "CorvoStorageError";
  }
}

function readRedisCredentials() {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken };

  const kvUrl = process.env.KV_REST_API_URL?.trim() || "";
  const kvToken = process.env.KV_REST_API_TOKEN?.trim() || "";
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken };

  return null;
}

export function isRedisConfigured() {
  return readRedisCredentials() !== null;
}

function getRedis() {
  const credentials = readRedisCredentials();
  if (!credentials) return null;
  if (!redisClient) redisClient = new Redis(credentials);
  return redisClient;
}

async function writeJob(job: CorvoJob) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`${KEY_PREFIX}${job.id}`, job, { ex: TTL_SECONDS });
    } catch {
      throw new CorvoStorageError("Não foi possível salvar o trabalho no Upstash Redis.");
    }
    return;
  }
  if (process.env.NODE_ENV === "production") throw new CorvoStorageError();
  memoryJobs.set(job.id, job);
}

export async function createCorvoJob(request: CorvoJobRequest) {
  const now = new Date().toISOString();
  const job: CorvoJob = {
    id: `corvo_${crypto.randomUUID()}`,
    status: "PENDING",
    request,
    tentativaAtual: request.tentativaAtual || 1,
    uploadToken: crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""),
    files: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeJob(job);
  return job;
}


export async function updateCorvoAnalysisPreparation(
  jobId: string,
  uploadToken: string,
  patch: Partial<CorvoAnalysisPreparation> & { stage?: CorvoAnalysisPreparationStage },
) {
  const current = await getCorvoJob(jobId);
  if (!current || current.uploadToken !== uploadToken || current.request.specialist !== "ANALISTA") return null;
  const now = new Date().toISOString();
  const stageOrder: Record<CorvoAnalysisPreparationStage, number> = {
    JOB_CREATED:0, CANDIDATES_PREPARING:1, CANDIDATES_STORED:2, ZIP_BUILDING:3, ZIP_SAVED:4,
  };
  const currentStage = current.analysisPreparation?.stage || "JOB_CREATED";
  const requestedStage = patch.stage || currentStage;
  const stage = stageOrder[requestedStage] >= stageOrder[currentStage] ? requestedStage : currentStage;
  const next: CorvoAnalysisPreparation = {
    ...current.analysisPreparation,
    ...patch,
    stage,
    updatedAt: now,
  };
  const updated: CorvoJob = { ...current, analysisPreparation: next, updatedAt: now };
  await writeJob(updated);
  return updated;
}

export async function attachCorvoFile(jobId: string, uploadToken: string, file: CorvoJobFile) {
  const current = await getCorvoJob(jobId);
  if (!current || !current.uploadToken || current.uploadToken !== uploadToken) return null;
  const isInputFile = file.type === "COLLECTOR_IMAGE" || file.type === "COLLECTOR_ZIP";
  const expected = current.expectedFiles?.length ? current.expectedFiles : current.expectedFile ? [current.expectedFile] : [];
  if (!isInputFile && expected.length && !expected.some((name) => name.toLocaleLowerCase("pt-BR") === file.name.toLocaleLowerCase("pt-BR"))) {
    throw new Error("FILE_NAME_MISMATCH");
  }
  const files = [...(current.files || []).filter((item) => !(item.type === file.type && item.name === file.name)), file];
  const receivedExpected = expected.filter((name) => files.some((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")));
  const hasAllExpected = expected.length > 0 && receivedExpected.length === expected.length;
  const updated: CorvoJob = {
    ...current,
    files,
    arquivoRecebido: isInputFile ? current.arquivoRecebido : hasAllExpected || current.arquivoRecebido,
    status: isInputFile
      ? current.status
      : current.resultadoRecebido && hasAllExpected ? "DONE" : current.resultadoRecebido ? "WAITING_FILE" : current.status,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}

export async function attachCollectorCandidatesBatch(jobId: string, uploadToken: string, files: CorvoCollectorCandidate[]) {
  const current = await getCorvoJob(jobId);
  if (!current || !current.uploadToken || current.uploadToken !== uploadToken || current.request.specialist !== "ANALISTA") return null;
  const normalized = files.filter((file) => file?.name && file?.id);
  if (!normalized.length) return [];
  const redis = getRedis();
  const key = `${COLLECTOR_KEY_PREFIX}${jobId}`;
  if (redis) {
    try {
      const mapping = Object.fromEntries(normalized.map((file) => [file.name, JSON.stringify(file)]));
      await redis.hset(key, mapping);
      await redis.expire(key, TTL_SECONDS);
    } catch {
      throw new CorvoStorageError("Não foi possível salvar as candidatas do Collector no Upstash Redis.");
    }
  } else {
    if (process.env.NODE_ENV === "production") throw new CorvoStorageError();
    const bucket = memoryCollectorCandidates.get(jobId) ?? new Map<string, CorvoCollectorCandidate>();
    for (const file of normalized) bucket.set(file.name, file);
    memoryCollectorCandidates.set(jobId, bucket);
  }
  return normalized;
}

export async function attachCollectorCandidate(jobId: string, uploadToken: string, file: CorvoCollectorCandidate) {
  const saved = await attachCollectorCandidatesBatch(jobId, uploadToken, [file]);
  return saved?.[0] ?? null;
}

export async function listCollectorCandidates(jobId: string, uploadToken?: string) {
  const current = await getCorvoJob(jobId);
  if (!current || (uploadToken && current.uploadToken !== uploadToken) || current.request.specialist !== "ANALISTA") return null;
  const redis = getRedis();
  const key = `${COLLECTOR_KEY_PREFIX}${jobId}`;
  if (redis) {
    try {
      const values = await redis.hgetall<Record<string, unknown>>(key);
      return Object.values(values || {}).flatMap((value) => {
        if (!value) return [];
        if (typeof value === "string") {
          try { return [JSON.parse(value) as CorvoCollectorCandidate]; } catch { return []; }
        }
        if (typeof value === "object") return [value as CorvoCollectorCandidate];
        return [];
      });
    } catch {
      throw new CorvoStorageError("Não foi possível ler as candidatas do Collector no Upstash Redis.");
    }
  }
  if (process.env.NODE_ENV === "production") throw new CorvoStorageError();
  return [...(memoryCollectorCandidates.get(jobId)?.values() || [])];
}

export async function getCollectorCandidatesByName(jobId: string, uploadToken: string, names: string[]) {
  const candidates = await listCollectorCandidates(jobId, uploadToken);
  if (!candidates) return null;
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase("pt-BR")));
  return candidates.filter((candidate) => wanted.has(candidate.name.toLocaleLowerCase("pt-BR")));
}

export async function resetCorvoJobForRetry(jobId: string, uploadToken: string) {
  const current = await getCorvoJob(jobId);
  if (!current || !current.uploadToken || current.uploadToken !== uploadToken) return null;
  const updated: CorvoJob = {
    ...current,
    status: "PENDING",
    resultado: undefined,
    error: undefined,
    resultadoRecebido: false,
    manifest: undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}

export async function getCorvoJob(jobId: string) {
  const redis = getRedis();
  if (redis) {
    try {
      return await redis.get<CorvoJob>(`${KEY_PREFIX}${jobId}`);
    } catch {
      throw new CorvoStorageError("Não foi possível ler o trabalho no Upstash Redis.");
    }
  }
  if (process.env.NODE_ENV === "production") throw new CorvoStorageError();
  return memoryJobs.get(jobId) ?? null;
}

export async function completeCorvoJob(jobId: string, resultado: string) {
  const current = await getCorvoJob(jobId);
  if (!current) return null;
  const manifest = parseCorvoManifest(resultado);
  const waitingFile = manifest.expectsBridgeFile;
  const expectedFiles = manifest.expectedFiles || (manifest.expectedFile ? [manifest.expectedFile] : []);
  const currentFiles = current.files || [];
  const alreadyReceived = expectedFiles.length > 0 && expectedFiles.every((name) => currentFiles.some((file) => file.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")));
  const updated: CorvoJob = {
    ...current,
    status: manifest.failed ? "ERROR" : waitingFile && !alreadyReceived ? "WAITING_FILE" : "DONE",
    resultado,
    resultadoRecebido: true,
    arquivoRecebido: waitingFile ? alreadyReceived : current.arquivoRecebido,
    expectedFile: manifest.expectedFile,
    expectedFiles,
    manifest,
    error: manifest.failed ? manifest.reason || manifest.errorCode || "O especialista informou uma falha." : undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}
