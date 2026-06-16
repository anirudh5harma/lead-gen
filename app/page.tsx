import Image from "next/image";
import Icon from "@/components/Icon";
import UrlStart from "@/components/UrlStart";

const LOOP_STEPS = [
  {
    number: "1",
    label: "Build prospecting",
    copy: "Create the account and person graph from your site, ICP, customers, and channel history.",
    icon: "person",
  },
  {
    number: "2",
    label: "Overlay Signals",
    copy: "Rank timing evidence, source freshness, and fit before any outreach is drafted.",
    icon: "sensors",
  },
  {
    number: "3",
    label: "Run Plays",
    copy: "Turn qualified Signals into email and LinkedIn workflows with review rails.",
    icon: "science",
  },
  {
    number: "4",
    label: "Move Conversations",
    copy: "Keep replies, approvals, and channel history tied to the same counterparty.",
    icon: "forum",
  },
  {
    number: "5",
    label: "Learn from Outcomes",
    copy: "Use meetings, replies, and misses to sharpen the next Play.",
    icon: "task_alt",
  },
];

const PROOF_ROWS = [
  ["Prospects", "60 profiles", "Graph updated"],
  ["Signals", "17 fresh", "Timing matched"],
  ["Conversations", "2 moving", "1 review"],
  ["Outcomes", "0 useful", "Learning waits"],
];

export default function Home() {
  return (
    <main className="canvas-bg relative isolate min-h-[100dvh] overflow-hidden">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-[color:var(--color-line-2)] bg-[rgba(7,8,6,0.88)] backdrop-blur-md">
        <div className="mx-auto flex h-[68px] w-full max-w-[1320px] items-center justify-between px-6 md:px-10 lg:px-16">
          <span
            className="flex items-center gap-2.5 text-[1.25rem] font-semibold text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Image
              src="/logo.svg"
              alt=""
              width={28}
              height={28}
              priority
              unoptimized
              className="size-7"
            />
            Bombsell
          </span>
          <a
            href="/dashboard"
            className="inline-flex min-h-10 items-center rounded-[8px] border border-[var(--color-line-2)] px-4 text-sm font-semibold text-[var(--color-text-2)] transition-colors hover:border-[var(--color-line-3)] hover:text-[var(--color-text-1)]"
          >
            Sign in
          </a>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100dvh-128px)] w-full max-w-[1320px] grid-cols-1 items-center gap-8 px-6 pb-8 pt-24 md:px-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:px-16">
        <div className="w-full min-w-0 max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent-hi)]">
            Signal-led outbound
          </p>
          <h1 className="display-serif mt-5 max-w-full text-[clamp(2.75rem,5vw,4.25rem)] text-[var(--color-text-1)]">
            GTM that keeps itself current.
          </h1>
          <p className="mt-6 w-full max-w-[min(36rem,100%)] text-[16px] leading-7 text-[var(--color-text-2)]">
            Bombsell builds the prospect graph, watches Signals, runs guarded Plays, and learns from Outcomes.
          </p>
          <UrlStart />
        </div>

        <ProductPane />
      </section>

      <section className="mx-auto w-full max-w-[1320px] px-6 pb-20 md:px-10 lg:px-16">
        <div className="grid gap-3 lg:grid-cols-5">
          {LOOP_STEPS.map((step) => (
            <article
              key={step.label}
              className="group min-h-[230px] rounded-[10px] border border-[var(--color-line-2)] bg-[rgba(15,14,10,0.76)] p-5 transition-colors hover:border-[var(--color-line-3)] hover:bg-[rgba(24,21,15,0.92)]"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] text-[var(--color-text-4)]">
                  {step.number}
                </span>
                <span className="grid size-9 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent-hi)]">
                  <Icon name={step.icon} size={17} />
                </span>
              </div>
              <h2 className="mt-8 text-[18px] font-semibold text-[var(--color-text-1)]">
                {step.label}
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-3)]">
                {step.copy}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function ProductPane() {
  return (
    <section className="relative w-full min-w-0 max-w-full rounded-[12px] border border-[var(--color-line-2)] bg-[rgba(12,11,8,0.86)] p-3 shadow-[0_40px_120px_-70px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(247,221,184,0.08)]">
      <div className="min-w-0 rounded-[9px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)]">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
              Brief
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-[var(--color-text-1)]">
              Signal to Outcome
            </h2>
          </div>
          <span className="shrink-0 rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1 text-xs font-semibold text-[var(--color-accent-hi)]">
            3 moves
          </span>
        </div>

        <div className="grid min-w-0 gap-0 md:grid-cols-[1.1fr_0.9fr]">
          <div className="border-b border-[var(--color-line-1)] p-4 md:border-b-0 md:border-r">
            <div className="grid gap-2">
              {PROOF_ROWS.map(([label, value, detail]) => (
                <div
                  key={label}
                  className="grid min-w-0 grid-cols-[minmax(76px,0.45fr)_minmax(0,1fr)] gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(21,19,15,0.74)] px-3 py-3 sm:grid-cols-[110px_1fr]"
                >
                  <span className="min-w-0 text-xs text-[var(--color-text-3)]">{label}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                      {value}
                    </span>
                    <span className="block text-xs text-[var(--color-text-4)]">{detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Next useful moves
            </p>
            <div className="mt-4 grid gap-3">
              <ActionPreview icon="rate_review" title="Review judged drafts" detail="1 draft is waiting." />
              <ActionPreview icon="sensors" title="Prepare Signal-led outreach" detail="17 Signals have evidence." />
              <ActionPreview icon="forum" title="Move Conversations" detail="2 threads are open." />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActionPreview({
  icon,
  title,
  detail,
}: {
  icon: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] gap-3">
      <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">{title}</span>
        <span className="block text-xs leading-5 text-[var(--color-text-3)]">{detail}</span>
      </span>
    </div>
  );
}
