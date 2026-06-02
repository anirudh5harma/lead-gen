import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import { getRequestAuthIdentity } from "@/lib/auth";
import {
  normalizeCompanyWebsiteUrl,
} from "@/core/product/company-profile";
import { findCompletedOnboardingForAuthIdentity } from "@/lib/auth/onboarding";
import { googleAuthPath, PRODUCT_HOME_PATH } from "@/lib/auth/next";
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
  const identity = await getRequestAuthIdentity();
  if (!identity) {
    const next =
      initialWebsiteUrl || initialCompanyName
        ? `/onboarding?${new URLSearchParams({
            ...(initialWebsiteUrl ? { url: initialWebsiteUrl } : {}),
            ...(initialCompanyName ? { company: initialCompanyName } : {}),
          }).toString()}`
        : "/onboarding";
    redirect(googleAuthPath(next));
  }
  const completed = await findCompletedOnboardingForAuthIdentity(identity);
  if (completed) redirect(PRODUCT_HOME_PATH);

  return (
    <main className="canvas-bg flex min-h-[100dvh] flex-1 items-center px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="flex flex-col justify-center">
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

        <section className="onboard-panel flex flex-col justify-center">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-accent-hi)] text-[var(--color-accent-on)] shadow-[0_8px_20px_-12px_rgba(35,84,88,0.7)]">
              <Icon name="rocket_launch" size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="font-sans text-2xl font-semibold leading-tight text-[var(--color-text-1)]">
                Create your workspace
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
                Two fields. We build the rest from your site.
              </p>
            </div>
          </div>

          <div className="my-6 h-px bg-[var(--color-line-1)]" />

          <OnboardingForm
            initialWebsiteUrl={initialWebsiteUrl}
            initialCompanyName={initialCompanyName}
          />

          <p className="mt-6 flex items-center gap-1.5 text-xs leading-5 text-[var(--color-text-4)]">
            <Icon name="lock" size={14} />
            Private to your workspace. Nothing is published until you approve it.
          </p>
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
