import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(params.next ?? "/onboarding");
  const error = params.error;

  async function signInWithGoogle() {
    "use server";
    const supabase = await createServerSupabaseClient();
    const h = await headers();
    const origin =
      process.env.APP_ORIGIN?.replace(/\/$/, "") ??
      `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error || !data.url) {
      redirect(`/login?error=oauth&next=${encodeURIComponent(next)}`);
    }
    redirect(data.url);
  }

  return (
    <main className="canvas-bg flex flex-1 items-center justify-center px-4 py-16">
      <section className="section-note w-full max-w-[440px]">
        <p className="brief-kicker">Bombsell account</p>
        <h1 className="font-sans text-2xl font-semibold text-[var(--color-text-1)]">
          Sign in to your workspace
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-2)]">
          Use Google to continue. Brief, outreach, profile, and review work stay on one canvas.
        </p>
        {error ? (
          <p className="mt-4 rounded-md border border-[var(--color-line-2)] bg-[var(--color-ink-1)] px-3 py-2 text-sm text-[var(--color-accent)]">
            Authentication did not complete. Try again.
          </p>
        ) : null}
        <form action={signInWithGoogle} className="mt-6">
          <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
            <Icon name="login" size={18} />
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}

function safeNextPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/onboarding";
}
