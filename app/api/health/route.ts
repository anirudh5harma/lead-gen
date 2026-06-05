import { checkProductReadinessCached } from "@/core/product/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const readiness = await checkProductReadinessCached({
    forceRefresh: url.searchParams.get("fresh") === "1",
  });
  return Response.json(readiness, {
    status: readiness.ready ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
