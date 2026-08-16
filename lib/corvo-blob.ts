import { createHash, createHmac } from "node:crypto";

export class CorvoBlobReadError extends Error {
  code: string;
  status?: number;
  attempts: string[];
  constructor(code:string, message:string, attempts:string[] = [], status?:number) {
    super(message);
    this.name = "CorvoBlobReadError";
    this.code = code;
    this.status = status;
    this.attempts = attempts;
  }
}

function normalizeR2Endpoint(raw:string, accountId:string) {
  const fallback = accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
  const value = String(raw || fallback).trim();
  if (!value) return "";
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || "";
  return {
    accountId,
    accessKeyId:process.env.R2_ACCESS_KEY_ID?.trim() || "",
    secretAccessKey:process.env.R2_SECRET_ACCESS_KEY?.trim() || "",
    // Nome oficial a partir da V0.6.34. R2_BUCKET permanece como fallback de compatibilidade.
    bucket:process.env.R2_BUCKET_NAME?.trim() || process.env.R2_BUCKET?.trim() || "",
    endpoint:normalizeR2Endpoint(process.env.R2_ENDPOINT?.trim() || "", accountId),
  };
}

export function isCorvoObjectStorageConfigured() {
  const c = r2Config();
  return Boolean(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket && c.endpoint);
}

function encodeRfc3986(value:string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key:string) {
  return key.split("/").map(encodeRfc3986).join("/");
}

function sha256(value:string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key:Buffer | string, value:string) {
  return createHmac("sha256", key).update(value).digest();
}

function amzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signedTtlSeconds() {
  const raw = Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 604800);
  return Math.max(60, Math.min(604800, Number.isFinite(raw) ? Math.floor(raw) : 604800));
}

function requireConfig() {
  const config = r2Config();
  if (!isCorvoObjectStorageConfigured()) throw new CorvoBlobReadError("R2_NOT_CONFIGURED", "Cloudflare R2 não configurado no servidor.");
  return config;
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
    const host = url.hostname.toLowerCase();
    const endpointHost = config.endpoint ? new URL(config.endpoint).hostname.toLowerCase() : "";
    if (!host.endsWith(".r2.cloudflarestorage.com") && host !== endpointHost) return "";
    let key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const virtualBucketHost = config.bucket && endpointHost ? `${config.bucket.toLowerCase()}.${endpointHost}` : "";
    // Só removemos /<bucket>/ quando a URL usa o endpoint path-style.
    // Em virtual-host style (<bucket>.<endpoint>/<key>), o pathname já é o Key real.
    if (config.bucket && host === endpointHost && host !== virtualBucketHost && key.toLowerCase().startsWith(`${config.bucket.toLowerCase()}/`)) key = key.slice(config.bucket.length + 1);
    return key;
  } catch {
    return value.replace(/^\/+/, "");
  }
}

function presign(method:"GET"|"PUT", key:string, expiresIn = signedTtlSeconds()) {
  const config = requireConfig();
  const now = new Date();
  const dateTime = amzDate(now);
  const shortDate = dateTime.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const scope = `${shortDate}/${region}/${service}/aws4_request`;
  const endpoint = new URL(config.endpoint);
  const endpointPrefix = endpoint.pathname.replace(/^\/+|\/+$/g, "");
  const prefixParts = endpointPrefix ? endpointPrefix.split("/").filter(Boolean) : [];
  const endpointAlreadyScopesBucket = prefixParts.at(-1)?.toLowerCase() === config.bucket.toLowerCase();
  const hostAlreadyScopesBucket = endpoint.hostname.toLowerCase().startsWith(`${config.bucket.toLowerCase()}.`);
  // O SDK S3 do R2 normalmente gera URLs virtuais: <bucket>.<account>.r2.cloudflarestorage.com/<key>.
  // Se o endpoint fornecido já vier com o bucket no path/host, preservamos esse formato.
  const host = endpointAlreadyScopesBucket || hostAlreadyScopesBucket ? endpoint.host : `${config.bucket}.${endpoint.host}`;
  const pathParts = endpointAlreadyScopesBucket ? [...prefixParts.slice(0, -1), key] : [...prefixParts, key];
  const canonicalUri = `/${pathParts.map((part) => encodeKey(part)).join("/")}`;
  const params:Record<string,string> = {
    "X-Amz-Algorithm":"AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256":"UNSIGNED-PAYLOAD",
    "X-Amz-Credential":`${config.accessKeyId}/${scope}`,
    "X-Amz-Date":dateTime,
    "X-Amz-Expires":String(expiresIn),
    "X-Amz-SignedHeaders":"host",
  };
  const canonicalQuery = Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join("&");
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${config.secretAccessKey}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `${endpoint.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function putCorvoObject(key:string, body:Buffer | Uint8Array | string, options:{ contentType?:string; cacheControl?:string } = {}) {
  const normalizedKey = String(key || "").replace(/^\/+/, "");
  if (!normalizedKey.startsWith("corvoquiz/")) throw new Error("R2_KEY_INVALID");
  const putUrl = presign("PUT", normalizedKey, 900);
  const response = await fetch(putUrl, {
    method:"PUT",
    body:body as BodyInit,
    headers:{
      "content-type":options.contentType || "application/octet-stream",
      ...(options.cacheControl ? { "cache-control":options.cacheControl } : {}),
    },
    cache:"no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2_PUT_${response.status}${text ? `:${text.slice(0, 240)}` : ""}`);
  }
  const getUrl = presign("GET", normalizedKey, signedTtlSeconds());
  const size = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
  return { url:getUrl, downloadUrl:getUrl, pathname:normalizedKey, key:normalizedKey, contentType:options.contentType || "application/octet-stream", size, provider:"R2" as const };
}

function errorText(error:unknown) {
  return error instanceof Error ? error.message : String(error || "UNKNOWN_R2_ERROR");
}

export async function openCorvoBlob(raw:string) {
  const key = corvoBlobPathname(raw);
  if (!key || !key.startsWith("corvoquiz/")) throw new CorvoBlobReadError("R2_KEY_INVALID", "Caminho do R2 inválido.");
  const attempts:string[] = [];
  try {
    const response = await fetch(presign("GET", key, 300), { cache:"no-store" });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      attempts.push(`r2:get:status=${response.status}:${text.slice(0, 160)}`);
      const forbidden = response.status === 401 || response.status === 403;
      throw new CorvoBlobReadError(
        forbidden ? "R2_CONTENT_READ_FORBIDDEN" : "R2_CONTENT_READ_FAILED",
        forbidden ? "O Cloudflare R2 recusou a leitura do arquivo. Verifique as credenciais e permissões do bucket." : "Não foi possível recuperar o arquivo persistido no Cloudflare R2.",
        attempts,
        forbidden ? 403 : response.status,
      );
    }
    return {
      statusCode:response.status,
      stream:response.body,
      pathname:key,
      access:"private" as const,
      source:"cloudflare-r2",
      blob:{
        pathname:key,
        url:raw,
        downloadUrl:raw,
        contentType:response.headers.get("content-type") || "application/octet-stream",
        contentDisposition:response.headers.get("content-disposition") || "",
        cacheControl:response.headers.get("cache-control") || "",
        etag:(response.headers.get("etag") || "").replaceAll('"', ""),
        size:Number(response.headers.get("content-length") || 0),
        uploadedAt:new Date(response.headers.get("last-modified") || Date.now()),
      },
    };
  } catch (error) {
    if (error instanceof CorvoBlobReadError) throw error;
    attempts.push(`r2:get:${errorText(error)}`);
    throw new CorvoBlobReadError("R2_CONTENT_READ_FAILED", "Não foi possível recuperar o arquivo persistido no Cloudflare R2.", attempts);
  }
}

export async function readCorvoBlobBuffer(raw:string) {
  const result:any = await openCorvoBlob(raw);
  const bytes = await new Response(result.stream).arrayBuffer();
  if (!bytes.byteLength) throw new CorvoBlobReadError("R2_CONTENT_EMPTY", "O objeto recuperado do R2 está vazio.");
  return {
    buffer:Buffer.from(bytes),
    contentType:String(result.blob?.contentType || "application/octet-stream"),
    size:Number(result.blob?.size || bytes.byteLength),
    pathname:String(result.pathname || corvoBlobPathname(raw)),
    source:"cloudflare-r2",
    etag:String(result.blob?.etag || ""),
  };
}
