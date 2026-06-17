import Icon from "@/components/Icon";

type LoadingSurface =
  | "dashboard"
  | "brief"
  | "outreach"
  | "campaigns"
  | "prospecting"
  | "prospects"
  | "signals"
  | "reps"
  | "plays"
  | "outcomes"
  | "operations";

type LoadingLayout = "tiles" | "rows" | "split";

const SURFACE_COPY: Record<LoadingSurface, { kicker: string; title: string; icon: string }> = {
  dashboard: { kicker: "Dashboard", title: "Gathering the morning view", icon: "dashboard" },
  brief: { kicker: "Dashboard", title: "Gathering the morning view", icon: "dashboard" },
  outreach: { kicker: "Agent", title: "Loading sent outreach", icon: "forum" },
  campaigns: { kicker: "Agent", title: "Loading outreach learning", icon: "science" },
  prospecting: { kicker: "Profile", title: "Loading profile", icon: "person" },
  prospects: { kicker: "Agent", title: "Loading verified contacts", icon: "travel_explore" },
  signals: { kicker: "Agent", title: "Loading qualified signals", icon: "sensors" },
  reps: { kicker: "Agent", title: "Loading live work", icon: "badge" },
  plays: { kicker: "Agent", title: "Loading outreach plan", icon: "account_tree" },
  outcomes: { kicker: "Dashboard", title: "Loading reply insights", icon: "task_alt" },
  operations: { kicker: "Profile", title: "Loading system state", icon: "monitor_heart" },
};

export function DashboardLoadingState({
  surface = "brief",
  layout = "tiles",
}: {
  surface?: LoadingSurface;
  layout?: LoadingLayout;
}) {
  const copy = SURFACE_COPY[surface];
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <section className="dashboard-loader">
        <div className="dashboard-loader-orbit" aria-hidden="true">
          <span className="dashboard-loader-stream dashboard-loader-stream-a" />
          <span className="dashboard-loader-stream dashboard-loader-stream-b" />
          <span className="dashboard-loader-stream dashboard-loader-stream-c" />
          <span className="dashboard-loader-node dashboard-loader-node-a" />
          <span className="dashboard-loader-node dashboard-loader-node-b" />
          <span className="dashboard-loader-node dashboard-loader-node-c" />
        </div>
        <div className="relative z-10 max-w-xl">
          <p className="brief-kicker">{copy.kicker}</p>
          <div className="mt-5 flex items-center gap-3">
            <span className="brief-note-icon">
              <Icon name={copy.icon} size={19} />
            </span>
            <h1 className="display-serif text-[clamp(2rem,4.4vw,3.75rem)] text-[var(--color-text-1)]">
              {copy.title}
            </h1>
          </div>
          <div className="mt-6 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-[rgba(36,36,33,0.08)]">
            <span className="dashboard-loader-bar" />
          </div>
        </div>
      </section>
      <LoadingSkeleton layout={layout} />
    </div>
  );
}

function LoadingSkeleton({ layout }: { layout: LoadingLayout }) {
  if (layout === "rows") {
    return (
      <div className="grid gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="dashboard-loader-skeleton h-24" />
        ))}
      </div>
    );
  }
  if (layout === "split") {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="dashboard-loader-skeleton h-32" />
          ))}
        </div>
        <div className="dashboard-loader-skeleton h-72" />
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="dashboard-loader-skeleton h-32" />
      ))}
    </div>
  );
}
