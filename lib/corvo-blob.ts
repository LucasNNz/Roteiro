import { get } from "@vercel/blob";

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

export function corvoBlobPathname(raw:string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith(".blob.vercel-storage.com")) return "";
    return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return value.replace(/^\/+/, "");
  }
}

function sdkOptions(access:"public"|"private") {
  const options:any = { access, useCache:false };
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  const storeId = process.env.BLOB_STORE_ID?.trim();
  if (token) options.token = token;
  if (oidcToken) options.oidcToken = oidcToken;
  if (storeId) options.storeId = storeId;
  return options;
}

function accessOrder(raw:string):Array<"public"|"private"> {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host.includes(".private.blob.vercel-storage.com")) return ["private", "public"];
  } catch {}
  return ["public", "private"];
}

function errorText(error:unknown) {
  return error instanceof Error ? error.message : String(error || "UNKNOWN_BLOB_ERROR");
}

export async function openCorvoBlob(raw:string) {
  const pathname = corvoBlobPathname(raw);
  if (!pathname) throw new CorvoBlobReadError("BLOB_PATH_INVALID", "Caminho do Blob inválido.");
  const attempts:string[] = [];

  // Usar o pathname autenticado evita depender da leitura cross-origin da URL
  // pública/CDN. useCache:false força leitura no origin quando possível.
  for (const access of accessOrder(raw)) {
    try {
      const result = await get(pathname, sdkOptions(access));
      if (result?.statusCode === 200 && result.stream) {
        return { ...result, pathname, access, source:`sdk-${access}-origin` };
      }
      attempts.push(`sdk:${access}:status=${String(result?.statusCode ?? "null")}`);
    } catch (error) {
      attempts.push(`sdk:${access}:${errorText(error)}`);
    }
  }

  // Último fallback autenticado via HTTP para stores privadas ou cenários em
  // que o SDK não conseguiu resolver a store pelo pathname.
  const bearer = process.env.VERCEL_OIDC_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
  if (/^https:\/\//i.test(raw) && bearer) {
    try {
      const url = new URL(raw);
      url.searchParams.set("corvo_origin", String(Date.now()));
      const response = await fetch(url, {
        cache:"no-store",
        headers:{ Authorization:`Bearer ${bearer}` },
      });
      if (response.ok && response.body) {
        const contentLength = Number(response.headers.get("content-length") || 0);
        return {
          statusCode:response.status,
          stream:response.body,
          pathname,
          access:"public" as const,
          source:"authenticated-http-origin",
          blob:{
            pathname,
            url:raw,
            downloadUrl:raw.includes("?") ? `${raw}&download=1` : `${raw}?download=1`,
            contentType:response.headers.get("content-type") || "application/octet-stream",
            contentDisposition:response.headers.get("content-disposition") || "",
            cacheControl:response.headers.get("cache-control") || "",
            etag:response.headers.get("etag") || "",
            size:contentLength || undefined,
            uploadedAt:new Date(),
          }
        };
      }
      attempts.push(`http-auth:status=${response.status}`);
    } catch (error) {
      attempts.push(`http-auth:${errorText(error)}`);
    }
  }

  const forbidden = attempts.some((attempt) => /403|forbidden/i.test(attempt));
  throw new CorvoBlobReadError(
    forbidden ? "BLOB_CONTENT_READ_FORBIDDEN" : "BLOB_CONTENT_READ_FAILED",
    forbidden
      ? "O Vercel Blob recusou a leitura do arquivo (403). O pacote continua salvo, mas a store precisa permitir leitura; verifique acesso da Blob Store e o limite de Blob Data Transfer."
      : "Não foi possível recuperar o conteúdo persistido no Vercel Blob.",
    attempts,
    forbidden ? 403 : undefined,
  );
}

export async function readCorvoBlobBuffer(raw:string) {
  const result:any = await openCorvoBlob(raw);
  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  if (!arrayBuffer.byteLength) throw new CorvoBlobReadError("BLOB_CONTENT_EMPTY", "O Blob recuperado está vazio.");
  return {
    buffer:Buffer.from(arrayBuffer),
    contentType:String(result.blob?.contentType || "application/octet-stream"),
    size:Number(result.blob?.size || arrayBuffer.byteLength),
    pathname:String(result.pathname || corvoBlobPathname(raw)),
    source:String(result.source || "blob"),
    etag:String(result.blob?.etag || ""),
  };
}
