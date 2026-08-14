import { Redis } from "@upstash/redis";

export type CorvoIdea = { tema: string; titulo: string };

export type CorvoJobRequest = {
  tema: string | null;
  formato: "REELS" | "VÍDEO COMPLETO";
  quantidade: "1 VÍDEO" | "LOTE";
  modo: "RÁPIDO" | "PESQUISAR ANTES";
  recentes: Array<{ titulo: string; tema: string }>;
};

export type CorvoJob = {
  id: string;
  status: "PENDING" | "DONE" | "ERROR";
  request: CorvoJobRequest;
  ideias?: CorvoIdea[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

const TTL_SECONDS = 60 * 60;
const KEY_PREFIX = "corvoquiz:idea-job:";
let redisClient: Redis | null = null;

declare global {
  var __corvoIdeaJobs: Map<string, CorvoJob> | undefined;
}

const memoryJobs = globalThis.__corvoIdeaJobs ?? new Map<string, CorvoJob>();
globalThis.__corvoIdeaJobs = memoryJobs;

export class CorvoStorageError extends Error {
  constructor(message = "Armazenamento de trabalhos não configurado.") {
    super(message);
    this.name = "CorvoStorageError";
  }
}

function getRedis() {
  const hasUrl = Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim());
  const hasToken = Boolean(process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
  if (!hasUrl || !hasToken) return null;
  if (!redisClient) redisClient = Redis.fromEnv();
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
    createdAt: now,
    updatedAt: now,
  };
  await writeJob(job);
  return job;
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

export async function completeCorvoJob(jobId: string, ideias: CorvoIdea[]) {
  const current = await getCorvoJob(jobId);
  if (!current) return null;
  const updated: CorvoJob = {
    ...current,
    status: "DONE",
    ideias,
    error: undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  return updated;
}
