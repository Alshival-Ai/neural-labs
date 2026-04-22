import { NextResponse } from "next/server";

import { readNeuraConfig } from "@/lib/server/neura";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await readNeuraConfig());
}
