import AgentOutreachDetailPage from "@/app/dashboard/agent/outreach/[id]/page";

export const dynamic = "force-dynamic";

export default function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ section?: string | string[] }>;
}) {
  return <AgentOutreachDetailPage params={params} searchParams={searchParams} />;
}
