import { mcpProtectedResourceMetadata } from "@/core/mcp/oauth-metadata.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json(mcpProtectedResourceMetadata(request), {
    headers: metadataHeaders(),
  });
}

function metadataHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  };
}
