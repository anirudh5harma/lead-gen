import { redirect } from "next/navigation";

export default function LegacyOpsPage() {
  redirect("/dashboard/health");
}
