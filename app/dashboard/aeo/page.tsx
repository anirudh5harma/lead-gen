import { redirect } from "next/navigation";

export default function LegacyAeoPage() {
  redirect("/dashboard/plays");
}
