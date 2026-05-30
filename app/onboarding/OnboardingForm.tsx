"use client";

import { useActionState } from "react";
import Icon from "@/components/Icon";
import {
  createProfileAndAggregatorFormAction,
  type OnboardingActionState,
} from "./actions";

const INITIAL_STATE: OnboardingActionState = { error: null };

export default function OnboardingForm({
  initialWebsiteUrl,
  initialCompanyName,
}: {
  initialWebsiteUrl?: string;
  initialCompanyName?: string;
}) {
  const [state, action, pending] = useActionState(
    createProfileAndAggregatorFormAction,
    INITIAL_STATE,
  );

  return (
    <form action={action} className="mt-5 grid gap-4">
      <Field
        name="website_url"
        label="Website"
        type="url"
        placeholder="https://yourcompany.com"
        defaultValue={initialWebsiteUrl}
        autoFocus={!initialWebsiteUrl}
      />
      <Field
        name="company_name"
        label="Company name hint"
        placeholder="Optional"
        defaultValue={initialCompanyName}
      />
      {state.error ? (
        <p className="rounded-md border border-[color:var(--color-neg)] bg-[var(--color-neg-bg)] px-3 py-2 text-sm leading-6 text-[var(--color-neg)]">
          {state.error}
        </p>
      ) : null}
      <button
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-5 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)] disabled:cursor-wait disabled:opacity-70"
      >
        <Icon name={pending ? "hourglass_top" : "arrow_forward"} size={18} />
        {pending ? "Creating workspace" : "Create workspace"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  defaultValue,
  autoFocus,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  autoFocus?: boolean;
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
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        className="min-h-11 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] px-3 text-sm text-[var(--color-text-1)] outline-none transition-colors placeholder:text-[var(--color-text-4)] focus:border-[var(--color-accent)]"
      />
    </label>
  );
}
