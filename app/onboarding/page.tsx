import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import { getRequestUserId } from "@/lib/auth";
import { createProfileAndAggregatorAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const userId = await getRequestUserId();
  if (!userId) redirect("/login?next=/onboarding");

  return (
    <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="pt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
            Signal aggregator setup
          </p>
          <h1 className="mt-2 max-w-xl font-sans text-4xl font-semibold leading-tight text-[var(--color-text-1)]">
            Create the first agent-native GTM loop from your website.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--color-text-2)]">
            The website profile becomes graph memory. Sources become configured
            Signal inputs. The first run goes through the durable ingestion
            workflow before anything reaches a Play.
          </p>
          <div className="mt-8 grid gap-3">
            <FlowStep icon="badge" label="User" text="Google OAuth session through Supabase." />
            <FlowStep icon="hub" label="Graph" text="Company profile stored as a workspace company node." />
            <FlowStep icon="sensors" label="Signals" text="Google News, HN, and Product Hunt sources configured." />
            <FlowStep icon="account_tree" label="Runtime" text="Aggregator dispatches the workspace poll workflow." />
          </div>
        </div>

        <section className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5">
          <h2 className="font-sans text-lg font-semibold text-[var(--color-text-1)]">
            Profile and ingest
          </h2>
          <form action={createProfileAndAggregatorAction} className="mt-5 grid gap-4">
            <Field
              name="website_url"
              label="Company website"
              type="url"
              placeholder="https://yourcompany.com"
            />
            <Field
              name="company_name"
              label="Company name hint"
              placeholder="Optional"
            />
            <button className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-on)] transition-colors hover:bg-[var(--color-accent-hi)]">
              <Icon name="rocket_launch" size={18} />
              Build signal loop
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        className="min-h-11 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 text-sm text-[var(--color-text-1)] outline-none transition-colors placeholder:text-[var(--color-text-4)] focus:border-[var(--color-accent)]"
      />
    </label>
  );
}

function FlowStep({
  icon,
  label,
  text,
}: {
  icon: string;
  label: string;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-3">
      <span className="flex size-8 items-center justify-center rounded-md bg-[var(--color-ink-0)] text-[var(--color-accent)]">
        <Icon name={icon} size={18} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">{label}</span>
        <span className="block text-sm leading-5 text-[var(--color-text-3)]">{text}</span>
      </span>
    </div>
  );
}
