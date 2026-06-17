import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  redirect("/dashboard/agent#learning");
}
