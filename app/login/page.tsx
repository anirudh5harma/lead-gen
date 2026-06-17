import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
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
  const error = params.error;

  if (!error) {
    redirect(googleAuthPath(next));
  }

  return (
    <main className="monaco-canvas relative isolate flex min-h-[100dvh] flex-1 items-center justify-center px-6 py-16">
      {/* Animated background */}
      <div className="animated-bg">
        <div className="animated-bg-orb animated-bg-orb-1" />
        <div className="animated-bg-orb animated-bg-orb-2" />
        <div className="animated-bg-orb animated-bg-orb-3" />
        <div className="animated-bg-orb animated-bg-orb-4" />
      </div>

      <section className="onboard-panel relative z-10 w-full max-w-[440px]">
        <p className="mono text-[var(--color-accent)]">Bombsell account</p>
        <h1 className="display-serif mt-4 text-[1.75rem] text-[var(--color-text-1)]">
          Sign in to your workspace
        </h1>
        <p className="mt-3 text-[15px] leading-[1.6] text-[var(--color-text-2)]">
          Use Google to continue. Brief, outreach, profile, and review work stay on one canvas.
        </p>
        <p className="mt-5 rounded-[10px] border border-[var(--color-neg)] bg-[var(--color-neg-bg)] px-4 py-3 text-sm leading-6 text-[var(--color-neg)]">
          Authentication did not complete. Try again.
        </p>
        <Link
          href={googleAuthPath(next)}
          className="btn-solid mt-6 inline-flex w-full justify-center"
        >
          <Icon name="login" size={18} />
          Continue with Google
        </Link>
      </section>
    </main>
  );
}
