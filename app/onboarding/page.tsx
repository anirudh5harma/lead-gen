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
  title: "Launch Agent | Bombsell",
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
    <main className="monaco-canvas relative isolate flex min-h-[100dvh] flex-1 items-center bg-[var(--color-ink-1)] px-6 py-8 sm:px-10 lg:px-16">
      <section className="relative z-10 mx-auto grid w-full max-w-[1120px] gap-10 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="flex flex-col justify-center">
          <ScrollReveal delay={0.1}>
            <p className="mono text-[var(--color-accent)]">Launch agent</p>
          </ScrollReveal>
          <ScrollReveal delay={0.2}>
            <h1 className="display-serif mt-4 max-w-xl text-[clamp(2rem,4vw,3.5rem)] text-[var(--color-text-1)]">
              Enter your website. Bombsell builds the Profile.
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={0.3}>
            <p className="mt-5 max-w-md text-[17px] leading-[1.6] text-[var(--color-text-2)]">
              Add your positioning, proof, and goals once. Bombsell turns that
              Profile into signal sources, verified contacts, and email or
              LinkedIn outreach once your channels are connected.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.4}>
            <div className="mt-8 grid gap-3">
              <FlowStep number="1" label="Website" text="Your site becomes company, audience, voice, and signal context." />
              <FlowStep number="2" label="Profile + channels" text="Connect Outlook and LinkedIn in Profile before outreach can run." />
              <FlowStep number="3" label="Agent" text="Signals, verified contacts, drafts, sends, and replies stay together under Agent." />
            </div>
          </ScrollReveal>
        </div>

        <ScrollReveal delay={0.3}>
          <section className="onboard-panel flex flex-col justify-center">
            <div className="mb-6 flex items-center gap-2" aria-label="Onboarding progress">
              {[1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={
                    step === 1
                      ? "h-2.5 flex-1 rounded-full bg-[var(--color-accent)]"
                      : "h-2.5 flex-1 rounded-full bg-[var(--color-line-2)]"
                  }
                />
              ))}
            </div>
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-accent)] text-[var(--color-accent-on)] shadow-[0_8px_20px_-12px_rgba(38,87,94,0.25)]">
                <Icon name="auto_awesome" size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="font-sans text-2xl font-semibold leading-tight text-[var(--color-text-1)]">
                  Build launch Profile
                </h2>
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
                  Website analysis plus the context needed to create sources,
                  plays, and the first Agent queue.
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
  number,
  label,
  text,
}: {
  number: string;
  label: string;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[40px_1fr] gap-3">
      <span className="flex size-9 items-center justify-center rounded-[8px] bg-[var(--color-accent-bg)] font-mono text-xs font-semibold text-[var(--color-accent)]">
        {number}
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-[var(--color-text-1)]">{label}</span>
        <span className="block text-[13px] leading-5 text-[var(--color-text-3)]">{text}</span>
      </span>
    </div>
  );
}
