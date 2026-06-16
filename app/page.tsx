import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/Icon";

const FEATURES = [
  {
    eyebrow: "Prospecting",
    title: "Your market graph builds itself",
    description:
      "Bombsell constructs your total addressable market from your website, ICP, and existing data. The graph updates automatically as your market evolves. No manual list building.",
    points: [
      { icon: "person", text: "AI scoring with clear explanations for every account" },
      { icon: "travel_explore", text: "Find accounts by intent, not just firmographics" },
      { icon: "sensors", text: "Grounded in your ICP and existing customer patterns" },
    ],
  },
  {
    eyebrow: "Signals",
    title: "Know who to contact and when",
    description:
      "Overlay custom signals on your target accounts to prioritize outreach. Track job postings, tech changes, news, and inbound activity in one place.",
    points: [
      { icon: "tune", text: "Custom signals across job posts, tech stack, and news" },
      { icon: "monitor_heart", text: "Inbound activity tracking across all channels" },
      { icon: "schedule", text: "Timing evidence before any message is drafted" },
    ],
  },
  {
    eyebrow: "Plays",
    title: "Outbound that runs itself",
    description:
      "Demand generation with your guardrails. Bombsell enrolls the right prospects, sends personalized messages, and follows up automatically.",
    points: [
      { icon: "account_tree", text: "Pre-built sequences you customize in minutes" },
      { icon: "forum", text: "Messages adapt to business context and intent" },
      { icon: "task_alt", text: "Human review gates before anything sends" },
    ],
  },
  {
    eyebrow: "Outcomes",
    title: "A CRM that maintains itself",
    description:
      "Every interaction is captured, summarized, and attached to the right account and contact. Your pipeline reflects reality, not rep hygiene.",
    points: [
      { icon: "fact_check", text: "Auto-enrichment keeps every record current" },
      { icon: "report", text: "Risk detection flags ghosting and stalls early" },
      { icon: "sync_alt", text: "Pipeline stages driven by real engagement signals" },
    ],
  },
];

const STEPS = [
  {
    number: "01",
    title: "Connect your workspace",
    description: "Link your email, calendar, and LinkedIn. Bombsell reads your existing data and builds the foundation.",
  },
  {
    number: "02",
    title: "Define your market",
    description: "Share your website and ICP. Bombsell constructs your prospect graph and starts watching for signals.",
  },
  {
    number: "03",
    title: "Launch your first Play",
    description: "Choose a sequence, set your guardrails, and let Bombsell run outreach. Reviews come to you for approval.",
  },
];

export default function Home() {
  return (
    <main className="monaco-canvas relative isolate min-h-[100dvh] overflow-hidden text-[var(--color-text-1)]">
      {/* Header */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-[var(--color-line-1)] bg-[var(--color-ink-0)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-[64px] w-full max-w-[1200px] items-center justify-between px-6 md:px-10 lg:px-16">
          <Link href="/" className="flex items-center gap-2.5 text-[1.125rem] font-semibold text-[var(--color-text-1)] tracking-[-0.02em]" style={{ fontFamily: "var(--font-display)" }}>
            <Image src="/logo.svg" alt="" width={28} height={28} priority unoptimized className="size-7" />
            Bombsell
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-quiet px-4 text-[13.5px]">
              Log in
            </Link>
            <Link href="/onboarding" className="btn-solid px-4 text-[13.5px]">
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto w-full max-w-[1200px] px-6 pt-32 pb-16 md:px-10 md:pt-40 md:pb-24 lg:px-16 lg:pt-48 lg:pb-32">
        <div className="mx-auto max-w-[720px] text-center">
          <p className="mono text-[var(--color-accent)]">Signal-led outbound</p>
          <h1 className="display-serif mt-6 text-[clamp(2.25rem,5.5vw,4rem)] leading-[1.05] text-[var(--color-text-1)]">
            GTM that keeps itself current
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-[1.65] text-[var(--color-text-2)]">
            Bombsell builds your prospect graph, watches for signals, runs guarded outreach plays, and learns from every outcome. No more stale lists or manual CRM work.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/onboarding" className="btn-solid">
              Get started free
            </Link>
            <Link href="/login" className="btn-quiet">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Hero Product Visual */}
      <section className="relative mx-auto w-full max-w-[1200px] px-6 pb-24 md:px-10 md:pb-32 lg:px-16 lg:pb-40">
        <BrowserMockup>
          <DashboardPreview />
        </BrowserMockup>
      </section>

      {/* Stats */}
      <section className="border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-16 md:px-10 md:py-20 lg:px-16 lg:py-24">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            <div className="text-center">
              <p className="text-[clamp(1.75rem,3vw,2.5rem)] font-semibold tabular-nums text-[var(--color-accent)]">60+</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-3)]">Prospects per day</p>
            </div>
            <div className="text-center">
              <p className="text-[clamp(1.75rem,3vw,2.5rem)] font-semibold tabular-nums text-[var(--color-accent)]">17</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-3)]">Fresh signals daily</p>
            </div>
            <div className="text-center">
              <p className="text-[clamp(1.75rem,3vw,2.5rem)] font-semibold tabular-nums text-[var(--color-accent)]">3x</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-3)]">Faster pipeline</p>
            </div>
            <div className="text-center">
              <p className="text-[clamp(1.75rem,3vw,2.5rem)] font-semibold tabular-nums text-[var(--color-accent)]">0</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-3)]">Manual CRM updates</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      {FEATURES.map((feature, index) => (
        <FeatureSection key={feature.eyebrow} feature={feature} reversed={index % 2 === 1} />
      ))}

      {/* How it works */}
      <section className="border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-24 md:px-10 md:py-32 lg:px-16 lg:py-40">
          <div className="mx-auto max-w-[640px] text-center">
            <p className="mono text-[var(--color-accent)]">How it works</p>
            <h2 className="display-serif mt-5 text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.1] text-[var(--color-text-1)]">
              From setup to first meeting in under an hour
            </h2>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.number} className="relative">
                <span className="mono text-[var(--color-text-4)]">{step.number}</span>
                <h3 className="mt-4 text-[1.125rem] font-semibold text-[var(--color-text-1)]">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-[1.65] text-[var(--color-text-2)]">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-24 md:px-10 md:py-32 lg:px-16 lg:py-40">
          <div className="mx-auto max-w-[560px] text-center">
            <h2 className="display-serif text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.1] text-[var(--color-text-1)]">
              Start growing your pipeline today
            </h2>
            <p className="mt-4 text-[15px] leading-[1.65] text-[var(--color-text-2)]">
              Free to start. No credit card required. Your first prospecting graph builds in minutes.
            </p>
            <div className="mt-8">
              <Link href="/onboarding" className="btn-solid">
                Get started free
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-12 md:px-10 md:py-16 lg:px-16">
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div className="flex items-center gap-2.5 text-[1.0625rem] font-semibold text-[var(--color-text-1)]" style={{ fontFamily: "var(--font-display)" }}>
              <Image src="/logo.svg" alt="" width={24} height={24} unoptimized className="size-6" />
              Bombsell
            </div>
            <div className="flex flex-wrap items-center gap-6 text-[13px] text-[var(--color-text-3)]">
              <Link href="/" className="transition-colors hover:text-[var(--color-text-1)]">Product</Link>
              <Link href="/login" className="transition-colors hover:text-[var(--color-text-1)]">Log in</Link>
              <Link href="/onboarding" className="transition-colors hover:text-[var(--color-text-1)]">Get started</Link>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-[var(--color-line-1)] pt-8 md:flex-row md:items-center">
            <p className="text-[12px] text-[var(--color-text-4)]">
              &copy; {new Date().getFullYear()} Bombsell. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-[12px] text-[var(--color-text-4)]">
              <Link href="/privacy" className="transition-colors hover:text-[var(--color-text-3)]">Privacy</Link>
              <Link href="/terms" className="transition-colors hover:text-[var(--color-text-3)]">Terms</Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureSection({
  feature,
  reversed,
}: {
  feature: (typeof FEATURES)[number];
  reversed: boolean;
}) {
  return (
    <section className="border-t border-[var(--color-line-1)]">
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-12 px-6 py-24 md:px-10 md:py-32 lg:grid-cols-2 lg:gap-16 lg:px-16 lg:py-40">
        <div className={reversed ? "lg:order-2" : "lg:order-1"}>
          <p className="mono text-[var(--color-accent)]">{feature.eyebrow}</p>
          <h2 className="display-serif mt-5 text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.1] text-[var(--color-text-1)]">
            {feature.title}
          </h2>
          <p className="mt-4 max-w-[480px] text-[15px] leading-[1.65] text-[var(--color-text-2)]">
            {feature.description}
          </p>
          <div className="mt-8 grid gap-4">
            {feature.points.map((point) => (
              <div key={point.text} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                  <Icon name={point.icon} size={14} />
                </span>
                <p className="text-[14px] leading-[1.5] text-[var(--color-text-2)]">{point.text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={reversed ? "lg:order-1" : "lg:order-2"}>
          <BrowserMockup>
            <FeatureMockup feature={feature.eyebrow} />
          </BrowserMockup>
        </div>
      </div>
    </section>
  );
}

function BrowserMockup({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-[14px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]">
      <div className="min-w-0 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[var(--color-line-1)] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[var(--color-neg)]" />
            <span className="size-2.5 rounded-full bg-[var(--color-warn)]" />
            <span className="size-2.5 rounded-full bg-[var(--color-pos)]" />
          </div>
          <div className="flex-1 rounded-[6px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-1">
            <span className="text-[11px] text-[var(--color-text-4)]">app.bombsell.com</span>
          </div>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="grid gap-4">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-[var(--color-line-1)] pb-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-[6px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
            <Icon name="person" size={14} />
          </span>
          <span className="text-[13px] font-semibold text-[var(--color-text-1)]">Bombsell</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-[6px] bg-[var(--color-pos-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-pos)]">Connected</span>
          <span className="grid size-7 place-items-center rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-3)] text-[10px] font-semibold">JD</span>
        </div>
      </div>
      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Prospects", value: "1,247", change: "+12" },
          { label: "Signals", value: "34", change: "+5" },
          { label: "Active", value: "8", change: "+2" },
          { label: "Meetings", value: "3", change: "+1" },
        ].map((m) => (
          <div key={m.label} className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-3)]">{m.label}</p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--color-text-1)]">{m.value}</p>
            <p className="text-[10px] text-[var(--color-pos)]">{m.change} this week</p>
          </div>
        ))}
      </div>
      {/* Content */}
      <div className="grid gap-2">
        <div className="flex items-center gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2.5">
          <span className="grid size-7 place-items-center rounded-[6px] bg-[var(--color-accent-bg)] text-[var(--color-accent)] text-[10px] font-semibold">A</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--color-text-1)]">Acme Corporation</p>
            <p className="text-[11px] text-[var(--color-text-3)]">Hiring SDRs · 94 score</p>
          </div>
          <span className="shrink-0 rounded-[6px] bg-[var(--color-pos-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-pos)]">Ready</span>
        </div>
        <div className="flex items-center gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2.5">
          <span className="grid size-7 place-items-center rounded-[6px] bg-[var(--color-accent-bg)] text-[var(--color-accent)] text-[10px] font-semibold">B</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--color-text-1)]">Beta Labs</p>
            <p className="text-[11px] text-[var(--color-text-3)]">Raised Series B · 87 score</p>
          </div>
          <span className="shrink-0 rounded-[6px] bg-[var(--color-warn-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-warn)]">Enrolling</span>
        </div>
        <div className="flex items-center gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2.5">
          <span className="grid size-7 place-items-center rounded-[6px] bg-[var(--color-accent-bg)] text-[var(--color-accent)] text-[10px] font-semibold">G</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--color-text-1)]">Gamma Inc</p>
            <p className="text-[11px] text-[var(--color-text-3)]">New CTO · 91 score</p>
          </div>
          <span className="shrink-0 rounded-[6px] bg-[var(--color-pos-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-pos)]">Ready</span>
        </div>
      </div>
    </div>
  );
}

function FeatureMockup({ feature }: { feature: string }) {
  if (feature === "Prospecting") {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2 border-b border-[var(--color-line-1)] pb-2">
          <span className="text-[11px] font-medium text-[var(--color-text-3)]">Top prospects</span>
          <span className="ml-auto text-[10px] text-[var(--color-text-4)]">Sorted by score</span>
        </div>
        {["Acme Corp", "Beta Labs", "Gamma Inc", "Delta Co", "Epsilon LLC"].map((name, i) => (
          <div key={name} className="flex items-center gap-3 rounded-[6px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2">
            <span className="grid size-6 place-items-center rounded-[4px] bg-[var(--color-accent-bg)] text-[var(--color-accent)] text-[10px] font-semibold">{name[0]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[var(--color-text-1)]">{name}</p>
              <p className="text-[10px] text-[var(--color-text-3)]">{["Software", "Biotech", "Fintech", "Retail", "AI"][i]}</p>
            </div>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--color-accent)]">{["94", "87", "91", "82", "96"][i]}</span>
          </div>
        ))}
      </div>
    );
  }

  if (feature === "Signals") {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2 border-b border-[var(--color-line-1)] pb-2">
          <span className="text-[11px] font-medium text-[var(--color-text-3)]">Recent signals</span>
        </div>
        {["Hiring SDRs", "Raised Series B", "New CTO", "Website redesign", "Expanding to EU"].map((signal, i) => (
          <div key={signal} className="rounded-[6px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-medium text-[var(--color-text-1)]">{signal}</p>
              <span className="text-[10px] text-[var(--color-text-4)]">{["2h", "4h", "6h", "1d", "1d"][i]} ago</span>
            </div>
            <p className="mt-0.5 text-[10px] text-[var(--color-text-3)]">{["12", "3", "8", "15", "6"][i]} accounts matched</p>
          </div>
        ))}
      </div>
    );
  }

  if (feature === "Plays") {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2 border-b border-[var(--color-line-1)] pb-2">
          <span className="text-[11px] font-medium text-[var(--color-text-3)]">Active plays</span>
        </div>
        {["Signal-led outreach", "Content nurture", "Event follow-up", "Re-engagement", "Demo request"].map((play, i) => (
          <div key={play} className="flex items-center gap-3 rounded-[6px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2">
            <span className="grid size-6 place-items-center rounded-[4px] bg-[var(--color-ink-2)] text-[var(--color-text-3)]">
              <Icon name="science" size={12} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[var(--color-text-1)]">{play}</p>
              <p className="text-[10px] text-[var(--color-text-4)]">{["17", "42", "8", "23", "5"][i]} enrolled</p>
            </div>
            <span className={`shrink-0 rounded-[4px] px-1.5 py-0.5 text-[9px] font-medium ${i === 0 ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]" : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]"}`}>
              {i === 0 ? "Running" : "Draft"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Outcomes
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between rounded-[6px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2">
        <span className="text-[11px] text-[var(--color-text-3)]">Meetings this week</span>
        <span className="text-[16px] font-semibold tabular-nums text-[var(--color-text-1)]">7</span>
      </div>
      <div className="flex items-center justify-between rounded-[6px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2">
        <span className="text-[11px] text-[var(--color-text-3)]">Positive replies</span>
        <span className="text-[16px] font-semibold tabular-nums text-[var(--color-text-1)]">12</span>
      </div>
      <div className="flex items-center justify-between rounded-[6px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2">
        <span className="text-[11px] text-[var(--color-text-3)]">Pipeline created</span>
        <span className="text-[16px] font-semibold tabular-nums text-[var(--color-text-1)]">$84k</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[var(--color-ink-2)] overflow-hidden">
        <div className="h-full w-[65%] rounded-full bg-[var(--color-accent)]" />
      </div>
      <p className="text-[10px] text-[var(--color-text-4)]">65% of quarterly target</p>
    </div>
  );
}
