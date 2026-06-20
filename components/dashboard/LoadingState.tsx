import Icon from "@/components/Icon";

type LoadingSurface =
  | "agent"
  | "brief"
  | "dashboard"
  | "profile";

type LoadingLayout = "tiles" | "rows" | "split";

const SURFACE_COPY: Record<LoadingSurface, { kicker: string; title: string; icon: string }> = {
  agent: { kicker: "Agent", title: "Loading live work", icon: "auto_awesome" },
  dashboard: { kicker: "Dashboard", title: "Gathering the morning view", icon: "dashboard" },
  brief: { kicker: "Dashboard", title: "Gathering the morning view", icon: "dashboard" },
  profile: { kicker: "Profile", title: "Loading profile and integrations", icon: "verified" },
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
      <section className="relative overflow-hidden rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-6 py-12 md:px-9 md:py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
          {copy.kicker}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]">
            <Icon name={copy.icon} size={18} />
          </span>
          <h1
            className="text-[clamp(1.75rem,3.6vw,2.75rem)] font-bold leading-[1.04] tracking-[-0.02em] text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {copy.title}
          </h1>
        </div>
        <div className="mt-6 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-[var(--color-ink-2)]">
          <span className="dashboard-loader-bar" />
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
