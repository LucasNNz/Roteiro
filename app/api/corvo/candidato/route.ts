import { put } from "@vercel/blob";
import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { getCollectorCandidatesByName, getCorvoJob } from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";
import { readCorvoBlobBuffer } from "../../../../lib/corvo-blob";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeName(value:string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180);
}

function contentType(name:string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok:false, message:"JSON inválido." }, { status:400 }); }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const token = request.headers.get("x-corvo-upload-token")?.trim() || (typeof body.uploadToken === "string" ? body.uploadToken.trim() : "");
  const names = Array.isArray(body.fileNames) ? body.fileNames.map((name) => String(name || "").trim()).filter(Boolean).slice(0, 500) : [];
  if (!jobId || !token || !names.length) return NextResponse.json({ ok:false, message:"Informe jobId, token e fileNames." }, { status:400 });

  try {
    const job = await getCorvoJob(jobId);
    if (!job || job.uploadToken !== token || job.request.specialist !== "ANALISTA") return NextResponse.json({ ok:false, message:"Trabalho ou token inválido." }, { status:404 });
    const packageFile = (job.files || []).find((file) => file.type === "COLLECTOR_ZIP");
    if (!packageFile?.url) return NextResponse.json({ ok:false, message:"O ZIP bruto do Collector ainda não está disponível." }, { status:409 });

    const registryFiles = await getCollectorCandidatesByName(jobId, token, names);
    if (!registryFiles) return NextResponse.json({ ok:false, message:"Trabalho do Analista não encontrado." }, { status:404 });
    const registryByName = new Map(registryFiles.map((file) => [file.name.toLocaleLowerCase("pt-BR"), file]));
    const absentFromRegistry = names.filter((name) => !registryByName.has(name.toLocaleLowerCase("pt-BR")));
    if (absentFromRegistry.length) return NextResponse.json({ ok:false, message:`${absentFromRegistry.length} arquivo(s) escolhido(s) pelo Analista não existem no registro do pacote bruto.`, missing:absentFromRegistry }, { status:409 });

    const packageSource = await readCorvoBlobBuffer(packageFile.downloadUrl || packageFile.url);
    const zip = await JSZip.loadAsync(packageSource.buffer);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    const zipByName = new Map(entries.map((entry) => [entry.name.toLocaleLowerCase("pt-BR"), entry]));
    const extracted = [];

    for (const requestedName of names) {
      const entry = zipByName.get(requestedName.toLocaleLowerCase("pt-BR"));
      const registry = registryByName.get(requestedName.toLocaleLowerCase("pt-BR"));
      if (!entry || !registry) return NextResponse.json({ ok:false, message:`A candidata ${requestedName} não foi encontrada dentro do ZIP bruto.` }, { status:409 });
      const bytes = await entry.async("nodebuffer");
      if (!bytes.byteLength) return NextResponse.json({ ok:false, message:`A candidata ${requestedName} está vazia dentro do ZIP bruto.` }, { status:409 });
      const name = safeName(requestedName);
      const blob = await put(`corvoquiz/${jobId}/selected/${name}`, bytes, {
        access:"public",
        addRandomSuffix:false,
        allowOverwrite:true,
        contentType:contentType(name),
        cacheControlMaxAge:60 * 60 * 24 * 7,
      });
      extracted.push({
        id:registry.id,
        name:requestedName,
        url:blob.url,
        downloadUrl:blob.downloadUrl,
        contentType:contentType(name),
        size:bytes.byteLength,
      });
    }

    return NextResponse.json({ ok:true, jobId, sourceZip:packageFile.name, files:extracted });
  } catch (error) {
    return storageFailure(error);
  }
}
