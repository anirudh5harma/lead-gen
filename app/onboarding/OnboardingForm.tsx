"use client";

import { useActionState } from "react";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
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
    <form action={action} className="grid gap-4">
      <Field
        name="website_url"
        label="Website"
        type="url"
        icon="language"
        placeholder="https://yourcompany.com"
        defaultValue={initialWebsiteUrl}
        autoFocus={!initialWebsiteUrl}
      />
      <Field
        name="company_name"
        label="Company name hint"
        icon="corporate_fare"
        placeholder="Optional"
        defaultValue={initialCompanyName}
      />
      {state.error ? (
        <p className="flex items-start gap-2 rounded-[10px] border border-[color:var(--color-neg)] bg-[var(--color-neg-bg)] px-3 py-2 text-sm leading-6 text-[var(--color-neg)]">
          <Icon name="error" size={16} />
          <span>{state.error}</span>
        </p>
      ) : null}
      <PendingSubmitButton
        pending={pending}
        pendingLabel="Creating workspace"
        icon="arrow_forward"
        iconSize={18}
        className="group mt-1 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--color-accent-hi)] px-5 text-sm font-semibold text-[var(--color-accent-on)] shadow-[0_10px_24px_-14px_rgba(35,84,88,0.85)] transition-[background,transform,box-shadow] hover:bg-[var(--color-accent)] hover:shadow-[0_14px_30px_-14px_rgba(35,84,88,0.9)] active:translate-y-px disabled:cursor-wait disabled:opacity-70"
      >
        Create workspace
      </PendingSubmitButton>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  icon,
  placeholder,
  defaultValue,
  autoFocus,
}: {
  name: string;
  label: string;
  type?: string;
  icon?: string;
  placeholder?: string;
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="onboard-field">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <span className="onboard-field-control">
        {icon ? <Icon name={icon} size={18} className="onboard-field-icon" /> : null}
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          defaultValue={defaultValue}
          autoFocus={autoFocus}
        />
      </span>
    </label>
  );
}
