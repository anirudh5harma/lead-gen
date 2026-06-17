import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ProspectsPage() {
  redirect("/dashboard/agent#verified-contacts");
}
