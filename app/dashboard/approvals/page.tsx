import { redirect } from "next/navigation";

export default function LegacyApprovalsPage() {
  redirect("/dashboard/agent#review-queue");
}
