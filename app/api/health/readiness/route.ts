import { checkProductReadinessCached } from "@/core/product/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const readiness = await checkProductReadinessCached({
    forceRefresh: fresh,
    liveProbes: fresh,
  });
  return Response.json(readiness, {
    status: readiness.ready ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
