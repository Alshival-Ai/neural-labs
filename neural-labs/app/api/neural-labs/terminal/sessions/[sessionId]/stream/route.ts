import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  return jsonError(
    "Terminal stream endpoint has been replaced by websocket transport.",
    410
  );
}
