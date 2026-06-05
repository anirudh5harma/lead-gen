import { checkProductLiveness } from "@/core/product/liveness";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fresh = url.searchParams.get("fresh") === "1";
  if (fresh || url.searchParams.get("readiness") === "1") {
    const next = new URL("/api/health/readiness", url.origin);
    if (fresh) next.searchParams.set("fresh", "1");
    return Response.redirect(next, 307);
  }

  const liveness = checkProductLiveness();
  return Response.json(liveness, {
    status: liveness.ready ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
