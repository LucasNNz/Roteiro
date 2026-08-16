import { NextResponse } from "next/server";
import { isRedisConfigured } from "../../../../lib/corvo-jobs";
import { isCorvoObjectStorageConfigured } from "../../../../lib/corvo-blob";

export const dynamic = "force-dynamic";

export async function GET() {
  const storageConfigured = isCorvoObjectStorageConfigured();
  return NextResponse.json(
    {
      configured: isRedisConfigured(),
      storageConfigured,
      storageProvider:"R2",
      blobConfigured:storageConfigured,
    },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
