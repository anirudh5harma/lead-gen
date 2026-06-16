import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/Icon";

const FEATURES = [
  {
    number: "01",
    eyebrow: "Build prospecting",
    outcome: "Drive Demand",
    title: "Your prospect graph is built and improved for you",
    description:
      "Bombsell automatically builds your total addressable market from your site, ICP, customers, and channel history. The graph stays current as your market evolves.",
    points: [
      { icon: "person", label: "Pre-built TAM", text: "Automatically constructed from your public footprint and existing data." },
      { icon: "sensors", label: "Grounded in your ICP", text: "Shaped from your ideal customer profile and the accounts already in your history." },
      { icon: "science", label: "AI scoring", text: "Built-in scoring using firmographics and signals with clear explanations." },
    ],
    visual: "prospecting",
  },
  {
    number: "02",
    eyebrow: "Overlay signals",
    outcome: "Drive Demand",
    title: "Segment with AI, prioritize with signals",
    description:
      "Bombsell overlays custom signals on top of your target accounts to prioritize who to reach out to, when, and why.",
    points: [
      { icon: "travel_explore", label: "AI semantic search", text: "Find accounts by intent, not just firmographics." },
      { icon: "tune", label: "Custom signals", text: "Job postings, tech stack, news, and anything else you can imagine." },
      { icon: "monitor_heart", label: "Inbound signals", text: "Track visitors, demo requests, and other high-intent inputs." },
    ],
    visual: "signals",
  },
  {
    number: "03",
    eyebrow: "Run plays",
    outcome: "Drive Demand",
    title: "AI-assisted outbound, end to end",
    description:
      "Demand generation that runs itself, with your guardrails. Bombsell does not just recommend outreach. It executes it.",
    points: [
      { icon: "account_tree", label: "Pre-built sequences", text: "Opinionated templates you can customize quickly." },
      { icon: "schedule", label: "Autopilot", text: "Bombsell decides who to enroll, when to start, and how to follow up." },
      { icon: "forum", label: "Contextual relevance", text: "Messages that adapt to business context and intent signals." },
    ],
    visual: "plays",
  },
  {
    number: "04",
    eyebrow: "Move conversations",
    outcome: "Increase Conversion",
    title: "Capture every interaction",
    description:
      "Replace your legacy CRM. Bombsell is not a CRM you maintain. It is the system that maintains itself.",
    points: [
      { icon: "fact_check", label: "Structured signals", text: "Every interaction is captured, summarized, and attached to the right account." },
      { icon: "sync_alt", label: "Auto-enrichment", text: "Accounts and contacts stay complete and up to date automatically." },
      { icon: "history", label: "Trusted history", text: "What happened, when, who was involved, and what changed." },
    ],
    visual: "conversations",
  },
  {
    number: "05",
    eyebrow: "Learn from outcomes",
    outcome: "Increase Conversion",
    title: "Your pipeline manages itself",
    description:
      "Your pipeline should reflect what is happening, not what got logged. Stages, risks, and next steps that reflect reality.",
    points: [
      { icon: "sensors", label: "Signal-based stages", text: "Meetings, email threads, and stakeholder engagement drive changes." },
      { icon: "report", label: "Risk detection", text: "Ghosting, stalls, and weak engagement flagged early with clear reasons." },
      { icon: "task_alt", label: "Auto-filled fields", text: "Calls, stakeholders, usage signals, and why now are pulled from real interactions." },
    ],
    visual: "outcomes",
  },
];

const TESTIMONIALS = [
  {
    quote: "Bombsell made our legacy CRM feel instantly obsolete.",
    name: "Alex Berkovic",
    title: "Co-Founder, Sphinx",
  },
  {
    quote: "It feels like I have a machine running in the background getting all these meetings set up for me.",
    name: "Phillip Smart",
    title: "CEO & Co-Founder, Parley",
  },
  {
    quote: "Bombsell lets us punch way above our weight. We are a 3-person team running GTM like a 20-person sales org.",
    name: "Graham Cummings",
    title: "CRO, Datawizz",
  },
  {
    quote: "We had our prospect graph built on day 2 and we were running outbound sequences that same day.",
    name: "Amy Yan",
    title: "Co-Founder, Nowadays",
  },
  {
    quote: "The AI actually knows which opportunities to prioritize and automates my follow-up. It is like having a world class CRO as a copilot.",
    name: "Ben Dopfner",
    title: "Founder, Vesto",
  },
  {
    quote: "We have tried every modern CRM and sales tool. Bombsell is the best and it is not even close.",
    name: "Hari Raghavan",
    title: "CEO & Co-Founder, Autograph",
  },
];

export default function Home() {
  return (
    <main className="monaco-canvas relative isolate min-h-[100dvh] overflow-hidden text-[var(--color-text-1)]">
      {/* Header */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-[var(--color-line-1)] bg-[rgba(7,8,6,0.88)] backdrop-blur-md">
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
              Request demo
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto w-full max-w-[1200px] px-6 pt-32 pb-20 md:px-10 md:pt-40 md:pb-28 lg:px-16 lg:pt-48 lg:pb-36">
        <div className="max-w-[720px]">
          <p className="mono text-[var(--color-accent-hi)]">Signal-led outbound</p>
          <h1 className="display-serif mt-6 text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[1.05] text-[var(--color-text-1)]">
            GTM that keeps itself current.
          </h1>
          <p className="mt-6 max-w-[560px] text-[17px] leading-[1.65] text-[var(--color-text-2)]">
            Bombsell builds the prospect graph, watches Signals, runs guarded Plays, and learns from Outcomes.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/onboarding" className="btn-solid">
              Request demo
            </Link>
            <Link href="/login" className="btn-quiet">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Hero visual — product pane */}
      <section className="relative mx-auto w-full max-w-[1200px] px-6 pb-24 md:px-10 md:pb-32 lg:px-16 lg:pb-40">
        <ProductPane />
      </section>

      {/* Features */}
      {FEATURES.map((feature, index) => (
        <FeatureSection key={feature.number} feature={feature} reversed={index % 2 === 1} />
      ))}

      {/* Testimonials */}
      <section className="relative border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-24 md:px-10 md:py-32 lg:px-16 lg:py-40">
          <p className="mono text-[var(--color-accent-hi)]">Testimonials</p>
          <h2 className="display-serif mt-5 text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.1] text-[var(--color-text-1)]">
            The results speak for themselves
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6 transition-colors hover:border-[var(--color-line-2)]"
              >
                <p className="text-[15px] leading-[1.6] text-[var(--color-text-1)]">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-hi)] text-[11px] font-semibold">
                    {t.name.split(" ").map(n => n[0]).join("")}
                  </span>
                  <div>
                    <p className="text-[13.5px] font-semibold text-[var(--color-text-1)]">{t.name}</p>
                    <p className="text-[12px] text-[var(--color-text-3)]">{t.title}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-24 md:px-10 md:py-32 lg:px-16 lg:py-40">
          <div className="max-w-[560px]">
            <h2 className="display-serif text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.1] text-[var(--color-text-1)]">
              Start growing your revenue faster
            </h2>
            <div className="mt-8">
              <Link href="/onboarding" className="btn-solid">
                Request demo
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
              <Link href="/onboarding" className="transition-colors hover:text-[var(--color-text-1)]">Request demo</Link>
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
    <section className="relative border-t border-[var(--color-line-1)]">
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-12 px-6 py-24 md:px-10 md:py-32 lg:grid-cols-2 lg:gap-16 lg:px-16 lg:py-40">
        <div className={reversed ? "lg:order-2" : "lg:order-1"}>
          <div className="flex items-center gap-3">
            <span className="mono text-[var(--color-text-4)]">{feature.number}</span>
            <span className="h-px w-4 bg-[var(--color-line-2)]" />
            <span className="mono text-[var(--color-text-3)]">{feature.eyebrow}</span>
            <span className="mono text-[var(--color-accent-hi)]">&bull; {feature.outcome}</span>
          </div>
          <h2 className="display-serif mt-6 text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.1] text-[var(--color-text-1)]">
            {feature.title}
          </h2>
          <p className="mt-4 max-w-[480px] text-[15px] leading-[1.65] text-[var(--color-text-2)]">
            {feature.description}
          </p>
          <div className="mt-8 grid gap-4">
            {feature.points.map((point) => (
              <div key={point.label} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[6px] bg-[var(--color-accent-bg)] text-[var(--color-accent-hi)]">
                  <Icon name={point.icon} size={15} />
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[var(--color-text-1)]">{point.label}</p>
                  <p className="text-[13px] leading-[1.5] text-[var(--color-text-3)]">{point.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={reversed ? "lg:order-1" : "lg:order-2"}>
          <FeatureVisual visual={feature.visual} />
        </div>
      </div>
    </section>
  );
}

function FeatureVisual({ visual }: { visual: string }) {
  // Each visual is a CSS-constructed product mockup
  return (
    <div className="relative rounded-[14px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-3 shadow-[0_40px_100px_-60px_rgba(0,0,0,0.9)]">
      <div className="min-w-0 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--color-line-1)] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[var(--color-text-4)]" />
            <span className="size-2.5 rounded-full bg-[var(--color-text-4)]" />
            <span className="size-2.5 rounded-full bg-[var(--color-text-4)]" />
          </div>
          <span className="ml-2 text-[11px] font-medium text-[var(--color-text-4)]">{visual}</span>
        </div>
        <div className="p-4">
          {visual === "prospecting" && <ProspectingMock />}
          {visual === "signals" && <SignalsMock />}
          {visual === "plays" && <PlaysMock />}
          {visual === "conversations" && <ConversationsMock />}
          {visual === "outcomes" && <OutcomesMock />}
        </div>
      </div>
    </div>
  );
}

function ProspectingMock() {
  return (
    <div className="grid gap-2">
      {["Acme Corp", "Beta Labs", "Gamma Inc", "Delta Co", "Epsilon LLC"].map((name, i) => (
        <div key={name} className="flex items-center gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
          <span className="grid size-7 place-items-center rounded-[6px] bg-[var(--color-accent-bg)] text-[var(--color-accent-hi)] text-[10px] font-semibold">{name[0]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--color-text-1)]">{name}</p>
            <p className="text-[11px] text-[var(--color-text-4)]">{["Software", "Biotech", "Fintech", "Retail", "AI"][i]}</p>
          </div>
          <span className="shrink-0 rounded-[6px] bg-[var(--color-pos-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-pos)]">{["94", "87", "91", "82", "96"][i]}</span>
        </div>
      ))}
    </div>
  );
}

function SignalsMock() {
  return (
    <div className="grid gap-2">
      {["Hiring SDRs", "Raised Series B", "New CTO", "Website redesign", "Expanding to EU"].map((signal, i) => (
        <div key={signal} className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-[var(--color-text-1)]">{signal}</p>
            <span className="text-[10px] text-[var(--color-text-4)]">{["2h", "4h", "6h", "1d", "1d"][i]} ago</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-3)]">{["12 accounts", "3 accounts", "8 accounts", "15 accounts", "6 accounts"][i]} matched</p>
        </div>
      ))}
    </div>
  );
}

function PlaysMock() {
  return (
    <div className="grid gap-2">
      {["Signal-led outreach", "Content nurture", "Event follow-up", "Re-engagement", "Demo request"].map((play, i) => (
        <div key={play} className="flex items-center gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
          <span className="grid size-7 place-items-center rounded-[6px] bg-[var(--color-ink-3)] text-[var(--color-text-2)]">
            <Icon name="science" size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--color-text-1)]">{play}</p>
            <p className="text-[11px] text-[var(--color-text-4)]">{["17 enrolled", "42 enrolled", "8 enrolled", "23 enrolled", "5 enrolled"][i]}</p>
          </div>
          <span className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[10px] font-medium ${i === 0 ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]" : "bg-[var(--color-ink-3)] text-[var(--color-text-3)]"}`}>
            {i === 0 ? "Running" : "Draft"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConversationsMock() {
  return (
    <div className="grid gap-2">
      {["Sarah Chen", "Marcus Webb", "Lisa Park", "James Holt", "Nina Patel"].map((name, i) => (
        <div key={name} className="flex items-center gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-[var(--color-ink-3)] text-[var(--color-text-2)] text-[10px] font-semibold">{name.split(" ").map(n => n[0]).join("")}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--color-text-1)]">{name}</p>
            <p className="text-[11px] text-[var(--color-text-4)]">{["Re: Partnership", "Quick question", "Follow-up", "Intro", "Demo request"][i]}</p>
          </div>
          <span className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[10px] font-medium ${i < 2 ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]" : "bg-[var(--color-ink-3)] text-[var(--color-text-3)]"}`}>
            {i < 2 ? "Needs reply" : "Sent"}
          </span>
        </div>
      ))}
    </div>
  );
}

function OutcomesMock() {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
        <span className="text-[12px] text-[var(--color-text-3)]">Meetings this week</span>
        <span className="text-[18px] font-semibold tabular-nums text-[var(--color-text-1)]">7</span>
      </div>
      <div className="flex items-center justify-between rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
        <span className="text-[12px] text-[var(--color-text-3)]">Positive replies</span>
        <span className="text-[18px] font-semibold tabular-nums text-[var(--color-text-1)]">12</span>
      </div>
      <div className="flex items-center justify-between rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
        <span className="text-[12px] text-[var(--color-text-3)]">Pipeline created</span>
        <span className="text-[18px] font-semibold tabular-nums text-[var(--color-text-1)]">$84k</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[var(--color-ink-3)] overflow-hidden">
        <div className="h-full w-[65%] rounded-full bg-[var(--color-accent)]" />
      </div>
      <p className="text-[11px] text-[var(--color-text-4)]">65% of target hit this quarter</p>
    </div>
  );
}

function ProductPane() {
  return (
    <div className="relative w-full rounded-[14px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-3 shadow-[0_40px_100px_-60px_rgba(0,0,0,0.9)]">
      <div className="min-w-0 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)]">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">Brief</p>
            <h2 className="mt-1 truncate text-[16px] font-semibold text-[var(--color-text-1)]">Signal to Outcome</h2>
          </div>
          <span className="shrink-0 rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1 text-[11px] font-semibold text-[var(--color-accent-hi)]">3 moves</span>
        </div>
        <div className="grid min-w-0 gap-0 md:grid-cols-[1.1fr_0.9fr]">
          <div className="border-b border-[var(--color-line-1)] p-4 md:border-b-0 md:border-r">
            <div className="grid gap-2">
              {[
                ["Prospects", "60 profiles", "Graph updated"],
                ["Signals", "17 fresh", "Timing matched"],
                ["Conversations", "2 moving", "1 review"],
                ["Outcomes", "0 useful", "Learning waits"],
              ].map(([label, value, detail]) => (
                <div key={label} className="grid min-w-0 grid-cols-[minmax(76px,0.45fr)_minmax(0,1fr)] gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-3 sm:grid-cols-[110px_1fr]">
                  <span className="min-w-0 text-[11px] text-[var(--color-text-3)]">{label}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-[var(--color-text-1)]">{value}</span>
                    <span className="block text-[11px] text-[var(--color-text-4)]">{detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4">
            <p className="text-[13px] font-semibold text-[var(--color-text-1)]">Next useful moves</p>
            <div className="mt-4 grid gap-3">
              <ActionPreview icon="rate_review" title="Review judged drafts" detail="1 draft is waiting." />
              <ActionPreview icon="sensors" title="Prepare Signal-led outreach" detail="17 Signals have evidence." />
              <ActionPreview icon="forum" title="Move Conversations" detail="2 threads are open." />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionPreview({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] gap-3">
      <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[var(--color-text-1)]">{title}</span>
        <span className="block text-[11px] leading-5 text-[var(--color-text-3)]">{detail}</span>
      </span>
    </div>
  );
}
