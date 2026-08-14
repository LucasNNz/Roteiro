import { NextResponse } from "next/server";
import { isRedisConfigured } from "../../../../lib/corvo-jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { configured: isRedisConfigured() },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
