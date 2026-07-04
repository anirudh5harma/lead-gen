import type { Metadata } from "next";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import PlanSection from "@/components/dashboard/PlanSection";
import { editCompanyProfileAction } from "@/app/dashboard/actions";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getWorkspaceBillingState } from "@/core/billing/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Settings | Bombsell" };
export const dynamic = "force-dynamic";

interface ProfileRow {
  company_name: string | null;
  website_url: string | null;
  description: string | null;
  message_tone: string | null;
  outreach_goal: string | null;
}

interface IcpRow {
  name: string | null;
  description: string | null;
}

async function loadProfile(workspaceId: string): Promise<ProfileRow | null> {
  const pool = getPool();
  const { rows } = await pool.query<ProfileRow>(
    `select company_name,
            website_url,
            description,
            message_tone,
            outreach_goal
       from workspace_company_profiles
      where workspace_id = $1
      order by created_at asc
      limit 1`,
    [workspaceId],
  );
  return rows[0] ?? null;
}

async function loadIcp(workspaceId: string): Promise<IcpRow | null> {
  const pool = getPool();
  const { rows } = await pool.query<IcpRow>(
    `select name, description
       from workspace_icps
      where workspace_id = $1
      order by created_at asc
      limit 1`,
    [workspaceId],
  );
  return rows[0] ?? null;
}

const inputCls =
  "w-full rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-[14px] leading-5 text-[var(--color-text-1)] outline-none transition-colors focus:border-[var(--color-line-3)]";

const TONE_OPTIONS = [
  { value: "founder_direct", label: "Founder-direct — plainspoken, 1:1" },
  { value: "concise_pro", label: "Concise pro — sharp, no filler" },
  { value: "warm_advisor", label: "Warm advisor — helpful, curious" },
  { value: "bold_pitch", label: "Bold pitch — punchy, opinionated" },
];

export default async function SettingsPage() {
  const session = await getActiveWorkspaceSessionForDashboard("settings");
  if (!session) return <SettingsEmpty />;

  const [profile, icp, billing] = await Promise.all([
    loadProfile(session.workspace.id).catch(() => null),
    loadIcp(session.workspace.id).catch(() => null),
    getWorkspaceBillingState(getPool(), session.workspace.id).catch(() => null),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Settings
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--color-text-1)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Your workspace
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-[var(--color-text-3)]">
          Company profile, ICP, outreach tone, and subscription.
        </p>
      </header>

      <form action={editCompanyProfileAction} className="space-y-6">
        <input type="hidden" name="return_to" value="/dashboard/settings" />

        <Card title="Company">
          <Field label="Company name" required>
            <input
              name="company_name"
              defaultValue={profile?.company_name ?? ""}
              required
              className={inputCls}
              placeholder="Acme Robotics"
            />
          </Field>
          <Field label="Website">
            <input
              name="website_url"
              defaultValue={profile?.website_url ?? ""}
              type="url"
              className={inputCls}
              placeholder="https://acmerobotics.com"
            />
          </Field>
          <Field label="Description" hint="One paragraph. What you do, who it's for.">
            <textarea
              name="description"
              defaultValue={profile?.description ?? ""}
              rows={4}
              className={inputCls}
              placeholder="We help B2B ops teams cut invoice chase time by 80% via an AI-native ledger."
            />
          </Field>
        </Card>

        <Card title="Outreach tone">
          <Field
            label="Tone"
            hint="Applied to every drafted email + DM. Change any time."
          >
            <select
              name="message_tone"
              defaultValue={profile?.message_tone ?? "founder_direct"}
              className={inputCls}
            >
              {TONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Primary outreach goal">
            <input
              name="outreach_goal"
              defaultValue={profile?.outreach_goal ?? ""}
              className={inputCls}
              placeholder="Book 15-min discovery calls"
            />
          </Field>
        </Card>

        <div className="flex justify-end">
          <PendingSubmitButton
            className="btn-solid-sm"
            icon="save"
            iconSize={14}
            pendingLabel="Saving"
          >
            Save changes
          </PendingSubmitButton>
        </div>
      </form>

      <Card title="ICP (Ideal Customer Profile)">
        <div className="grid gap-1.5">
          <p className="text-[13px] font-medium text-[var(--color-text-2)]">
            {icp?.name ?? "No ICP configured"}
          </p>
          <p className="text-[13px] leading-5 text-[var(--color-text-3)]">
            {icp?.description ??
              "Set your ICP so signals get scored against a real target."}
          </p>
          <a
            href="/dashboard/agent#icp"
            className="btn-quiet-sm mt-2 inline-flex w-fit"
          >
            <Icon name="edit" size={12} />
            Refine ICP
          </a>
        </div>
      </Card>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)]">
          Subscription
        </h2>
        <PlanSection billing={billing} />
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 sm:p-6">
      <h2 className="mb-4 text-[15px] font-semibold text-[var(--color-text-1)]">
        {title}
      </h2>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-[13px]">
      <span className="font-medium text-[var(--color-text-2)]">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[12px] text-[var(--color-text-3)]">{hint}</span> : null}
    </label>
  );
}

function SettingsEmpty() {
  return (
    <div className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-8 text-center">
      <Icon name="settings" size={20} />
      <p className="mt-2 text-[15px] font-semibold text-[var(--color-text-1)]">
        No workspace loaded
      </p>
    </div>
  );
}
