import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import ScrollReveal from "@/components/ui/ScrollReveal";
import { getRequestAuthIdentity } from "@/lib/auth";
import {
  normalizeCompanyWebsiteUrl,
} from "@/core/product/company-profile";
import { findCompletedOnboardingForAuthIdentity } from "@/lib/auth/onboarding";
import { googleAuthPath, PRODUCT_HOME_PATH } from "@/lib/auth/next";
import OnboardingForm from "./OnboardingForm";

export const metadata: Metadata = {
  title: "Get started | Bombsell",
};

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
    <main className="monaco-canvas relative isolate flex min-h-[100dvh] flex-1 items-center px-6 py-8 sm:px-10 lg:px-16">
      {/* Animated background */}
      <div className="animated-bg">
        <div className="animated-bg-orb animated-bg-orb-1" />
        <div className="animated-bg-orb animated-bg-orb-2" />
        <div className="animated-bg-orb animated-bg-orb-3" />
        <div className="animated-bg-orb animated-bg-orb-4" />
      </div>

      <section className="relative z-10 mx-auto grid w-full max-w-[1200px] gap-10 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="flex flex-col justify-center">
          <ScrollReveal delay={0.1}>
            <p className="mono text-[var(--color-accent)]">Get started</p>
          </ScrollReveal>
          <ScrollReveal delay={0.2}>
            <h1 className="display-serif mt-4 max-w-xl text-[clamp(2rem,4vw,3.5rem)] text-[var(--color-text-1)]">
              Start with a website and one clear intent.
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={0.3}>
            <p className="mt-5 max-w-md text-[17px] leading-[1.6] text-[var(--color-text-2)]">
              Bombsell turns your public site into a profile, source list, and starter work map.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.4}>
            <div className="mt-8 grid gap-4">
              <FlowStep icon="language" label="Website" text="Positioning, audience, and proof become context." />
              <FlowStep icon="account_tree" label="Canvas" text="Profile, signals, plays, and outcomes are connected." />
              <FlowStep icon="fact_check" label="Review" text="Only exceptions come back to you." />
            </div>
          </ScrollReveal>
        </div>

        <ScrollReveal delay={0.3}>
          <section className="onboard-panel flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-accent)] text-[var(--color-accent-on)] shadow-[0_8px_20px_-12px_rgba(38,87,94,0.25)]">
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
        </ScrollReveal>
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
    <div className="grid grid-cols-[40px_1fr] gap-3">
      <span className="flex size-9 items-center justify-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
        <Icon name={icon} size={18} />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-[var(--color-text-1)]">{label}</span>
        <span className="block text-[13px] leading-5 text-[var(--color-text-3)]">{text}</span>
      </span>
    </div>
  );
}
