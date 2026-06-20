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
    <main className="relative isolate flex min-h-[100dvh] flex-1 items-center bg-[var(--color-ink-1)] px-4 py-10 md:px-8 lg:px-12">
      <section className="relative z-10 mx-auto grid w-full max-w-[1180px] items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
        <div className="flex flex-col justify-center">
          <ScrollReveal delay={0.05}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-cta-bg)] px-2.5 py-1 text-[12px] font-semibold tracking-[-0.01em] text-[var(--color-brand-green-bright)]">
              <span className="size-1.5 rounded-full bg-[var(--color-brand-green-bright)]" />
              Launch agent
            </span>
          </ScrollReveal>
          <ScrollReveal delay={0.15}>
            <h1
              className="mt-5 max-w-[14ch] text-[clamp(2.25rem,5vw,4rem)] font-bold leading-[1.0] tracking-[-0.03em] text-[var(--color-text-1)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Enter your website. Bombsell builds the Profile.
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={0.25}>
            <p className="mt-6 max-w-[460px] text-[17px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
              Bombsell reads your site, builds positioning, proof, and goals,
              then turns them into signal sources, verified contacts, and outreach.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.35}>
            <div className="mt-9 grid gap-3">
              <FlowStep
                number="1"
                tone="pink"
                label="Website"
                text="Becomes company, audience, voice, signal context."
              />
              <FlowStep
                number="2"
                tone="yellow"
                label="Profile + channels"
                text="Connect Outlook and LinkedIn in Profile."
              />
              <FlowStep
                number="3"
                tone="green"
                label="Agent"
                text="Signals, verified contacts, drafts, sends, and replies."
              />
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
                      ? "h-1.5 flex-1 rounded-full bg-[var(--color-cta-bg)]"
                      : "h-1.5 flex-1 rounded-full bg-[var(--color-line-2)]"
                  }
                />
              ))}
            </div>
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]">
                <Icon name="auto_awesome" size={19} />
              </span>
              <div className="min-w-0">
                <h2
                  className="text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-text-1)]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Build launch Profile
                </h2>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-3)]">
                  Website analysis plus the context to create sources, outreach rules, and the first Agent queue.
                </p>
              </div>
            </div>

            <div className="my-6 h-px bg-[var(--color-line-1)]" />

            <OnboardingForm
              initialWebsiteUrl={initialWebsiteUrl}
              initialCompanyName={initialCompanyName}
            />

            <p className="mt-6 flex items-center gap-1.5 text-[12px] leading-5 text-[var(--color-text-3)]">
              <Icon name="lock" size={13} />
              Private to your workspace. Nothing is published until you approve it.
            </p>
          </section>
        </ScrollReveal>
      </section>
    </main>
  );
}

const TONE_CLASS: Record<string, string> = {
  pink: "bg-[var(--color-brand-pink)] text-[#9a0103]",
  yellow: "bg-[var(--color-brand-yellow)] text-[#441f16]",
  green: "bg-[var(--color-brand-green)] text-[#273416]",
  blue: "bg-[var(--color-brand-blue)] text-[#0a0d27]",
};

function FlowStep({
  number,
  tone,
  label,
  text,
}: {
  number: string;
  tone: string;
  label: string;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[40px_1fr] items-start gap-3">
      <span
        className={
          "grid size-9 place-items-center rounded-full text-[13px] font-bold tracking-[-0.01em] " +
          (TONE_CLASS[tone] ?? TONE_CLASS.pink)
        }
      >
        {number}
      </span>
      <span>
        <span className="block text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)]">
          {label}
        </span>
        <span className="block text-[13px] leading-[1.55] tracking-[-0.005em] text-[var(--color-text-3)]">
          {text}
        </span>
      </span>
    </div>
  );
}
