import { redirect } from "next/navigation";

export default async function LegacyConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/agent/outreach/${id}`);
}
