import Link from "next/link";
import Icon from "@/components/Icon";

const NOTES = [
  { title: "Brief", text: "Today's work, replies, and review moments." },
  { title: "Profile", text: "The audience, voice, and rules in plain language." },
  { title: "Outreach", text: "Conversations that came back and need a next move." },
] as const;

export default function Home() {
  return (
    <main className="canvas-bg min-h-[100dvh] px-4 py-5 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100dvh-40px)] w-full max-w-7xl items-center gap-10 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="max-w-xl">
          <p className="brief-kicker">Bombsell</p>
          <h1 className="mt-4 text-[48px] font-semibold leading-[0.98] tracking-[0] text-[var(--color-text-1)] sm:text-[70px] lg:text-[82px]">
            A canvas for autonomous GTM work.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-8 text-[var(--color-text-2)]">
            Describe the work once. Bombsell watches, writes, and brings back only the moments that need a decision.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login?next=/onboarding"
              className="brief-button brief-button-primary"
            >
              <Icon name="arrow_forward" size={17} />
              Start workspace
            </Link>
            <Link
              href="/dashboard"
              className="brief-button"
            >
              Open canvas
            </Link>
          </div>
        </div>

        <WorkspacePreview />
      </section>
    </main>
  );
}

function WorkspacePreview() {
  return (
    <div className="relative min-h-[620px] overflow-hidden">
      <div className="brief-stream brief-stream-one" />
      <div className="brief-stream brief-stream-two" />
      <div className="absolute left-[8%] top-[10%] w-[min(72vw,470px)]">
        <p className="brief-kicker">Brief</p>
        <h2 className="mt-4 text-[38px] font-semibold leading-[1.04] text-[var(--color-text-1)]">
          Find revenue teams hiring RevOps leaders.
        </h2>
        <p className="mt-4 max-w-lg text-[15px] leading-7 text-[var(--color-text-2)]">
          Watch hiring pages, funding mentions, and founder posts. Draft only when there is a real reason to talk now.
        </p>
      </div>

      {NOTES.map((note, index) => (
        <div
          key={note.title}
          className={
            "brief-node brief-note " +
            [
              "right-[2%] top-[31%]",
              "left-[2%] bottom-[10%]",
              "right-[1%] bottom-[8%]",
            ][index]
          }
        >
          <span className="brief-note-icon">
            <Icon name={["auto_stories", "id_card", "mark_email_read"][index]} size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-[var(--color-text-1)]">
              {note.title}
            </span>
            <span className="mt-3 block text-sm leading-6 text-[var(--color-text-2)]">
              {note.text}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
