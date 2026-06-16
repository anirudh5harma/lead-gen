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

const FOOTER_LINKS = {
  Product: [
    { label: "Features", href: "/" },
    { label: "Pricing", href: "#" },
    { label: "Changelog", href: "#" },
    { label: "Roadmap", href: "#" },
  ],
  Resources: [
    { label: "Documentation", href: "#" },
    { label: "API Reference", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Status", href: "#" },
  ],
  Company: [
    { label: "About", href: "#" },
    { label: "Careers", href: "#" },
    { label: "Contact", href: "#" },
    { label: "Partners", href: "#" },
  ],
  Legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Security", href: "#" },
  ],
};

export default function Home() {
  return (
    <main className="monaco-canvas relative isolate min-h-[100dvh] overflow-hidden text-[var(--color-text-1)]">
      {/* Subtle animated background */}
      <div className="animated-bg">
        <div className="animated-bg-orb animated-bg-orb-1" />
        <div className="animated-bg-orb animated-bg-orb-2" />
        <div className="animated-bg-orb animated-bg-orb-3" />
      </div>

      {/* Header */}
      <header className="relative z-10 fixed left-0 right-0 top-0 z-50 border-b border-[var(--color-line-1)] bg-[var(--color-ink-0)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-[64px] w-full max-w-[1200px] items-center justify-between px-6 md:px-10 lg:px-16">
          <Link href="/" className="flex items-center gap-2.5 text-[1.125rem] font-semibold text-[var(--color-text-1)] tracking-[-0.02em]" style={{ fontFamily: "var(--font-display)" }}>
            <Image src="/logo.svg" alt="" width={28} height={28} priority unoptimized className="size-7" />
            Bombsell
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-text-2)] transition-colors hover:border-[var(--color-line-3)] hover:text-[var(--color-text-1)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.85 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.67 2.84c.86-2.6 3.29-4.53 6.15-4.53z" fill="#EA4335"/>
            </svg>
            Log in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto w-full max-w-[1200px] px-6 pt-32 pb-16 md:px-10 md:pt-40 md:pb-24 lg:px-16 lg:pt-48 lg:pb-32">
        <div className="mx-auto max-w-[720px] text-center">
          <p className="mono text-[var(--color-accent)]">real-time signals</p>
          <h1 className="display-serif mt-6 text-[clamp(2.25rem,5.5vw,4rem)] leading-[1.05] text-[var(--color-text-1)]">
            autonomous outbound stack
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-[1.65] text-[var(--color-text-2)]">
            Bombsell builds your prospect graph, watches for signals, runs guarded outreach plays, and learns from every outcome. No more stale lists or manual CRM work.
          </p>
          
          {/* URL Input + CTA */}
          <form action="/onboarding" method="GET" className="mt-8 mx-auto flex w-full max-w-[480px] flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-4)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <input
                type="text"
                name="url"
                placeholder="yourcompany.com"
                required
                pattern="[a-zA-Z0-9][a-zA-Z0-9\-_.]*\.[a-zA-Z]{2,}"
                title="Enter a valid domain like yourcompany.com"
                className="w-full rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] py-3 pl-10 pr-4 text-[14px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] outline-none transition-colors focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/10"
              />
            </div>
            <button
              type="submit"
              className="btn-solid whitespace-nowrap"
            >
              Get started
            </button>
          </form>
          <p className="mt-3 text-[12px] text-[var(--color-text-4)]">Free to start. No credit card required.</p>
        </div>
      </section>

      {/* Hero Product Visual */}
      <section className="relative z-10 mx-auto w-full max-w-[1200px] px-6 pb-24 md:px-10 md:pb-32 lg:px-16 lg:pb-40">
        <BrowserMockup>
          <DashboardPreview />
        </BrowserMockup>
      </section>

      {/* Features */}
      {FEATURES.map((feature, index) => (
        <FeatureSection key={feature.eyebrow} feature={feature} reversed={index % 2 === 1} />
      ))}

      {/* How it works */}
      <section className="relative z-10 border-t border-[var(--color-line-1)]">
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
      <section className="relative z-10 border-t border-[var(--color-line-1)]">
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
      <footer className="relative z-10 border-t border-[var(--color-line-1)] bg-[var(--color-ink-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-16 md:px-10 md:py-20 lg:px-16">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
            {/* Brand column */}
            <div className="col-span-2">
              <div className="flex items-center gap-2.5 text-[1.0625rem] font-semibold text-[var(--color-text-1)]" style={{ fontFamily: "var(--font-display)" }}>
                <Image src="/logo.svg" alt="" width={24} height={24} unoptimized className="size-6" />
                Bombsell
              </div>
              <p className="mt-4 max-w-[260px] text-[13px] leading-[1.6] text-[var(--color-text-3)]">
                Signal-led outbound for modern GTM teams. Build the graph, watch for signals, run the plays.
              </p>
            </div>
            
            {/* Link columns */}
            {Object.entries(FOOTER_LINKS).map(([category, links]) => (
              <div key={category}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-1)]">{category}</p>
                <ul className="mt-4 grid gap-2.5">
                  {links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-[13px] text-[var(--color-text-3)] transition-colors hover:text-[var(--color-text-1)]">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          
          <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-[var(--color-line-1)] pt-8 md:flex-row">
            <p className="text-[12px] text-[var(--color-text-4)]">
              &copy; {new Date().getFullYear()} Bombsell. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-4)] transition-colors hover:text-[var(--color-text-2)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-4)] transition-colors hover:text-[var(--color-text-2)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
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
    <section className="relative z-10 border-t border-[var(--color-line-1)]">
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
