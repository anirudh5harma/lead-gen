import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function PlaysPage() {
  redirect("/dashboard/agent#learning");
}
