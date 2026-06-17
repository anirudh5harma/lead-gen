import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ProspectingPage() {
  redirect("/dashboard/profile#profile");
}
