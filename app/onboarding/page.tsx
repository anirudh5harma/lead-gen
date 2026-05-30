import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import { getRequestUserId } from "@/lib/auth";
import {
  normalizeCompanyWebsiteUrl,
} from "@/core/product/company-profile";
import { googleAuthPath } from "@/lib/auth/next";
import OnboardingForm from "./OnboardingForm";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ url?: string; company?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const initialWebsiteUrl = normalizeCompanyWebsiteUrl(params.url) ?? "";
  const initialCompanyName = typeof params.company === "string" ? params.company : "";
  const userId = await getRequestUserId();
  if (!userId) {
    const next =
      initialWebsiteUrl || initialCompanyName
        ? `/onboarding?${new URLSearchParams({
            ...(initialWebsiteUrl ? { url: initialWebsiteUrl } : {}),
            ...(initialCompanyName ? { company: initialCompanyName } : {}),
          }).toString()}`
        : "/onboarding";
    redirect(googleAuthPath(next));
  }

  return (
    <main className="canvas-bg flex min-h-[100dvh] flex-1 items-center px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="flex flex-col justify-center">
          <p className="brief-kicker">New workspace</p>
          <h1 className="mt-3 max-w-xl font-sans text-5xl font-semibold leading-[1.02] text-[var(--color-text-1)] sm:text-6xl">
            Start with a website and one clear intent.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-[var(--color-text-2)]">
            Bombsell turns your public site into a profile, source list, and starter work map.
          </p>
          <div className="mt-8 grid gap-3">
            <FlowStep icon="language" label="Website" text="Positioning, audience, and proof become context." />
            <FlowStep icon="account_tree" label="Canvas" text="Profile, signals, plays, and outcomes are connected." />
            <FlowStep icon="fact_check" label="Review" text="Only exceptions come back to you." />
          </div>
        </div>

        <section className="section-note">
          <h2 className="font-sans text-2xl font-semibold text-[var(--color-text-1)]">
            Create your workspace
          </h2>
          <OnboardingForm
            initialWebsiteUrl={initialWebsiteUrl}
            initialCompanyName={initialCompanyName}
          />
        </section>
      </section>
    </main>
  );
}

function FlowStep({
  icon,
  label,
  text,
}: {
  icon: string;
  label: string;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-3">
      <span className="flex size-9 items-center justify-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
        <Icon name={icon} size={18} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">{label}</span>
        <span className="block text-sm leading-5 text-[var(--color-text-3)]">{text}</span>
      </span>
    </div>
  );
}
