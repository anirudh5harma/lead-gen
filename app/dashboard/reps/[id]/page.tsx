import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RepDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/agent/${id}`);
}
