import { lookup } from "node:dns/promises";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type CorvoR2DiagnosticStep = {
  step:string;
  ok:boolean;
  code:string;
  status?:number;
  detail?:string;
};

export class CorvoBlobReadError extends Error {
  code: string;
  status?: number;
  attempts: string[];
  diagnostics?: CorvoR2DiagnosticStep[];
  constructor(code:string, message:string, attempts:string[] = [], status?:number, diagnostics?:CorvoR2DiagnosticStep[]) {
    super(message);
    this.name = "CorvoBlobReadError";
    this.code = code;
    this.status = status;
    this.attempts = attempts;
    this.diagnostics = diagnostics;
  }
}

function firstEnvLine(raw:string | undefined) {
  return String(raw || "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "";
}

function envLineCount(raw:string | undefined) {
  return String(raw || "").split(/\r?\n/).map((part) => part.trim()).filter(Boolean).length;
}

function normalizeR2Endpoint(raw:string, accountId:string, bucket:string) {
  const fallback = accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
  const value = firstEnvLine(raw) || fallback;
  if (!value) return "";
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    url.search = "";
    url.hash = "";
    // O endpoint S3 do R2 é sempre a raiz do host. O painel da Cloudflare às
    // vezes exibe uma URL com /<bucket>; o SDK já recebe Bucket separadamente.
    if (/\.r2\.cloudflarestorage\.com$/i.test(url.hostname)) {
      url.pathname = "/";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (bucket && parts.at(-1)?.toLowerCase() === bucket.toLowerCase()) parts.pop();
      url.pathname = parts.length ? `/${parts.join("/")}` : "/";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return withProtocol.replace(/\/+$/, "");
  }
}

function r2Config() {
  const accountId = firstEnvLine(process.env.R2_ACCOUNT_ID);
  const bucket = firstEnvLine(process.env.R2_BUCKET_NAME) || firstEnvLine(process.env.R2_BUCKET);
  return {
    accountId,
    accessKeyId:firstEnvLine(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey:firstEnvLine(process.env.R2_SECRET_ACCESS_KEY),
    bucket,
    endpoint:normalizeR2Endpoint(firstEnvLine(process.env.R2_ENDPOINT), accountId, bucket),
  };
}

export function corvoR2ConfigWarnings() {
  const warnings:string[] = [];
  const endpointRaw = firstEnvLine(process.env.R2_ENDPOINT);
  const bucketRaw = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || "";
  if (envLineCount(bucketRaw) > 1) warnings.push("R2_BUCKET_MULTILINE_SANITIZED");
  if (envLineCount(process.env.R2_ENDPOINT) > 1) warnings.push("R2_ENDPOINT_MULTILINE_SANITIZED");
  try {
    if (endpointRaw) {
      const url = new URL(/^https?:\/\//i.test(endpointRaw) ? endpointRaw : `https://${endpointRaw}`);
      if (/\.r2\.cloudflarestorage\.com$/i.test(url.hostname) && url.pathname !== "/" && url.pathname !== "") {
        warnings.push("R2_ENDPOINT_BUCKET_PATH_REMOVED");
      }
    }
  } catch {}
  return warnings;
}

export function isCorvoObjectStorageConfigured() {
  const c = r2Config();
  return Boolean(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket && c.endpoint);
}

function requireConfig() {
  const config = r2Config();
  if (!isCorvoObjectStorageConfigured()) {
    throw new CorvoBlobReadError(
      "R2_NOT_CONFIGURED",
      "Cloudflare R2 não configurado no servidor. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME e R2_ENDPOINT.",
    );
  }
  try {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:") throw new Error("R2_ENDPOINT_NOT_HTTPS");
  } catch {
    throw new CorvoBlobReadError("R2_ENDPOINT_INVALID", "R2_ENDPOINT inválido. Use https://<ACCOUNT_ID>.r2.cloudflarestorage.com.");
  }
  return config;
}

let cachedClientKey = "";
let cachedClient:S3Client | null = null;

function clientFor(config = requireConfig()) {
  const key = `${config.endpoint}|${config.accessKeyId}|${config.bucket}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient?.destroy();
  cachedClientKey = key;
  cachedClient = new S3Client({
    region:"auto",
    endpoint:config.endpoint,
    credentials:{ accessKeyId:config.accessKeyId, secretAccessKey:config.secretAccessKey },
    // Mantém o hostname exatamente igual ao R2_ENDPOINT e coloca o bucket no path.
    // Isso evita depender de DNS virtual-host por bucket e simplifica os diagnósticos.
    forcePathStyle:true,
    maxAttempts:2,
  });
  return cachedClient;
}

function signedTtlSeconds() {
  const raw = Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 604800);
  return Math.max(60, Math.min(604800, Number.isFinite(raw) ? Math.floor(raw) : 604800));
}

function normalizeKey(key:string) {
  const value = String(key || "").replace(/^\/+/, "");
  if (!value.startsWith("corvoquiz/")) throw new CorvoBlobReadError("R2_KEY_INVALID", "Caminho do R2 inválido.");
  return value;
}

export function corvoBlobPathname(raw:string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const config = r2Config();
  if (value.startsWith("r2://")) {
    const rest = value.slice(5);
    const slash = rest.indexOf("/");
    if (slash < 0) return "";
    if (config.bucket && rest.slice(0, slash) !== config.bucket) return "";
    return decodeURIComponent(rest.slice(slash + 1));
  }
  try {
    const url = new URL(value);
    const endpointHost = config.endpoint ? new URL(config.endpoint).hostname.toLowerCase() : "";
    const host = url.hostname.toLowerCase();
    if (!host.endsWith(".r2.cloudflarestorage.com") && host !== endpointHost) return "";
    let key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    // forcePathStyle => /<bucket>/<key>. Também preserva compatibilidade
    // com URLs virtual-host style em que o pathname já é apenas <key>.
    if (config.bucket && key.toLowerCase().startsWith(`${config.bucket.toLowerCase()}/`)) {
      key = key.slice(config.bucket.length + 1);
    }
    return key;
  } catch {
    return value.replace(/^\/+/, "");
  }
}

function awsStatus(error:unknown) {
  const meta = (error as { $metadata?:{ httpStatusCode?:number } } | undefined)?.$metadata;
  return Number(meta?.httpStatusCode || 0) || undefined;
}

function awsName(error:unknown) {
  return String((error as { name?:string } | undefined)?.name || "");
}

function awsMessage(error:unknown) {
  return error instanceof Error ? error.message : String(error || "UNKNOWN_R2_ERROR");
}

function classifyAwsError(error:unknown, fallback="R2_REQUEST_FAILED") {
  const status = awsStatus(error);
  const name = awsName(error);
  const message = awsMessage(error);
  const combined = `${name} ${message}`.toLowerCase();
  if (combined.includes("nosuchbucket") || combined.includes("bucket does not exist")) return { code:"R2_BUCKET_NOT_FOUND", status, message:"O bucket configurado não foi encontrado no Cloudflare R2." };
  if (combined.includes("invalidaccesskeyid")) return { code:"R2_ACCESS_KEY_INVALID", status, message:"O R2_ACCESS_KEY_ID foi recusado pelo Cloudflare R2." };
  if (combined.includes("signaturedoesnotmatch") || combined.includes("signature")) return { code:"R2_SIGNATURE_FAILED", status, message:"A assinatura S3 foi recusada. Verifique R2_SECRET_ACCESS_KEY, endpoint e credenciais do mesmo token." };
  if (status === 401 || status === 403 || combined.includes("accessdenied") || combined.includes("forbidden")) return { code:"R2_ACCESS_DENIED", status, message:"O Cloudflare R2 recusou a operação. Verifique as permissões Object Read & Write do token para este bucket." };
  if (combined.includes("enotfound") || combined.includes("eai_again") || combined.includes("getaddrinfo")) return { code:"R2_DNS_FAILED", status, message:"O hostname do R2_ENDPOINT não pôde ser resolvido por DNS." };
  if (combined.includes("timeout") || combined.includes("timed out")) return { code:"R2_CONNECTION_TIMEOUT", status, message:"A conexão com o Cloudflare R2 expirou." };
  return { code:fallback, status, message:`Falha no Cloudflare R2: ${message}` };
}

async function presignedGetUrl(key:string, expiresIn = signedTtlSeconds()) {
  const config = requireConfig();
  return getSignedUrl(clientFor(config), new GetObjectCommand({ Bucket:config.bucket, Key:normalizeKey(key) }), { expiresIn });
}

export async function putCorvoObject(key:string, body:Buffer | Uint8Array | string, options:{ contentType?:string; cacheControl?:string } = {}) {
  const config = requireConfig();
  const normalizedKey = normalizeKey(key);
  try {
    const result = await clientFor(config).send(new PutObjectCommand({
      Bucket:config.bucket,
      Key:normalizedKey,
      Body:body,
      ContentType:options.contentType || "application/octet-stream",
      CacheControl:options.cacheControl,
    }));
    const getUrl = await presignedGetUrl(normalizedKey, signedTtlSeconds());
    const size = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
    return {
      url:getUrl,
      downloadUrl:getUrl,
      pathname:normalizedKey,
      key:normalizedKey,
      etag:String(result.ETag || "").replaceAll('"', ""),
      contentType:options.contentType || "application/octet-stream",
      size,
      provider:"R2" as const,
    };
  } catch (error) {
    const classified = classifyAwsError(error, "R2_PUT_FAILED");
    throw new CorvoBlobReadError(classified.code, classified.message, [`put:${awsName(error)}:${awsMessage(error)}`], classified.status);
  }
}

function sdkBodyToWebStream(body:GetObjectCommandOutput["Body"]):ReadableStream<Uint8Array> {
  if (!body) throw new CorvoBlobReadError("R2_CONTENT_EMPTY", "O objeto recuperado do R2 está vazio.");
  const maybe = body as unknown as { transformToWebStream?:()=>ReadableStream<Uint8Array> };
  if (typeof maybe.transformToWebStream === "function") return maybe.transformToWebStream();
  if (body instanceof Readable) return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  return new Response(body as BodyInit).body as ReadableStream<Uint8Array>;
}

function isSignedR2Url(raw:string) {
  try {
    const url = new URL(String(raw || ""));
    return /\.r2\.cloudflarestorage\.com$/i.test(url.hostname)
      && (url.searchParams.has("X-Amz-Signature") || url.searchParams.has("X-Amz-Credential"));
  } catch { return false; }
}

async function fetchLegacySignedR2Buffer(raw:string) {
  if (!isSignedR2Url(raw)) return null;
  const response = await fetch(raw, { cache:"no-store", redirect:"follow" });
  if (!response.ok) throw new CorvoBlobReadError(
    response.status === 403 ? "R2_LEGACY_SIGNED_URL_EXPIRED" : "R2_LEGACY_SIGNED_FETCH_FAILED",
    response.status === 403
      ? "A URL assinada antiga do R2 expirou; será necessário reempacotar essas candidatas."
      : `A URL assinada antiga do R2 respondeu HTTP ${response.status}.`,
    [`legacy-signed-fetch:${response.status}`],
    response.status,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new CorvoBlobReadError("R2_CONTENT_EMPTY", "O objeto recuperado do R2 está vazio.");
  return {
    buffer:Buffer.from(bytes),
    contentType:response.headers.get("content-type") || "application/octet-stream",
    size:bytes.byteLength,
    pathname:"",
    source:"cloudflare-r2-signed-legacy",
    etag:String(response.headers.get("etag") || "").replaceAll('"', ""),
  };
}

export async function openCorvoBlob(raw:string) {
  const config = requireConfig();
  const attempts:string[] = [];
  let key = "";
  try { key = normalizeKey(corvoBlobPathname(raw)); }
  catch (parseError) {
    try {
      const legacy = await fetchLegacySignedR2Buffer(raw);
      if (legacy) {
        return {
          statusCode:200,
          stream:new Response(legacy.buffer).body as ReadableStream<Uint8Array>,
          pathname:legacy.pathname,
          access:"private" as const,
          source:legacy.source,
          blob:{ pathname:legacy.pathname, url:raw, downloadUrl:raw, contentType:legacy.contentType, contentDisposition:"", cacheControl:"private, max-age=0, no-store", etag:legacy.etag, size:legacy.size, uploadedAt:new Date() },
        };
      }
    } catch (legacyError) { if (legacyError instanceof CorvoBlobReadError) throw legacyError; }
    throw parseError;
  }
  try {
    const result = await clientFor(config).send(new GetObjectCommand({ Bucket:config.bucket, Key:key }));
    const stream = sdkBodyToWebStream(result.Body);
    return {
      statusCode:200,
      stream,
      pathname:key,
      access:"private" as const,
      source:"cloudflare-r2",
      blob:{
        pathname:key,
        url:raw,
        downloadUrl:raw,
        contentType:result.ContentType || "application/octet-stream",
        contentDisposition:result.ContentDisposition || "",
        cacheControl:result.CacheControl || "",
        etag:String(result.ETag || "").replaceAll('"', ""),
        size:Number(result.ContentLength || 0),
        uploadedAt:result.LastModified || new Date(),
      },
    };
  } catch (error) {
    attempts.push(`get:${awsName(error)}:${awsMessage(error)}`);
    try {
      const legacy = await fetchLegacySignedR2Buffer(raw);
      if (legacy) {
        attempts.push("legacy-signed-fetch:ok");
        return {
          statusCode:200,
          stream:new Response(legacy.buffer).body as ReadableStream<Uint8Array>,
          pathname:legacy.pathname,
          access:"private" as const,
          source:legacy.source,
          blob:{ pathname:legacy.pathname, url:raw, downloadUrl:raw, contentType:legacy.contentType, contentDisposition:"", cacheControl:"private, max-age=0, no-store", etag:legacy.etag, size:legacy.size, uploadedAt:new Date() },
        };
      }
    } catch (legacyError) {
      if (legacyError instanceof CorvoBlobReadError) {
        legacyError.attempts.unshift(...attempts);
        throw legacyError;
      }
    }
    const classified = classifyAwsError(error, "R2_CONTENT_READ_FAILED");
    throw new CorvoBlobReadError(classified.code, classified.message, attempts, classified.status);
  }
}

export async function readCorvoBlobBuffer(raw:string) {
  const config = requireConfig();
  let key = "";
  try { key = normalizeKey(corvoBlobPathname(raw)); }
  catch (parseError) {
    const legacy = await fetchLegacySignedR2Buffer(raw);
    if (legacy) return legacy;
    throw parseError;
  }
  try {
    const result = await clientFor(config).send(new GetObjectCommand({ Bucket:config.bucket, Key:key }));
    if (!result.Body) throw new CorvoBlobReadError("R2_CONTENT_EMPTY", "O objeto recuperado do R2 está vazio.");
    const bytes = await result.Body.transformToByteArray();
    if (!bytes.byteLength) throw new CorvoBlobReadError("R2_CONTENT_EMPTY", "O objeto recuperado do R2 está vazio.");
    return {
      buffer:Buffer.from(bytes),
      contentType:String(result.ContentType || "application/octet-stream"),
      size:Number(result.ContentLength || bytes.byteLength),
      pathname:key,
      source:"cloudflare-r2",
      etag:String(result.ETag || "").replaceAll('"', ""),
    };
  } catch (error) {
    if (error instanceof CorvoBlobReadError && error.code === "R2_CONTENT_EMPTY") throw error;
    try {
      const legacy = await fetchLegacySignedR2Buffer(raw);
      if (legacy) return legacy;
    } catch (legacyError) { if (legacyError instanceof CorvoBlobReadError) throw legacyError; }
    if (error instanceof CorvoBlobReadError) throw error;
    const classified = classifyAwsError(error, "R2_CONTENT_READ_FAILED");
    throw new CorvoBlobReadError(classified.code, classified.message, [`get-buffer:${awsName(error)}:${awsMessage(error)}`], classified.status);
  }
}

export async function probeCorvoObjectStorage() {
  const config = requireConfig();
  const diagnostics:CorvoR2DiagnosticStep[] = [];
  const attempts:string[] = [];
  let probeKey = "";
  let probeCreated = false;

  const endpoint = new URL(config.endpoint);
  diagnostics.push({ step:"ENDPOINT", ok:true, code:"R2_ENDPOINT_OK", detail:config.endpoint });

  try {
    const dns = await lookup(endpoint.hostname);
    diagnostics.push({ step:"DNS", ok:true, code:"R2_DNS_OK", detail:`${endpoint.hostname} -> ${dns.address}` });
  } catch (error) {
    diagnostics.push({ step:"DNS", ok:false, code:"R2_DNS_FAILED", detail:awsMessage(error) });
    throw new CorvoBlobReadError("R2_DNS_FAILED", "O R2_ENDPOINT não pôde ser resolvido por DNS.", [`dns:${awsMessage(error)}`], undefined, diagnostics);
  }

  const client = clientFor(config);
  try {
    try {
      const head = await client.send(new HeadBucketCommand({ Bucket:config.bucket }));
      diagnostics.push({ step:"HEAD_BUCKET", ok:true, code:"R2_BUCKET_OK", status:head.$metadata.httpStatusCode || 200, detail:config.bucket });
    } catch (error) {
      const classified = classifyAwsError(error, "R2_HEAD_BUCKET_FAILED");
      diagnostics.push({ step:"HEAD_BUCKET", ok:false, code:classified.code, status:classified.status, detail:awsMessage(error) });
      // Tokens R2 estritamente orientados a objetos podem não autorizar todos os
      // checks de bucket. Só NoSuchBucket encerra aqui; PUT/GET abaixo são a
      // prova definitiva de credencial + bucket + Object Read & Write.
      if (classified.code === "R2_BUCKET_NOT_FOUND") {
        throw new CorvoBlobReadError(classified.code, classified.message, [`head-bucket:${awsName(error)}:${awsMessage(error)}`], classified.status, diagnostics);
      }
    }

    probeKey = `corvoquiz/_health/probe-${Date.now()}-${Math.random().toString(36).slice(2,10)}.txt`;
    const probePayload = `corvoquiz-r2-probe:${Date.now()}`;

    try {
      const put = await client.send(new PutObjectCommand({ Bucket:config.bucket, Key:probeKey, Body:probePayload, ContentType:"text/plain" }));
      probeCreated = true;
      diagnostics.push({ step:"PUT", ok:true, code:"R2_WRITE_OK", status:put.$metadata.httpStatusCode || 200, detail:probeKey });
    } catch (error) {
      const classified = classifyAwsError(error, "R2_WRITE_FAILED");
      diagnostics.push({ step:"PUT", ok:false, code:classified.code, status:classified.status, detail:awsMessage(error) });
      throw new CorvoBlobReadError(classified.code, classified.message, [`probe-put:${awsName(error)}:${awsMessage(error)}`], classified.status, diagnostics);
    }

    try {
      const get = await client.send(new GetObjectCommand({ Bucket:config.bucket, Key:probeKey }));
      const received = get.Body ? await get.Body.transformToString() : "";
      if (received !== probePayload) {
        diagnostics.push({ step:"GET", ok:false, code:"R2_READ_MISMATCH", status:get.$metadata.httpStatusCode || 200, detail:"O conteúdo lido não corresponde ao conteúdo gravado." });
        throw new CorvoBlobReadError("R2_READ_MISMATCH", "O R2 respondeu, mas o conteúdo do probe não corresponde ao que foi gravado.", [], get.$metadata.httpStatusCode, diagnostics);
      }
      diagnostics.push({ step:"GET", ok:true, code:"R2_READ_OK", status:get.$metadata.httpStatusCode || 200, detail:`${received.length} bytes validados` });
    } catch (error) {
      if (error instanceof CorvoBlobReadError) throw error;
      const classified = classifyAwsError(error, "R2_READ_FAILED");
      diagnostics.push({ step:"GET", ok:false, code:classified.code, status:classified.status, detail:awsMessage(error) });
      throw new CorvoBlobReadError(classified.code, classified.message, [`probe-get:${awsName(error)}:${awsMessage(error)}`], classified.status, diagnostics);
    }

    try {
      const del = await client.send(new DeleteObjectCommand({ Bucket:config.bucket, Key:probeKey }));
      probeCreated = false;
      diagnostics.push({ step:"DELETE", ok:true, code:"R2_DELETE_OK", status:del.$metadata.httpStatusCode || 204, detail:probeKey });
    } catch (error) {
      const classified = classifyAwsError(error, "R2_DELETE_FAILED");
      diagnostics.push({ step:"DELETE", ok:false, code:classified.code, status:classified.status, detail:awsMessage(error) });
      throw new CorvoBlobReadError(classified.code, classified.message, [`probe-delete:${awsName(error)}:${awsMessage(error)}`], classified.status, diagnostics);
    }

    return {
      ok:true,
      provider:"R2" as const,
      endpoint:config.endpoint,
      endpointHost:endpoint.hostname,
      bucket:config.bucket,
      sdk:"@aws-sdk/client-s3",
      diagnostics,
    };
  } catch (error) {
    if (error instanceof CorvoBlobReadError) throw error;
    const classified = classifyAwsError(error, "R2_PROBE_FAILED");
    attempts.push(`probe:${awsName(error)}:${awsMessage(error)}`);
    diagnostics.push({ step:"UNKNOWN", ok:false, code:classified.code, status:classified.status, detail:awsMessage(error) });
    throw new CorvoBlobReadError(classified.code, classified.message, attempts, classified.status, diagnostics);
  } finally {
    if (probeCreated && probeKey) {
      try { await client.send(new DeleteObjectCommand({ Bucket:config.bucket, Key:probeKey })); }
      catch {}
    }
  }
}
