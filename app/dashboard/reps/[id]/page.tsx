import { notFound } from "next/navigation";
import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { configureRepAction } from "../../actions";

export const dynamic = "force-dynamic";

interface RepDetailRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: {
    voice?: string;
    story?: string;
    kpis?: string[];
    do_not?: string[];
  };
  autonomy: {
    channels?: { email?: { daily_cap?: number; approval?: string } };
  };
}

interface RepKpiRow {
  outbound_7d: string;
  positive_7d: string;
  open_conversations: string;
}

interface RecentMessageRow {
  id: string;
  subject: string | null;
  body: string | null;
  status: string;
  channel: string;
  created_at: Date;
}

interface RepLearningRow {
  id: string;
  pattern_key: string;
  label: string | null;
  score: string;
  win_count: number;
  loss_count: number;
  last_used_at: Date | null;
  created_at: Date;
}

async function loadRepDetail(workspaceId: string, repId: string) {
  const pool = getPool();
  const [rep, kpi, messages, learning] = await Promise.all([
    pool.query<RepDetailRow>(
      `select id, name, role::text as role, status::text as status, persona, autonomy
         from reps
        where workspace_id = $1 and id = $2
        limit 1`,
      [workspaceId, repId],
    ),
    pool.query<RepKpiRow>(
      `select
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.created_at >= now() - interval '7 days'
              and m.conversation_id in (
                select c.id from conversations c
                 where c.workspace_id = $1 and c.rep_id = $2
              )) as outbound_7d,
         (select count(*)::text from outcomes o
            where o.workspace_id = $1
              and o.attributed_rep_id = $2
              and o.kind = 'positive_reply'
              and o.recorded_at >= now() - interval '7 days') as positive_7d,
         (select count(*)::text from conversations c
            where c.workspace_id = $1
              and c.rep_id = $2
              and c.status in ('open','awaiting_them','awaiting_us')) as open_conversations`,
      [workspaceId, repId],
    ),
    pool.query<RecentMessageRow>(
      `select m.id, m.subject, m.body, m.status::text as status, m.channel::text as channel, m.created_at
         from messages m
         join conversations c on c.id = m.conversation_id
        where m.workspace_id = $1
          and c.rep_id = $2
          and m.direction = 'outbound'
        order by m.created_at desc
        limit 8`,
      [workspaceId, repId],
    ),
    pool.query<RepLearningRow>(
      `select id,
              pattern_key,
              coalesce(
                exemplar->>'title',
                exemplar->>'subject',
                exemplar->>'summary',
                exemplar->>'body'
              ) as label,
              score::text as score,
              win_count,
              loss_count,
              last_used_at,
              created_at
         from rep_memory_procedural
        where workspace_id = $1
          and rep_id = $2
        order by score desc, last_used_at desc nulls last, created_at desc
        limit 6`,
      [workspaceId, repId],
    ),
  ]);

  return {
    rep: rep.rows[0] ?? null,
    kpi: kpi.rows[0] ?? {
      outbound_7d: "0",
      positive_7d: "0",
      open_conversations: "0",
    },
    messages: messages.rows,
    learning: learning.rows,
  };
}

export default async function RepDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveWorkspaceSession();
  if (!active)
    return <CanvasEmpty label="Profile" title="No workspace selected." />;

  const { rep, kpi, messages, learning } = await loadRepDetail(
    active.workspace.id,
    id,
  );
  if (!rep) return notFound();

  return (
    <div className="space-y-10">
      <section className="section-canvas min-h-[360px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <p className="brief-kicker">{surfaceFor(rep.name)}</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              {rep.name}
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              {rep.persona.story ??
                "Give this voice a clear brief, then let outcomes shape the next move."}
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Last seven days
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <MiniStatus label="Sent" value={Number(kpi.outbound_7d)} />
              <MiniStatus label="Replies" value={Number(kpi.positive_7d)} />
              <MiniStatus label="Open" value={Number(kpi.open_conversations)} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="section-canvas p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="brief-note-icon">
              <Icon name="edit_note" size={18} />
            </span>
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">
              Guidance
            </h2>
          </div>
          <form action={configureRepAction} className="grid gap-4">
            <input
              type="hidden"
              name="return_to"
              value={`/dashboard/reps/${rep.id}`}
            />
            <input type="hidden" name="rep_id" value={rep.id} />
            <input type="hidden" name="rep_name" value={rep.name} />
            <input type="hidden" name="rep_role" value={rep.role} />
            <TextArea
              name="rep_voice"
              label="How this should sound"
              rows={4}
              defaultValue={rep.persona.voice ?? ""}
            />
            <TextArea
              name="rep_story"
              label="What this voice should protect"
              rows={3}
              defaultValue={rep.persona.story ?? ""}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="daily_cap"
                label="Daily ceiling"
                defaultValue={String(
                  rep.autonomy.channels?.email?.daily_cap ?? 25,
                )}
                type="number"
              />
              <Select
                name="approval"
                label="Review mode"
                defaultValue={rep.autonomy.channels?.email?.approval ?? "none"}
                options={[
                  ["none", "Autonomous after checks"],
                  ["always", "Review every move"],
                  ["approve_first", "Review the first move"],
                  ["research_only", "Research only"],
                ]}
              />
            </div>
            <PendingSubmitButton
              className="btn-solid w-fit"
              icon="check"
              iconSize={17}
              pendingLabel="Saving guidance"
            >
              Save guidance
            </PendingSubmitButton>
          </form>
        </section>

        <section className="section-canvas p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="brief-note-icon">
              <Icon name={iconFor(rep.name)} size={18} />
            </span>
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">
              Recent work
            </h2>
          </div>
          {messages.length === 0 ? (
            <EmptyState
              title="No recent work"
              hint="Useful moves from this voice will appear here."
            />
          ) : (
            <div className="grid gap-2">
              {messages.map((message) => (
                <MessageNote key={message.id} message={message} />
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="section-canvas mt-6 p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="brief-note-icon">
            <Icon name="auto_awesome" size={18} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">
              Learning
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-3)]">
              Patterns this Rep reuses in drafts, judges, and next moves.
            </p>
          </div>
        </div>
        {learning.length === 0 ? (
          <EmptyState
            title="No learned patterns yet"
            hint="Accepted work and real outcomes will turn into reusable patterns here."
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {learning.map((item) => (
              <LearningNote key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LearningNote({ item }: { item: RepLearningRow }) {
  const score = Math.round(Number(item.score) * 100);
  const label = item.label?.trim() || humanPattern(item.pattern_key);
  return (
    <article className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-pos-bg)] px-2 py-1 text-xs font-medium text-[var(--color-pos)]">
          {score}% useful
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {item.last_used_at
            ? `Used ${new Date(item.last_used_at).toLocaleDateString()}`
            : `Seeded ${new Date(item.created_at).toLocaleDateString()}`}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-[var(--color-text-1)]">
        {label}
      </h3>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
        {item.win_count} wins · {item.loss_count} misses ·{" "}
        {humanPattern(item.pattern_key)}
      </p>
    </article>
  );
}

function MessageNote({ message }: { message: RecentMessageRow }) {
  return (
    <article className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs font-medium text-[var(--color-accent)]">
          {messageStatusLabel(message.status)}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-3)]">
          {new Date(message.created_at).toLocaleDateString()}
        </span>
      </div>
      {message.subject ? (
        <h3 className="mt-3 text-sm font-semibold text-[var(--color-text-1)]">
          {message.subject}
        </h3>
      ) : null}
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-2)]">
        {message.body ?? "(empty)"}
      </p>
    </article>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
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
      <span className="text-xs font-medium text-[var(--color-text-3)]">
        {label}
      </span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
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
      <span className="text-xs font-medium text-[var(--color-text-3)]">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
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

function MiniStatus({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3">
      <strong className="block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
      <span className="mt-1 block text-xs text-[var(--color-text-3)]">
        {label}
      </span>
    </span>
  );
}

function surfaceFor(name: string): string {
  if (name === "Sampark") return "Sampark · Conversations";
  if (name === "Prayog") return "Prayog · Plays";
  if (name === "Vaani" || name === "Bodh") return `${name} · Retired`;
  return "Prospecting";
}

function messageStatusLabel(status: string): string {
  if (status === "sent") return "Sent";
  if (status === "delivered") return "Delivered";
  if (status === "draft") return "Draft";
  if (status === "queued") return "Ready";
  if (status === "deferred") return "Held for review";
  if (status === "failed") return "Failed";
  if (status === "bounced") return "Bounced";
  return status.replace(/_/g, " ");
}

function humanPattern(patternKey: string): string {
  return patternKey
    .split("|")
    .map((part) => {
      const [key, ...rest] = part.split(":");
      const value = rest.join(":") || key;
      return value.replace(/[_-]/g, " ");
    })
    .join(" · ");
}

function iconFor(name: string): string {
  if (name === "Sampark") return "forum";
  if (name === "Prayog") return "science";
  if (name === "Vaani" || name === "Bodh") return "lock";
  return "person";
}

function CanvasEmpty({ label, title }: { label: string; title: string }) {
  return (
    <section className="section-canvas p-6">
      <p className="brief-kicker">{label}</p>
      <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
        {title}
      </h1>
    </section>
  );
}
