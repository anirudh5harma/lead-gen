import AgentOutreachDetailPage from "@/app/dashboard/agent/outreach/[id]/page";

export const dynamic = "force-dynamic";

export default function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <AgentOutreachDetailPage params={params} />;
}
