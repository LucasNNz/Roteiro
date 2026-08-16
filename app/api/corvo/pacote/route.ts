import { put } from "@vercel/blob";
import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { attachCorvoFile, getCorvoJob, listCollectorCandidates } from "../../../../lib/corvo-jobs";
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
    let cursor = 0;
    const workerCount = Math.min(16, ordered.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= ordered.length) return;
        const candidate = ordered[index];
        try {
          const response = await fetch(candidate.url, { cache: "no-store" });
          if (!response.ok) throw new Error(`HTTP_${response.status}`);
          const bytes = await response.arrayBuffer();
          zip.file(candidate.name, bytes);
        } catch (error) {
          failures.push(`${candidate.id}|${candidate.name}|${error instanceof Error ? error.message : String(error)}`);
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
      files: ordered.map((candidate) => ({ id:candidate.id, name:candidate.name, contentType:candidate.contentType, size:candidate.size })),
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
    return storageFailure(error);
  }
}
