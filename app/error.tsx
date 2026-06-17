"use client";

import Icon from "@/components/Icon";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="monaco-canvas relative isolate flex min-h-[100dvh] flex-1 flex-col items-center justify-center px-6 py-24">
      {/* Animated background */}
      <div className="animated-bg">
        <div className="animated-bg-orb animated-bg-orb-1" />
        <div className="animated-bg-orb animated-bg-orb-2" />
        <div className="animated-bg-orb animated-bg-orb-3" />
        <div className="animated-bg-orb animated-bg-orb-4" />
      </div>

      <section className="onboard-panel relative z-10 w-full max-w-md text-center">
        <p className="mono text-[var(--color-accent)]">Error</p>
        <h1 className="display-serif mt-4 text-[1.75rem] text-[var(--color-text-1)]">
          Something went wrong
        </h1>
        <p className="mt-3 text-[15px] leading-[1.6] text-[var(--color-text-2)]">
          An unexpected issue occurred. You can try resetting the page.
        </p>
        <button
          type="button"
          onClick={reset}
          className="btn-solid mt-6 inline-flex justify-center"
        >
          <Icon name="refresh" size={16} />
          Try again
        </button>
      </section>
    </main>
  );
}
