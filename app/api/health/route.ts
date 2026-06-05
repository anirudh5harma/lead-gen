import { checkProductLiveness } from "@/core/product/liveness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const needsReadiness = fresh || url.searchParams.get("readiness") === "1";
  const readiness = needsReadiness
    ? await import("@/core/product/health").then(({ checkProductReadinessCached }) =>
        checkProductReadinessCached({
          forceRefresh: fresh,
          liveProbes: fresh,
        }),
      )
    : checkProductLiveness();
  return Response.json(readiness, {
    status: readiness.ready ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
