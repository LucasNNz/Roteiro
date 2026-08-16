import { NextResponse } from "next/server";
import { isRedisConfigured } from "../../../../lib/corvo-jobs";
import { CorvoBlobReadError, isCorvoObjectStorageConfigured, probeCorvoObjectStorage } from "../../../../lib/corvo-blob";

export const dynamic = "force-dynamic";

export async function GET() {
  const storageConfigured = isCorvoObjectStorageConfigured();
  let storageReachable = false;
  let storageCode = storageConfigured ? "" : "R2_NOT_CONFIGURED";
  let storageMessage = storageConfigured ? "" : "Cloudflare R2 não configurado.";
  if (storageConfigured) {
    try {
      await probeCorvoObjectStorage();
      storageReachable = true;
    } catch (error) {
      storageCode = error instanceof CorvoBlobReadError ? error.code : "R2_PROBE_FAILED";
      storageMessage = error instanceof Error ? error.message : String(error || "R2_PROBE_FAILED");
    }
  }
  return NextResponse.json(
    {
      configured: isRedisConfigured(),
      storageConfigured,
      storageReachable,
      storageCode,
      storageMessage,
      storageProvider:"R2",
      blobConfigured:storageConfigured,
    },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
