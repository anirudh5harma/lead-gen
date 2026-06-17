import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { googleAuthPath, safeNextPath } from "@/lib/auth/next";

export const metadata: Metadata = {
  title: "Sign in | Bombsell",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(params.next);
  redirect(googleAuthPath(next));
}
