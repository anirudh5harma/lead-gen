import type { Pool } from "pg";

export type LaunchReadinessStatus = "ready" | "needs_attention" | "blocked";
export type LaunchReadinessRequiredChannel = "any" | "email" | "linkedin" | "both";
export type LaunchReadinessPrimitive = "Rep" | "Signal" | "Play" | "Conversation";

export interface LaunchReadinessAction {
  label: string;
  tools: string[];
  surface: string;
}

export interface LaunchReadinessCheck {
  id:
    | "workspace_profile"
    | "icp"
    | "rep"
    | "signal_sources"
    | "plays"
    | "outlook"
    | "linkedin"
    | "outreach_channel";
  label: string;
  primitive: LaunchReadinessPrimitive;
  status: LaunchReadinessStatus;
  required: boolean;
  detail: string;
  count: number;
  action: LaunchReadinessAction | null;
}

export interface WorkspaceLaunchReadiness {
  workspace_id: string;
  checked_at: string;
  required_channel: LaunchReadinessRequiredChannel;
  status: LaunchReadinessStatus;
  launch_ready: boolean;
  next_action:
    | "start_outreach"
    | "configure_profile"
    | "configure_icp"
    | "configure_rep"
    | "configure_sources"
    | "configure_play"
    | "connect_outlook"
    | "connect_linkedin"
    | "repair_channel";
  checks: LaunchReadinessCheck[];
  blockers: string[];
  warnings: string[];
}

interface LaunchReadinessRow {
  workspace_profiles: string | number;
  enabled_icps: string | number;
  active_reps: string | number;
  enabled_sources: string | number;
  active_plays: string | number;
  connected_outlook: string | number;
  active_outlook_subscriptions: string | number;
  needs_reauth_outlook: string | number;
  errored_outlook: string | number;
  connected_linkedin: string | number;
  rate_limited_linkedin: string | number;
  needs_reauth_linkedin: string | number;
  suspended_linkedin: string | number;
  disconnected_linkedin: string | number;
}

export async function loadWorkspaceLaunchReadiness(
  pool: Pool,
  workspace_id: string,
  opts: { required_channel?: LaunchReadinessRequiredChannel; now?: Date } = {},
): Promise<WorkspaceLaunchReadiness> {
  const required_channel = opts.required_channel ?? "any";
  const { rows } = await pool.query<LaunchReadinessRow>(
    `with outlook_accounts as (
       select coalesce(
                nullif(lower(properties ->> 'mailbox_email'), ''),
                nullif(lower(display_name), ''),
                id::text
              ) as outlook_mailbox_key,
              status,
              properties,
              last_error
         from channel_accounts
        where workspace_id = $1
          and kind = 'oauth_outlook'
     ),
     outlook_mailboxes as (
       select outlook_mailbox_key,
              bool_or(status = 'connected') as has_connected,
              bool_or(
                status = 'connected'
                and properties -> 'outlook_subscription' is not null
                and properties -> 'outlook_subscription' ->> 'clientState' is not null
                and properties -> 'outlook_subscription' ->> 'lifecycleNotificationUrl' is not null
                and (properties -> 'outlook_subscription' ->> 'expirationDateTime')::timestamptz
                      > now() + interval '15 minutes'
              ) as has_active_subscription,
              bool_or(status = 'needs_reauth') as has_needs_reauth,
              bool_or(status = 'connected' and last_error is not null) as has_connected_error
         from outlook_accounts
        group by outlook_mailbox_key
     )
     select
        (select count(*) from graph_companies
          where workspace_id = $1
            and properties->>'profile_role' = 'workspace_company') as workspace_profiles,
        (select count(*) from workspace_icps
          where workspace_id = $1 and enabled) as enabled_icps,
        (select count(*) from reps
          where workspace_id = $1 and status = 'active') as active_reps,
        (select count(*) from workspace_source_configs
          where workspace_id = $1 and enabled) as enabled_sources,
        (select count(*) from plays
          where workspace_id = $1 and status = 'active') as active_plays,
        (select count(*) from outlook_mailboxes
          where has_connected) as connected_outlook,
        (select count(*) from outlook_mailboxes
          where has_active_subscription) as active_outlook_subscriptions,
        (select count(*) from outlook_mailboxes
          where has_needs_reauth and not has_connected) as needs_reauth_outlook,
        (select count(*) from outlook_mailboxes
          where has_connected_error) as errored_outlook,
        (select count(*) from channel_accounts
          where workspace_id = $1
            and kind in ('linkedin_session','linkedin_oauth')
            and status = 'connected') as connected_linkedin,
        (select count(*) from channel_accounts
          where workspace_id = $1
            and kind in ('linkedin_session','linkedin_oauth')
            and status = 'rate_limited') as rate_limited_linkedin,
        (select count(*) from channel_accounts
          where workspace_id = $1
            and kind in ('linkedin_session','linkedin_oauth')
            and status = 'needs_reauth') as needs_reauth_linkedin,
        (select count(*) from channel_accounts
          where workspace_id = $1
            and kind in ('linkedin_session','linkedin_oauth')
            and status = 'suspended') as suspended_linkedin,
        (select count(*) from channel_accounts
          where workspace_id = $1
            and kind in ('linkedin_session','linkedin_oauth')
            and status = 'disconnected') as disconnected_linkedin`,
    [workspace_id],
  );
  return buildWorkspaceLaunchReadiness(
    workspace_id,
    rows[0] ?? emptyLaunchReadinessRow(),
    {
      required_channel,
      now: opts.now,
    },
  );
}

export function buildWorkspaceLaunchReadiness(
  workspace_id: string,
  row: LaunchReadinessRow,
  opts: { required_channel?: LaunchReadinessRequiredChannel; now?: Date } = {},
): WorkspaceLaunchReadiness {
  const required_channel = opts.required_channel ?? "any";
  const counts = {
    workspaceProfiles: numericCount(row.workspace_profiles),
    enabledIcps: numericCount(row.enabled_icps),
    activeReps: numericCount(row.active_reps),
    enabledSources: numericCount(row.enabled_sources),
    activePlays: numericCount(row.active_plays),
    connectedOutlook: numericCount(row.connected_outlook),
    activeOutlookSubscriptions: numericCount(row.active_outlook_subscriptions),
    needsReauthOutlook: numericCount(row.needs_reauth_outlook),
    erroredOutlook: numericCount(row.errored_outlook),
    connectedLinkedIn: numericCount(row.connected_linkedin),
    rateLimitedLinkedIn: numericCount(row.rate_limited_linkedin),
    needsReauthLinkedIn: numericCount(row.needs_reauth_linkedin),
    suspendedLinkedIn: numericCount(row.suspended_linkedin),
    disconnectedLinkedIn: numericCount(row.disconnected_linkedin),
  };
  const outlookReady =
    counts.connectedOutlook > 0 &&
    counts.activeOutlookSubscriptions > 0 &&
    counts.erroredOutlook === 0;
  const linkedInReady = counts.connectedLinkedIn > 0;
  const checks: LaunchReadinessCheck[] = [
    countCheck({
      id: "workspace_profile",
      label: "Workspace profile",
      primitive: "Signal",
      count: counts.workspaceProfiles,
      detailReady: "Company profile is available for matching and personalization.",
      detailBlocked: "No workspace company profile is available from the website setup.",
      action: action("Configure profile", ["product.company.profile.configure"], "/dashboard/setup"),
    }),
    countCheck({
      id: "icp",
      label: "ICP",
      primitive: "Signal",
      count: counts.enabledIcps,
      detailReady: `${counts.enabledIcps} ICP segment${plural(counts.enabledIcps)} enabled.`,
      detailBlocked: "No enabled ICP segment is available for lead matching.",
      action: action("Configure ICP", ["product.icp.configure"], "/dashboard/setup"),
    }),
    countCheck({
      id: "rep",
      label: "Rep",
      primitive: "Rep",
      count: counts.activeReps,
      detailReady: `${counts.activeReps} active Rep${plural(counts.activeReps)} can own outreach.`,
      detailBlocked: "No active Rep is available to own outreach.",
      action: action("Configure Agent", ["product.rep.configure"], "/dashboard/agent"),
    }),
    countCheck({
      id: "signal_sources",
      label: "Signal sources",
      primitive: "Signal",
      count: counts.enabledSources,
      detailReady: `${counts.enabledSources} autonomous Signal source${plural(counts.enabledSources)} enabled.`,
      detailBlocked: "No autonomous Signal source is enabled.",
      action: action(
        "Configure Signal source",
        ["product.sources.default_aggregator.configure", "product.source.configure"],
        "/dashboard/campaigns",
      ),
    }),
    countCheck({
      id: "plays",
      label: "Plays",
      primitive: "Play",
      count: counts.activePlays,
      detailReady: `${counts.activePlays} active Play${plural(counts.activePlays)} can react to matched Signals.`,
      detailBlocked: "No active Play is available for matched Signals.",
      action: action("Configure Play", [
        "product.play.signal_email.configure",
        "product.play.signal_linkedin.configure",
      ], "/dashboard/campaigns"),
    }),
    outlookCheck(counts, outlookReady, required_channel),
    linkedInCheck(counts, linkedInReady, required_channel),
    outreachChannelCheck({
      outlookReady,
      linkedInReady,
      required_channel,
    }),
  ];
  const required = checks.filter((check) => check.required);
  const blockers = required
    .filter((check) => check.status !== "ready")
    .map((check) => check.id);
  const warnings = checks
    .filter((check) => !check.required && check.status !== "ready")
    .map((check) => check.id);
  const status = blockers.length === 0
    ? "ready"
    : required.some((check) => check.status === "needs_attention")
      ? "needs_attention"
      : "blocked";
  return {
    workspace_id,
    checked_at: (opts.now ?? new Date()).toISOString(),
    required_channel,
    status,
    launch_ready: status === "ready",
    next_action: nextAction(checks),
    checks,
    blockers,
    warnings,
  };
}

function countCheck(input: {
  id: LaunchReadinessCheck["id"];
  label: string;
  primitive: LaunchReadinessPrimitive;
  count: number;
  detailReady: string;
  detailBlocked: string;
  action: LaunchReadinessAction;
}): LaunchReadinessCheck {
  return {
    id: input.id,
    label: input.label,
    primitive: input.primitive,
    status: input.count > 0 ? "ready" : "blocked",
    required: true,
    detail: input.count > 0 ? input.detailReady : input.detailBlocked,
    count: input.count,
    action: input.count > 0 ? null : input.action,
  };
}

function outlookCheck(
  counts: {
    connectedOutlook: number;
    activeOutlookSubscriptions: number;
    needsReauthOutlook: number;
    erroredOutlook: number;
  },
  ready: boolean,
  required_channel: LaunchReadinessRequiredChannel,
): LaunchReadinessCheck {
  const required = required_channel === "email" || required_channel === "both";
  const needsAttention = counts.connectedOutlook > 0 || counts.needsReauthOutlook > 0;
  const status: LaunchReadinessStatus = ready
    ? "ready"
    : needsAttention
      ? "needs_attention"
      : "blocked";
  const detail = ready
    ? `${counts.activeOutlookSubscriptions}/${counts.connectedOutlook} Outlook inboxes have active reply sync.`
    : counts.needsReauthOutlook > 0
      ? `${counts.needsReauthOutlook} Outlook inbox${plural(counts.needsReauthOutlook)} need Microsoft reauthorization.`
      : counts.connectedOutlook > 0
        ? `${counts.activeOutlookSubscriptions}/${counts.connectedOutlook} Outlook inboxes have active reply sync; backend Graph subscription repair must finish before email launch.`
        : "No connected Outlook inbox is ready for email outreach.";
  return {
    id: "outlook",
    label: "Outlook",
    primitive: "Conversation",
    status,
    required,
    detail,
    count: counts.connectedOutlook,
    action: ready ? null : action(
      counts.connectedOutlook > 0 ? "Review Outlook sync" : "Connect Outlook",
      ["product.outlook_account.connect_url.get"],
      "/dashboard/deliverability",
    ),
  };
}

function linkedInCheck(
  counts: {
    connectedLinkedIn: number;
    rateLimitedLinkedIn: number;
    needsReauthLinkedIn: number;
    suspendedLinkedIn: number;
    disconnectedLinkedIn: number;
  },
  ready: boolean,
  required_channel: LaunchReadinessRequiredChannel,
): LaunchReadinessCheck {
  const required = required_channel === "linkedin" || required_channel === "both";
  const unhealthy =
    counts.rateLimitedLinkedIn +
    counts.needsReauthLinkedIn +
    counts.suspendedLinkedIn +
    counts.disconnectedLinkedIn;
  const status: LaunchReadinessStatus = ready
    ? "ready"
    : unhealthy > 0
      ? "needs_attention"
      : "blocked";
  const detail = ready
    ? `${counts.connectedLinkedIn} LinkedIn account${plural(counts.connectedLinkedIn)} connected.`
    : unhealthy > 0
      ? `${unhealthy} LinkedIn account${plural(unhealthy)} need attention before LinkedIn outreach.`
      : "No connected LinkedIn account is ready for DM or connection outreach.";
  return {
    id: "linkedin",
    label: "LinkedIn",
    primitive: "Conversation",
    status,
    required,
    detail,
    count: counts.connectedLinkedIn,
    action: ready ? null : action(
      "Connect LinkedIn",
      ["product.linkedin_account.connect_url.get"],
      "/dashboard/setup",
    ),
  };
}

function outreachChannelCheck(input: {
  outlookReady: boolean;
  linkedInReady: boolean;
  required_channel: LaunchReadinessRequiredChannel;
}): LaunchReadinessCheck {
  const ready =
    input.required_channel === "both"
      ? input.outlookReady && input.linkedInReady
      : input.required_channel === "email"
        ? input.outlookReady
        : input.required_channel === "linkedin"
          ? input.linkedInReady
          : input.outlookReady || input.linkedInReady;
  const needed = input.required_channel === "both"
    ? "Outlook and LinkedIn"
    : input.required_channel === "email"
      ? "Outlook"
      : input.required_channel === "linkedin"
        ? "LinkedIn"
        : "Outlook or LinkedIn";
  return {
    id: "outreach_channel",
    label: "Outreach channel gate",
    primitive: "Play",
    status: ready ? "ready" : "blocked",
    required: true,
    detail: ready
      ? `${needed} channel requirement is satisfied.`
      : `Launch needs ${needed} connected, healthy, and allowed by Play policy.`,
    count: Number(input.outlookReady) + Number(input.linkedInReady),
    action: ready ? null : action(
      "Connect outreach channel",
      [
        "product.outlook_account.connect_url.get",
        "product.linkedin_account.connect_url.get",
      ],
      "/dashboard/setup",
    ),
  };
}

function nextAction(checks: LaunchReadinessCheck[]): WorkspaceLaunchReadiness["next_action"] {
  const firstBlocker = checks.find((check) => check.required && check.status !== "ready");
  if (!firstBlocker) return "start_outreach";
  if (firstBlocker.id === "workspace_profile") return "configure_profile";
  if (firstBlocker.id === "icp") return "configure_icp";
  if (firstBlocker.id === "rep") return "configure_rep";
  if (firstBlocker.id === "signal_sources") return "configure_sources";
  if (firstBlocker.id === "plays") return "configure_play";
  if (firstBlocker.id === "outlook") return "connect_outlook";
  if (firstBlocker.id === "linkedin") return "connect_linkedin";
  const channelTools = firstBlocker.action?.tools ?? [];
  if (channelTools.length === 1 && channelTools[0] === "product.outlook_account.connect_url.get") {
    return "connect_outlook";
  }
  if (channelTools.length === 1 && channelTools[0] === "product.linkedin_account.connect_url.get") {
    return "connect_linkedin";
  }
  return "repair_channel";
}

function action(label: string, tools: string[], surface: string): LaunchReadinessAction {
  return { label, tools, surface };
}

function numericCount(value: string | number | null | undefined): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function emptyLaunchReadinessRow(): LaunchReadinessRow {
  return {
    workspace_profiles: 0,
    enabled_icps: 0,
    active_reps: 0,
    enabled_sources: 0,
    active_plays: 0,
    connected_outlook: 0,
    active_outlook_subscriptions: 0,
    needs_reauth_outlook: 0,
    errored_outlook: 0,
    connected_linkedin: 0,
    rate_limited_linkedin: 0,
    needs_reauth_linkedin: 0,
    suspended_linkedin: 0,
    disconnected_linkedin: 0,
  };
}
