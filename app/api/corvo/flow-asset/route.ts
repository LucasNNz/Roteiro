import { NextRequest, NextResponse } from "next/server";
import { isCorvoObjectStorageConfigured, putCorvoObject, readCorvoBlobBuffer } from "../../../../lib/corvo-blob";
import { storageFailure } from "../../../../lib/corvo-api";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 18 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

function safe(value:string, fallback="asset") {
  const clean = String(value || "").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180);
  return clean || fallback;
}

function sameOrigin(request:NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function POST(request:NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ok:false,message:"Origem não autorizada."},{status:403});
  let form:FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ok:false,message:"Envie multipart/form-data válido."},{status:400}); }

  const projectId = safe(String(form.get("projectId") || ""), "project");
  const batchId = safe(String(form.get("batchId") || ""), "batch");
  const itemId = safe(String(form.get("id") || ""), "id");
  const fileName = safe(String(form.get("fileName") || ""), `${itemId}.png`);
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ok:false,message:"Arquivo de imagem ausente."},{status:400});
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ok:false,message:"Imagem acima de 18 MB."},{status:413});
  if (file.type && !ALLOWED_TYPES.has(file.type)) return NextResponse.json({ok:false,message:`Formato não permitido: ${file.type}`},{status:415});
  if (!isCorvoObjectStorageConfigured()) return NextResponse.json({ok:false,message:"Cloudflare R2 não configurado."},{status:503});

  try {
    const key = `corvoquiz/flow/${projectId}/${batchId}/${itemId}_${fileName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await putCorvoObject(key, bytes, { contentType:file.type || "application/octet-stream", cacheControl:"private, max-age=0, no-store" });
    const stableUrl = `/api/corvo/flow-asset?path=${encodeURIComponent(stored.pathname)}`;
    return NextResponse.json({ ok:true, projectId, batchId, id:itemId, fileName, pathname:stored.pathname, url:stableUrl, size:file.size, contentType:file.type });
  } catch (error) { return storageFailure(error); }
}

export async function GET(request:NextRequest) {
  const path = String(request.nextUrl.searchParams.get("path") || "").trim();
  if (!path || !path.startsWith("corvoquiz/flow/")) return NextResponse.json({ok:false,message:"Caminho inválido."},{status:400});
  try {
    const result = await readCorvoBlobBuffer(path);
    return new Response(result.buffer, {
      status:200,
      headers:{
        "content-type":result.contentType || "application/octet-stream",
        "content-length":String(result.size || result.buffer.byteLength),
        "cache-control":"private, max-age=0, no-store",
      },
    });
  } catch (error) { return storageFailure(error); }
}
