import Link from "next/link";
import Icon from "@/components/Icon";
import UrlStart from "@/components/UrlStart";

const PLANETS: {
  orbit: 1 | 2 | 3 | 4;
  icon: string;
  label: string;
  title: string;
}[] = [
  { orbit: 1, icon: "send", label: "Outreach", title: "Outreach" },
  { orbit: 2, icon: "article", label: "Content", title: "Content" },
  { orbit: 3, icon: "campaign", label: "Campaigns", title: "Campaigns" },
  { orbit: 4, icon: "travel_explore", label: "AEO", title: "Agentic Engine Optimization" },
];

export default function Home() {
  return (
    <main className="canvas-bg relative isolate min-h-[100dvh]">
      {/* fixed top navbar — full-viewport bar with top + bottom hairlines */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-t border-[color:var(--color-line-2)]">
        <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-6 py-4 md:px-10 lg:px-16">
          <span
            className="text-[1.375rem] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Bombsell
          </span>
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--color-text-2)] transition-colors hover:text-[var(--color-text-1)]"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* viewport-anchored side rules — stay put at any zoom */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-6 top-0 z-10 w-px bg-[color:var(--color-line-2)] md:left-10 lg:left-16"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-6 top-0 z-10 w-px bg-[color:var(--color-line-2)] md:right-10 lg:right-16"
      />

      {/* content — offset for fixed header */}
      <div className="mx-auto flex w-full max-w-[1240px] flex-col px-6 pt-[72px] md:px-10 lg:px-16">
        <section className="grid min-h-[calc(100dvh-72px)] items-center gap-10 py-10 sm:gap-12 sm:py-14 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:py-0">
          <div className="max-w-xl">
            <h1 className="display-serif text-[clamp(3.25rem,7.5vw,6rem)] text-[var(--color-text-1)]">
              The future
              <br />
              <em>GTM stack</em>.
            </h1>

            <UrlStart />
          </div>

          <SolarSystem />
        </section>
      </div>
    </main>
  );
}

function SolarSystem() {
  return (
    <div className="mx-auto w-full max-w-[480px] px-2">
      <div className="solar">
        <div className="solar-halo" />

        {/* Sun — Bombsell at the centre */}
        <div className="solar-sun">
          <span className="solar-sun-mark">Bombsell</span>
        </div>

        {/* Orbits + planets */}
        {PLANETS.map((p) => (
          <div key={p.label} className={`orbit orbit-${p.orbit}`}>
            <div className="planet-pos">
              <div className="planet-counter">
                <div className="planet" title={p.title}>
                  <span className="planet-icon">
                    <Icon name={p.icon} size={14} />
                  </span>
                  <span className="text-[12px] font-medium text-[var(--color-text-1)]">
                    {p.label}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
