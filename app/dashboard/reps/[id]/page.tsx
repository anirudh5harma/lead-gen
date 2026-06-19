import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RepDetailRedirectPage() {
  redirect("/dashboard/agent#system");
}
