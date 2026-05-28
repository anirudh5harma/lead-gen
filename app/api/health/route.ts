import { checkProductReadiness } from "@/core/product/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await checkProductReadiness();
  return Response.json(readiness, {
    status: readiness.ready ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
