import Link from "next/link";
import Icon from "@/components/Icon";

export default function NotFound() {
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
        <p className="mono text-[var(--color-accent)]">404</p>
        <h1 className="display-serif mt-4 text-[1.75rem] text-[var(--color-text-1)]">
          Not found
        </h1>
        <p className="mt-3 text-[15px] leading-[1.6] text-[var(--color-text-2)]">
          The page you are looking for does not exist.
        </p>
        <Link href="/" className="btn-solid mt-6 inline-flex justify-center">
          <Icon name="arrow_back" size={16} />
          Return home
        </Link>
      </section>
    </main>
  );
}
