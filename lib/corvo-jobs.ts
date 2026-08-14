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
