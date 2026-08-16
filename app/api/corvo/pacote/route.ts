import { put } from "@vercel/blob";
import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { attachCorvoFile, getCorvoJob, listCollectorCandidates, updateCorvoAnalysisPreparation } from "../../../../lib/corvo-jobs";
import { storageFailure } from "../../../../lib/corvo-api";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 160);
}

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 }); }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const token = request.headers.get("x-corvo-upload-token")?.trim() || (typeof body.uploadToken === "string" ? body.uploadToken.trim() : "");
  const requestedName = typeof body.fileName === "string" ? safeName(body.fileName) : "";
  const selectionMode = body.selectionMode === "AUTO" ? "AUTO" : "MANUAL";
  if (!jobId || !token) return NextResponse.json({ ok: false, message: "Informe jobId e token." }, { status: 400 });
  if (!blobAvailable()) return NextResponse.json({ ok: false, message: "Vercel Blob não configurado." }, { status: 503 });

  try {
    const job = await getCorvoJob(jobId);
    if (!job || job.uploadToken !== token) return NextResponse.json({ ok: false, message: "Trabalho ou token inválido." }, { status: 404 });
    if (job.request.specialist !== "ANALISTA") return NextResponse.json({ ok: false, message: "O pacote de entrada pertence ao trabalho do Analista." }, { status: 409 });

    const candidates = await listCollectorCandidates(jobId, token);
    if (!candidates?.length) return NextResponse.json({ ok: false, message: "Nenhuma candidata do Collector foi recebida." }, { status: 409 });
    await updateCorvoAnalysisPreparation(jobId, token, {
      stage:"ZIP_BUILDING",
      storedCandidates:candidates.length,
      storedIds:new Set(candidates.map((candidate) => String(candidate.id))).size,
      packageFileName:requestedName || undefined,
      selectionMode,
      error:undefined,
    });

    const expectedIds = (job.request.ids || []).map((id) => String(id));
    const grouped = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const bucket = grouped.get(String(candidate.id)) || [];
      bucket.push(candidate);
      grouped.set(String(candidate.id), bucket);
    }
    const missingIds = expectedIds.filter((id) => !(grouped.get(id)?.length));
    if (missingIds.length) {
      return NextResponse.json({ ok: false, message: `Faltam candidatas para ${missingIds.length} ID(s): ${missingIds.slice(0, 12).join(", ")}${missingIds.length > 12 ? "..." : ""}.` }, { status: 409 });
    }

    const ordered = [...candidates].sort((a, b) => {
      const byId = String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true });
      return byId || a.name.localeCompare(b.name, "pt-BR", { numeric: true });
    });
    const zip = new JSZip();
    const failures: string[] = [];
    const batchGroups = new Map<string, typeof ordered>();
    const directCandidates = ordered.filter((candidate) => {
      const batchUrl = String(candidate.batchUrl || "").trim();
      if (!batchUrl) return true;
      const bucket = batchGroups.get(batchUrl) || [];
      bucket.push(candidate);
      batchGroups.set(batchUrl, bucket);
      return false;
    });

    // Compatibilidade com uploads antigos: candidatos individuais continuam funcionando.
    let directCursor = 0;
    const directWorkers = Math.min(8, directCandidates.length);
    await Promise.all(Array.from({ length:directWorkers }, async () => {
      while (true) {
        const index = directCursor++;
        if (index >= directCandidates.length) return;
        const candidate = directCandidates[index];
        try {
          const response = await fetch(candidate.url, { cache:"no-store" });
          if (!response.ok) throw new Error(`HTTP_${response.status}`);
          zip.file(candidate.name, await response.arrayBuffer());
        } catch (error) {
          failures.push(`${candidate.id}|${candidate.name}|${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }));

    // Novo modo em lotes: cada ZIP do Collector é baixado UMA vez e pode conter
    // dezenas de candidatas, evitando centenas de round-trips ao Blob.
    const batchEntries = [...batchGroups.entries()];
    let batchCursor = 0;
    const batchWorkers = Math.min(4, batchEntries.length);
    await Promise.all(Array.from({ length:batchWorkers }, async () => {
      while (true) {
        const index = batchCursor++;
        if (index >= batchEntries.length) return;
        const [batchUrl, batchCandidates] = batchEntries[index];
        try {
          const response = await fetch(batchUrl, { cache:"no-store" });
          if (!response.ok) throw new Error(`HTTP_${response.status}`);
          const batchZip = await JSZip.loadAsync(await response.arrayBuffer());
          const byName = new Map(Object.values(batchZip.files).filter((entry) => !entry.dir).map((entry) => [entry.name.toLocaleLowerCase("pt-BR"), entry]));
          for (const candidate of batchCandidates) {
            const entryName = String(candidate.batchEntry || candidate.name).toLocaleLowerCase("pt-BR");
            const entry = byName.get(entryName);
            if (!entry) { failures.push(`${candidate.id}|${candidate.name}|BATCH_ENTRY_MISSING`); continue; }
            zip.file(candidate.name, await entry.async("nodebuffer"));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const candidate of batchCandidates) failures.push(`${candidate.id}|${candidate.name}|${message}`);
        }
      }
    }));
    if (failures.length) {
      return NextResponse.json({ ok: false, message: `Não foi possível recuperar ${failures.length} candidata(s) do armazenamento.`, failures: failures.slice(0, 30) }, { status: 502 });
    }

    const filesById = expectedIds.map((id) => ({
      id,
      files:(grouped.get(id) || []).sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric:true })).map((candidate) => candidate.name),
    }));
    zip.file("CORVO_ANALISE_INPUT.json", JSON.stringify({
      protocol: "corvo-analysis-input/1.1",
      mode: selectionMode,
      jobId,
      projectId: job.request.projetoId || "",
      generatedAt: new Date().toISOString(),
      idsExpected: expectedIds,
      totalIds: expectedIds.length,
      totalCandidates: ordered.length,
      candidatesById: filesById,
      files: ordered.map((candidate) => ({ id:candidate.id, name:candidate.name, contentType:candidate.contentType, size:candidate.size, storageMode:candidate.storageMode || "FILE", batchName:candidate.batchName || "" })),
    }, null, 2));
    zip.file("CORVO_ANALISE_GUIA.txt", [
      "CORVO ANALISTA — PACOTE DE CANDIDATAS",
      "VERSION=1.1",
      `MODO=${selectionMode}`,
      `TOTAL_IDS=${expectedIds.length}`,
      `TOTAL_CANDIDATAS=${ordered.length}`,
      "",
      "REGRA: compare TODAS as candidatas de cada ID. Para PASSOU/PASSOU_COM_RESSALVAS, devolva ARQUIVO com o nome exato da candidata escolhida.",
      "",
      ...filesById.flatMap((entry) => [`[ID:${entry.id}]`, ...entry.files.map((name) => `ARQUIVO=${name}`), ""]),
    ].join("\n"));

    const content = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    const fileName = requestedName || `${safeName(job.request.projetoId || jobId)}_COLLECTOR_CANDIDATAS.zip`;
    const blob = await put(`corvoquiz/${jobId}/${fileName}`, content, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/zip",
      cacheControlMaxAge: 60 * 60 * 24 * 7,
    });
    const updated = await attachCorvoFile(jobId, token, {
      type: "COLLECTOR_ZIP",
      name: fileName,
      url: blob.url,
      downloadUrl: blob.downloadUrl,
      contentType: "application/zip",
      size: content.byteLength,
      createdAt: new Date().toISOString(),
    });
    if (!updated) return NextResponse.json({ ok: false, message: "Trabalho não encontrado ou expirado." }, { status: 404 });
    await updateCorvoAnalysisPreparation(jobId, token, {
      stage:"ZIP_SAVED",
      storedCandidates:ordered.length,
      storedIds:new Set(ordered.map((candidate) => String(candidate.id))).size,
      packageFileName:fileName,
      selectionMode,
      error:undefined,
    });
    return NextResponse.json({
      ok: true,
      jobId,
      file: updated.files?.find((file) => file.type === "COLLECTOR_ZIP" && file.name === fileName),
      imageCount: ordered.length,
      idCount: expectedIds.length,
      selectionMode,
      failures,
    });
  } catch (error) {
    if (jobId && token) {
      try {
        await updateCorvoAnalysisPreparation(jobId, token, {
          stage:"ZIP_BUILDING",
          packageFileName:requestedName || undefined,
          selectionMode,
          error:error instanceof Error ? error.message : String(error),
        });
      } catch {}
    }
    return storageFailure(error);
  }
}
