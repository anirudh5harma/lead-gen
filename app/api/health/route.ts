import {
  isProduction,
  missingFeatureEnvironment,
  missingRequiredProductionEnvironment,
} from "@/core/config/env.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const missingRequired = missingRequiredProductionEnvironment();
  const missingFeatures = missingFeatureEnvironment();
  const ready = !isProduction() || missingRequired.length === 0;

  return Response.json(
    {
      status: ready ? "ok" : "not_ready",
      required_environment_ready: missingRequired.length === 0,
      missing_required_environment: missingRequired,
      inactive_feature_environment: missingFeatures,
    },
    { status: ready ? 200 : 503 },
  );
}
