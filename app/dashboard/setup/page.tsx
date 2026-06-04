import Link from "next/link";
import Icon from "@/components/Icon";
import { ProfileIntelligence } from "@/components/dashboard/ProfileIntelligence";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import { getAppState } from "@/core/product/app.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import {
  configureActivationAction,
  createWorkspaceAction,
  editCompanyProfileAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface SetupRepRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: { voice?: string; story?: string };
  autonomy: { channels?: { email?: { daily_cap?: number; approval?: string } } };
}

interface SetupIcpRow {
  id: string;
  name: string;
  description: string;
  match_threshold: string;
  must_haves: Array<{ field?: string; op?: string; value?: unknown }>;
}

interface SetupAccountRow {
  id: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
}

async function loadSetupState(workspaceId: string) {
  const pool = getPool();
  const [reps, icps, accounts] = await Promise.all([
    pool.query<SetupRepRow>(
      `select id, name, role::text as role, status::text as status, persona, autonomy
         from reps
        where workspace_id = $1
        order by created_at asc`,
      [workspaceId],
    ),
    pool.query<SetupIcpRow>(
      `select id, name, description, match_threshold::text as match_threshold, must_haves
         from workspace_icps
        where workspace_id = $1
        order by created_at asc`,
      [workspaceId],
    ),
    pool.query<SetupAccountRow>(
      `select id, display_name, status::text as status, daily_cap
         from channel_accounts
        where workspace_id = $1 and kind in ('email_domain','email_oauth')
        order by created_at asc`,
      [workspaceId],
    ),
  ]);
  return { reps: reps.rows, icps: icps.rows, accounts: accounts.rows };
}

export default async function SetupPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceSetup />;

  const pool = getPool();
  const [state, appState] = await Promise.all([
    loadSetupState(active.workspace.id),
    getAppState(pool, {
      workspace_id: active.workspace.id,
      user_id: active.user_id,
    }),
  ]);
  const rep = state.reps[0];
  const icp = state.icps[0];
  const account = state.accounts[0];
  const profile = appState.profile;
  const readyCount = [
    state.reps.length > 0,
    state.icps.length > 0,
    state.accounts.length > 0,
    Boolean(profile),
  ].filter(Boolean).length;

  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Profile"
        title={<>Shape the work <em>once</em>.</>}
        description="Tell Bombsell who matters, how you sound, and when you want review. The Reps work from this."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Ready" value={`${readyCount}/4`} />
            {profile?.company_name ? <HeroStat label="Company" value={profile.company_name} /> : null}
            {icp ? <HeroStat label="Audience" value={icp.name} /> : null}
          </div>
        }
      />

      <RepRoster reps={state.reps} />

      <SurfaceSection title="Company profile">
        <form
          action={editCompanyProfileAction}
          className="grid gap-4 rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-5 md:grid-cols-2"
        >
          <Field
            name="company_name"
            label="Company"
            defaultValue={profile?.company_name ?? ""}
            required
          />
          <Field
            name="website_url"
            label="Website"
            type="url"
            defaultValue={profile?.domain ? `https://${profile.domain}` : ""}
            required
          />
          <Field
            name="industry"
            label="Industry"
            defaultValue={profile?.industry ?? ""}
          />
          <Field
            name="description"
            label="One-line description"
            defaultValue={profile?.description ?? ""}
          />
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
            >
              <Icon name="check" size={16} />
              Save company
            </button>
            <button
              type="submit"
              name="refresh"
              value="1"
              className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-[color:var(--color-line-2)] bg-transparent px-4 text-sm font-medium text-[var(--color-text-2)] transition-colors hover:text-[var(--color-text-1)]"
            >
              <Icon name="refresh" size={16} />
              Save and refresh research
            </button>
          </div>
        </form>
      </SurfaceSection>

      <ProfileIntelligence profile={profile} />

      <SurfaceSection title="Outreach voice and limits">
        <form
          action={configureActivationAction}
          className="grid gap-4 rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-5"
        >
          <TextArea
            name="icp_description"
            label="Who matters (audience)"
            rows={3}
            defaultValue={
              icp?.description ??
              "Companies showing fresh hiring intent around GTM, operations, or revenue roles."
            }
          />
          <TextArea
            name="rep_voice"
            label="Voice"
            rows={3}
            defaultValue={
              rep?.persona.voice ??
              "Direct, warm, specific, and allergic to generic sales fluff."
            }
          />
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              name="sender"
              label="Outreach email"
              type="email"
              defaultValue={account?.display_name ?? "sampark@go.bombsell.example"}
            />
            <Field
              name="daily_cap"
              label="Max outreach/day"
              type="number"
              defaultValue={String(rep?.autonomy.channels?.email?.daily_cap ?? account?.daily_cap ?? 25)}
            />
            <Select
              name="approval"
              label="Before sending"
              defaultValue={rep?.autonomy.channels?.email?.approval ?? "approve_first"}
              options={[
                ["approve_first", "Approve first"],
                ["none", "Send when ready"],
              ]}
            />
          </div>
          <input type="hidden" name="icp_name" value={icp?.name ?? "Default audience"} />
          <input type="hidden" name="signal_kind" value="hiring" />
          <input type="hidden" name="match_threshold" value={icp ? Number(icp.match_threshold).toFixed(2) : "0.60"} />
          <input type="hidden" name="rep_name" value={rep?.name ?? "Sampark"} />
          <button className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
            <Icon name="check" size={16} />
            Save voice
          </button>
        </form>
      </SurfaceSection>
    </div>
  );
}

function NoWorkspaceSetup() {
  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Profile"
        title="Create a workspace."
        description="Start with a named workspace. The canvas appears after this."
      />
      <SurfaceSection title="Workspace">
        <form
          action={createWorkspaceAction}
          className="grid gap-4 rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-5 md:max-w-xl"
        >
          <Field name="workspace_name" label="Workspace name" defaultValue="Bombsell Workspace" />
          <Field name="workspace_slug" label="Workspace slug" defaultValue="bombsell-workspace" />
          <button className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
            <Icon name="add_business" size={16} />
            Create workspace
          </button>
        </form>
      </SurfaceSection>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
  rows,
}: {
  name: string;
  label: string;
  defaultValue: string;
  rows: number;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="rounded-[8px] border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
      />
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
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
      >
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

const REP_META: Record<
  string,
  { role: string; surface: string; href: string; icon: string }
> = {
  Sampark: {
    role: "Outreach SDR",
    surface: "Starts and moves conversations",
    href: "/dashboard/conversations",
    icon: "forum",
  },
  Vaani: {
    role: "Content",
    surface: "Writes what's worth publishing",
    href: "/dashboard/content",
    icon: "edit_note",
  },
  Prayog: {
    role: "Campaigns",
    surface: "Finds campaign ideas",
    href: "/dashboard/ingestion",
    icon: "science",
  },
  Bodh: {
    role: "AEO",
    surface: "Wins citations on AI engines",
    href: "/dashboard/aeo",
    icon: "neurology",
  },
};

const REP_ORDER = ["Sampark", "Vaani", "Prayog", "Bodh"];

function RepRoster({ reps }: { reps: SetupRepRow[] }) {
  const byName = new Map(reps.map((r) => [r.name, r]));
  const ordered = [
    ...REP_ORDER.map((name) => byName.get(name) ?? null),
    ...reps.filter((rep) => !REP_ORDER.includes(rep.name)),
  ];
  return (
    <SurfaceSection title="The cast">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ordered.map((r, index) => {
          const name = r?.name ?? REP_ORDER[index];
          const meta = REP_META[name] ?? {
            role: r?.role ?? "Custom",
            surface: r?.persona.story ?? "Custom work pattern",
            href: "/dashboard/reps",
            icon: "person",
          };
          const status = r?.status ?? "absent";
          return (
            <Link
              key={name}
              href={r ? `/dashboard/reps/${r.id}` : meta.href}
              className="group rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-5 transition-colors hover:bg-[var(--color-ink-2)]/40"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name={meta.icon} size={15} />
                </span>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                  {meta.role}
                </p>
              </div>
              <p
                className="mt-4 text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {name}
              </p>
              <p className="mt-1 text-[13px] text-[var(--color-text-2)]">{meta.surface}</p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                {status === "active" ? "Active" : status === "absent" ? "Not set up" : status}
              </p>
            </Link>
          );
        })}
      </div>
    </SurfaceSection>
  );
}

