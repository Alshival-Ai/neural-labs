import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST() {
  return jsonError(
    "Initial admin provisioning now happens from NEURAL_LABS_INITIAL_ADMIN_EMAIL and NEURAL_LABS_INITIAL_ADMIN_PASSWORD in .env.",
    410
  );
}
