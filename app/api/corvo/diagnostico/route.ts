import { NextResponse } from "next/server";
import { isRedisConfigured } from "../../../../lib/corvo-jobs";
import { CorvoBlobReadError, corvoR2ConfigWarnings, isCorvoObjectStorageConfigured, probeCorvoObjectStorage, type CorvoR2DiagnosticStep } from "../../../../lib/corvo-blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const storageConfigured = isCorvoObjectStorageConfigured();
  let storageReachable = false;
  let storageCode = storageConfigured ? "" : "R2_NOT_CONFIGURED";
  let storageMessage = storageConfigured ? "" : "Cloudflare R2 não configurado.";
  let storageDiagnostics:CorvoR2DiagnosticStep[] = [];
  let storageEndpoint = "";
  let storageBucket = process.env.R2_BUCKET_NAME?.trim() || process.env.R2_BUCKET?.trim() || "";
  let storageSdk = "@aws-sdk/client-s3";

  if (storageConfigured) {
    try {
      const probe = await probeCorvoObjectStorage();
      storageReachable = true;
      storageEndpoint = probe.endpoint;
      storageBucket = probe.bucket;
      storageSdk = probe.sdk;
      storageDiagnostics = probe.diagnostics;
      storageCode = "R2_READY";
      storageMessage = "Cloudflare R2 validado com leitura e escrita reais.";
    } catch (error) {
      storageCode = error instanceof CorvoBlobReadError ? error.code : "R2_PROBE_FAILED";
      storageMessage = error instanceof Error ? error.message : String(error || "R2_PROBE_FAILED");
      storageDiagnostics = error instanceof CorvoBlobReadError ? (error.diagnostics || []) : [];
      try {
        const raw = process.env.R2_ENDPOINT?.trim() || "";
        storageEndpoint = raw ? new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin : "";
      } catch { storageEndpoint = String(process.env.R2_ENDPOINT || "").trim(); }
    }
  }

  return NextResponse.json(
    {
      configured:isRedisConfigured(),
      storageConfigured,
      storageReachable,
      storageCode,
      storageMessage,
      storageProvider:"R2",
      storageSdk,
      storageEndpoint,
      storageBucket,
      storageDiagnostics,
      storageWarnings:corvoR2ConfigWarnings(),
      // alias legado para versões antigas da UI
      blobConfigured:storageConfigured,
    },
    { headers:{ "cache-control":"no-store, max-age=0" } },
  );
}
