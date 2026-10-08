import { startCampaign } from "@/lib/services/start-campaign";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  try {
    const result = await startCampaign(id, identity);
    if (result === "missing") return jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404);
    if (result === "invalid") return jsonError("INVALID_STATE", "Campaign cannot be started in its current state.", 409);
    if (result === "missing_variants") return jsonError("MISSING_VARIANTS", "Add at least one content variant before starting a round-robin campaign.", 409);
    return jsonSuccess({ queued: result });
  } catch {
    return jsonError("START_FAILED", "Unable to start the campaign.", 500);
  }
}
