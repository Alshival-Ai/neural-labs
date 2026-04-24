import { NextResponse } from "next/server";

import { clearSessionCookie, logoutWithRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  logoutWithRequest(request);
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
