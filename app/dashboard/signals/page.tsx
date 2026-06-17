import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SignalsPage() {
  redirect("/dashboard/agent#opportunities");
}
