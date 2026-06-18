"use client";

import { useActionState } from "react";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  createActivationSetupFormAction,
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
    createActivationSetupFormAction,
    INITIAL_STATE,
  );

  return (
    <form action={action} className="grid gap-4">
      <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          Start with the website
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
          Bombsell can learn the company, audience, signal sources, and first
          outreach posture from the site. Add extra context only when it will
          sharpen the first run.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
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
          label="Company"
          icon="corporate_fare"
          placeholder="Optional"
          defaultValue={initialCompanyName}
        />
      </div>
      <details className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--color-text-1)]">
          Optional launch context
          <Icon name="tune" size={16} className="text-[var(--color-text-3)]" />
        </summary>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
          Use these fields when the website is sparse or you want to steer the
          first signals, contacts, and outreach tone.
        </p>
        <div className="mt-4 grid gap-4">
          <Select
            name="industry"
            label="Industry"
            defaultValue="Software Development & SaaS"
            options={[
              ["Software Development & SaaS", "Software Development & SaaS"],
              ["IT Services and IT Consulting", "IT Services and IT Consulting"],
              ["Marketing", "Marketing"],
              ["Staffing and Recruiting", "Staffing and Recruiting"],
              ["Business Consulting", "Business Consulting"],
              ["Other", "Other"],
            ]}
          />
          <TextArea
            name="company_description"
            label="Description and value proposition"
            placeholder="What do you do, who is it for, and why do buyers care?"
            rows={4}
          />
          <TextArea
            name="customer_pain_points"
            label="Customer pain points"
            placeholder="What makes your target audience ready to talk?"
            rows={3}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <TextArea
              name="target_titles"
              label="Buyer roles"
              placeholder={"VP of Sales\nHead of Growth\nFounder"}
              rows={4}
            />
            <TextArea
              name="target_markets"
              label="Target markets"
              placeholder={
                "Software Development & SaaS\nIT Services\nNorth America"
              }
              rows={4}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <TextArea
              name="key_features"
              label="Key features"
              placeholder="One feature per line."
              rows={4}
            />
            <TextArea
              name="social_proof"
              label="Social proof"
              placeholder="Customer logos, outcomes, testimonials, or proof points."
              rows={4}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <TextArea
              name="signal_keywords"
              label="Signal keywords"
              placeholder={"intent data\nverified emails\nlinkedin prospecting"}
              rows={4}
            />
            <TextArea
              name="competitor_watchlist"
              label="Competitors to watch"
              placeholder={"Apollo.io\nZoomInfo\nArtisan"}
              rows={4}
            />
          </div>
          <TextArea
            name="exclusion_rules"
            label="Do not contact"
            placeholder="Service providers, freelancers, consultants, open-to-work profiles, existing customers, or named companies to avoid."
            rows={3}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              name="outreach_goal"
              label="Goal"
              defaultValue="conversations"
              options={[
                ["conversations", "Start conversations"],
                ["demos", "Book qualified demos"],
              ]}
            />
            <Select
              name="message_tone"
              label="Tone"
              defaultValue="professional"
              options={[
                ["professional", "Professional"],
                ["conversational", "Conversational"],
                ["direct", "Direct"],
              ]}
            />
          </div>
        </div>
      </details>
      <input type="hidden" name="preferred_language" value="English (US)" />
      {state.error ? (
        <p className="flex items-start gap-2 rounded-[10px] border border-[color:var(--color-neg)] bg-[var(--color-neg-bg)] px-3 py-2 text-sm leading-6 text-[var(--color-neg)]">
          <Icon name="error" size={16} />
          <span>{state.error}</span>
        </p>
      ) : null}
      <PendingSubmitButton
        pending={pending}
        pendingLabel="Building Profile"
        icon="arrow_forward"
        iconSize={18}
        className="btn-solid mt-1 w-full justify-center"
      >
        Launch agent
      </PendingSubmitButton>
    </form>
  );
}

function TextArea({
  name,
  label,
  placeholder,
  rows,
}: {
  name: string;
  label: string;
  placeholder?: string;
  rows: number;
}) {
  return (
    <label className="onboard-field">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <span className="onboard-field-control">
        <textarea name={name} placeholder={placeholder} rows={rows} />
      </span>
    </label>
  );
}

function Select({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: Array<[string, string]>;
}) {
  return (
    <label className="onboard-field">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <span className="onboard-field-control">
        <select name={name} defaultValue={defaultValue}>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </span>
    </label>
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
