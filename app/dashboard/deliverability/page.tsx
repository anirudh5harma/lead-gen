import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DeliverabilityPage() {
  redirect("/dashboard/profile#channels");
}
