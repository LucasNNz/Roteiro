import { NextResponse } from "next/server";
import { isRedisConfigured } from "../../../../lib/corvo-jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      configured: isRedisConfigured(),
      blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)),
    },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
