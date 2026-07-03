"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import {
  getProductCompanyProfile,
  approveWorkflowApproval,
  configureActivationSetup,
  configureWorkspaceCrmDestination,
  configureWorkspaceSignalSource,
  configureRep,
  configureWorkspaceAutonomyMode,
  configureWorkspaceCompanyProfile,
  createProductWorkspaceForUser,
  deleteProductRecommendation,
  dismissProductSignal,
  dispatchSignalPlaysOnce,
  draftProductRecommendation,
  generateProductMeetingPrep,
  optimizeProductCampaignStrategy,
  optimizeProductPlaySkills,
  recordProductCampaignOutcome,
  recordProductPersonFitFeedback,
  recordProductRecommendationOutcome,
  retryFailedWorkflowRun,
  reviewProductRecommendation,
  runWorkspaceSignalIngestion,
  runWorkspaceSourcePollNow,
  updateProductRecommendation,
  verifiedProductWorkspaceSession,
  type ProductWorkspaceSession,
} from "@/core/product/app";
import {
  analyzeCompanyWebsite,
  normalizeCompanyWebsiteUrl,
} from "@/core/product/company-profile";
import { normalizePublicHostname } from "@/lib/network/public-url";
import { getRequestUserId } from "@/lib/auth";
import {
  getActiveWorkspaceSession,
  setActiveWorkspaceCookie,
} from "@/lib/workspace";
import { getPool } from "@/core/substrate/storage/index.ts";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function checked(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

type ToastVariant = "success" | "error" | "info";

function dashboardReturnPath(formData: FormData, fallback: string): string {
  const raw = value(formData, "return_to");
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw, "https://bombsell.local");
    if (
      parsed.origin !== "https://bombsell.local" ||
      !parsed.pathname.startsWith("/dashboard")
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function redirectWithToast(
  target: string,
  message: string,
  variant: ToastVariant = "success",
): never {
  const parsed = new URL(target, "https://bombsell.local");
  parsed.searchParams.set("toast", message);
  parsed.searchParams.set("toast_variant", variant);
  redirect(`${parsed.pathname}${parsed.search}${parsed.hash}`);
}

function dashboardActionErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (/authentication required/i.test(error.message)) {
    return "Sign in again before changing Agent work.";
  }
  if (/workspace access denied|active workspace/i.test(error.message)) {
    return "Select an active workspace before changing Agent work.";
  }
  if (/not found/i.test(error.message)) {
    return "That item is no longer available. Refresh and try again.";
  }
  return fallback;
}

function numberValue(
  formData: FormData,
  key: string,
  fallback: number,
): number {
  const parsed = Number(value(formData, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

type DashboardApprovalPolicy =
  | "none"
  | "approve_first"
  | "always"
  | "research_only";

function approvalValue(
  formData: FormData,
  key: string,
  fallback: DashboardApprovalPolicy = "none",
): DashboardApprovalPolicy {
  const raw = value(formData, key);
  return raw === "none" ||
    raw === "approve_first" ||
    raw === "always" ||
    raw === "research_only"
    ? raw
    : fallback;
}

function repRoleValue(formData: FormData, key: string) {
  const role = value(formData, key);
  return (
    ["sdr", "replier", "researcher", "campaign", "custom"].includes(role)
      ? role
      : "sdr"
  ) as "sdr" | "replier" | "researcher" | "campaign" | "custom";
}

async function requireDashboardSession(
  formData?: FormData,
): Promise<ProductWorkspaceSession> {
  const existing = await getActiveWorkspaceSession();
  if (existing) {
    return verifiedProductWorkspaceSession({
      workspace_id: existing.workspace.id,
      user_id: existing.user_id,
    });
  }

  const userId = await getRequestUserId();
  if (!userId) throw new Error("authentication required");
  const workspace = await createProductWorkspaceForUser(
    {
      name: formData ? value(formData, "workspace_name") : "Bombsell Workspace",
      slug: formData ? value(formData, "workspace_slug") : undefined,
    },
    userId,
  );
  await setActiveWorkspaceCookie(workspace.id);
  return verifiedProductWorkspaceSession({
    workspace_id: workspace.id,
    user_id: userId,
  });
}

async function repNameFromForm(
  formData: FormData,
  session: ProductWorkspaceSession,
): Promise<string> {
  const submittedName = value(formData, "rep_name");
  if (submittedName) return submittedName;

  const repId = value(formData, "rep_id");
  if (!repId) return "Outbound agent";

  const { rows } = await getPool().query<{ name: string }>(
    `select name
       from reps
      where workspace_id = $1
        and id = $2
      limit 1`,
    [session.workspace_id, repId],
  );
  return rows[0]?.name ?? "Outbound agent";
}

export async function createWorkspaceAction(formData: FormData) {
  await requireDashboardSession(formData);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profile");
  redirectWithToast("/dashboard/profile#profile", "Workspace created.");
}

export async function switchWorkspaceAction(formData: FormData) {
  const workspaceId = value(formData, "workspace_id");
  if (!workspaceId) {
    redirectWithToast(
      "/dashboard",
      "Choose a workspace before switching.",
      "error",
    );
  }
  await setActiveWorkspaceCookie(workspaceId);
  revalidateProductPaths();
  redirectWithToast("/dashboard", "Workspace switched.");
}

export async function updateWorkspaceAutonomyAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const returnTo = dashboardReturnPath(formData, "/dashboard/profile");
  const mode =
    value(formData, "autonomy_mode") === "review_only"
      ? "review_only"
      : "autonomous";
  await configureWorkspaceAutonomyMode({ mode }, session);
  revalidateProductPaths();
  revalidatePath("/dashboard/profile");
  redirectWithToast(
    returnTo,
    mode === "review_only"
      ? "Review-only mode saved."
      : "Autonomous mode saved.",
  );
}

export async function configureActivationAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const returnTo = dashboardReturnPath(formData, "/dashboard/profile#agent");
  const signalKind = value(formData, "signal_kind") || "hiring";
  const approval = approvalValue(formData, "approval");
  const repName = await repNameFromForm(formData, session);
  await configureActivationSetup(
    {
      rep: {
        name: repName,
        role: "sdr",
        voice:
          value(formData, "rep_voice") ||
          "Direct, warm, specific, and allergic to generic sales fluff.",
        story:
          value(formData, "rep_story") ||
          "Turns fresh market signals into founder-led conversations.",
        daily_cap: numberValue(formData, "daily_cap", 25),
        approval,
      },
      icp: {
        name: value(formData, "icp_name") || "Hiring signal ICP",
        description:
          value(formData, "icp_description") ||
          "Companies showing fresh hiring intent around GTM, operations, or revenue roles.",
        signal_kind: signalKind,
        match_threshold: numberValue(formData, "match_threshold", 0.6),
      },
      play: {
        signal_kind: signalKind,
        daily_cap: numberValue(formData, "daily_cap", 25),
        approval,
      },
    },
    session,
  );
  const sourceCheckStarted = await startAgentSourceCheck(session);
  revalidateProductPaths();
  redirectWithToast(
    returnTo,
    sourceCheckStarted
      ? "Guidance saved. Agent is checking sources."
      : "Guidance saved. Source check did not start yet.",
    sourceCheckStarted ? "success" : "error",
  );
}

export async function configureRepAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent#system");
  const name = await repNameFromForm(formData, session);
  await configureRep(
    {
      name,
      role: repRoleValue(formData, "rep_role"),
      voice:
        value(formData, "rep_voice") ||
        "Warm, precise, low-hype, founder-to-founder.",
      story:
        value(formData, "rep_story") ||
        "Acts on fresh buying signals without spraying generic outreach.",
      daily_cap: numberValue(formData, "daily_cap", 25),
      approval: approvalValue(formData, "approval"),
    },
    session,
  );
  revalidateProductPaths();
  redirectWithToast(returnTo, "Agent guidance saved.");
}

export async function reviewRecommendationAction(formData: FormData) {
  const session = await requireDashboardSession();
  const reviewId = value(formData, "review_id");
  if (!reviewId) return;
  const decision =
    value(formData, "decision") === "ignored" ? "ignored" : "accepted";
  await reviewProductRecommendation(
    {
      review_id: reviewId,
      decision,
      note: value(formData, "note") || null,
    },
    session,
  );
  revalidateProductPaths();
}

export async function updateRecommendationAction(formData: FormData) {
  const session = await requireDashboardSession();
  const reviewId = value(formData, "review_id");
  if (!reviewId) return;
  await updateProductRecommendation(
    {
      review_id: reviewId,
      title: value(formData, "title"),
      detail: value(formData, "detail"),
      url: value(formData, "url") || null,
      note: value(formData, "note") || null,
    },
    session,
  );
  revalidateProductPaths();
}

export async function deleteRecommendationAction(formData: FormData) {
  const session = await requireDashboardSession();
  const reviewId = value(formData, "review_id");
  if (!reviewId) return;
  await deleteProductRecommendation(
    {
      review_id: reviewId,
      reason: value(formData, "reason") || null,
    },
    session,
  );
  revalidateProductPaths();
}

export async function recordRecommendationOutcomeAction(formData: FormData) {
  const session = await requireDashboardSession();
  const reviewId = value(formData, "review_id");
  if (!reviewId) return;
  const kindValue = value(formData, "outcome_kind");
  const kind =
    kindValue === "follower_lift" || kindValue === "engagement_lift"
      ? kindValue
      : "post_published";
  const externalRef = value(formData, "external_ref");
  await recordProductRecommendationOutcome(
    {
      review_id: reviewId,
      kind,
      external_ref: externalRef || null,
      properties: {
        recorded_from: "dashboard",
        surface: value(formData, "surface") || "recommendation_review",
      },
    },
    session,
  );
  revalidateProductPaths();
}

export async function createRecommendationDraftAction(formData: FormData) {
  const session = await requireDashboardSession();
  const reviewId = value(formData, "review_id");
  if (!reviewId) return;
  const channelValue = value(formData, "channel");
  const channel =
    channelValue === "linkedin_comment" ||
    channelValue === "web" ||
    channelValue === "other" ||
    channelValue === "x_post"
      ? channelValue
      : undefined;
  await draftProductRecommendation(
    {
      review_id: reviewId,
      channel,
    },
    session,
  );
  revalidateProductPaths();
}

export async function recordCampaignOutcomeAction(formData: FormData) {
  const session = await requireDashboardSession();
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent#learning");
  const playRunId = value(formData, "play_run_id");
  if (!playRunId) {
    redirectWithToast(
      returnTo,
      "Choose an outreach run before recording an outcome.",
      "error",
    );
  }
  const kindValue = value(formData, "outcome_kind");
  const kind =
    kindValue === "meeting_booked"
      ? "meeting_booked"
      : kindValue === "deal_won"
        ? "deal_won"
        : kindValue === "positive_reply"
          ? "positive_reply"
          : "opportunity_created";
  await recordProductCampaignOutcome(
    {
      play_run_id: playRunId,
      kind,
      note: value(formData, "note") || null,
      external_ref: value(formData, "external_ref") || null,
      properties: {
        recorded_from: "dashboard",
        surface: "campaigns",
      },
    },
    session,
  );
  revalidateProductPaths();
  redirectWithToast(returnTo, "Result recorded.");
}

export async function optimizeCampaignStrategyAction(formData: FormData) {
  const session = await requireDashboardSession();
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent#learning");
  await optimizeProductCampaignStrategy(
    {
      lookback_days: numberValue(formData, "lookback_days", 30),
      min_samples: numberValue(formData, "min_samples", 3),
    },
    session,
  );
  revalidateProductPaths();
  redirectWithToast(returnTo, "Outreach strategy updated.");
}

export async function optimizePlaySkillsAction(formData: FormData) {
  const session = await requireDashboardSession();
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent#learning");
  await optimizeProductPlaySkills(
    {
      lookback_days: numberValue(formData, "lookback_days", 30),
      min_samples: numberValue(formData, "min_samples", 3),
    },
    session,
  );
  revalidateProductPaths();
  redirectWithToast(returnTo, "Outreach learning updated.");
}

export async function prepareQualifiedSignalsAction(formData: FormData) {
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent#qualified-signals");
  try {
    const session = await requireDashboardSession();
    await dispatchSignalPlaysOnce(
      { limit: numberValue(formData, "limit", 25) },
      session,
    );
    revalidateProductPaths();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Qualified signal preparation failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        "Could not prepare contacts and outreach yet. Refresh and try again.",
      ),
      "error",
    );
  }
  redirectWithToast(returnTo, "Preparing verified contacts and outreach.");
}

export async function resolveQualifiedSignalContactsAction(formData: FormData) {
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent#qualified-signals");
  const signalId = value(formData, "signal_id");
  if (!signalId) {
    redirectWithToast(
      returnTo,
      "Choose a qualified signal before resolving contacts.",
      "error",
    );
  }
  try {
    const session = await requireDashboardSession();
    await dispatchSignalPlaysOnce({ signal_id: signalId, limit: 1 }, session);
    revalidateProductPaths();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Qualified signal contact resolution failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        "Could not review contacts for that signal yet. Refresh and try again.",
      ),
      "error",
    );
  }
  redirectWithToast(returnTo, "Resolving verified contacts and outreach.");
}

export async function checkAgentSourcesAction(formData: FormData) {
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent");
  let sourceCheckStarted = false;
  try {
    const session = await requireDashboardSession();
    sourceCheckStarted = await startAgentSourceCheck(
      session,
      numberValue(formData, "limit", 25),
    );
    revalidateProductPaths();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Agent source check failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        "Could not start the source check yet. Refresh and try again.",
      ),
      "error",
    );
  }
  if (!sourceCheckStarted) {
    redirectWithToast(
      returnTo,
      "Could not start the source check yet. Refresh and try again.",
      "error",
    );
  }
  redirectWithToast(returnTo, "Source check started.");
}

export async function runAgentSourceNowAction(formData: FormData) {
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent");
  const sourceId = value(formData, "source_id");
  if (!sourceId) {
    redirectWithToast(returnTo, "Choose a source before running it.", "error");
  }
  try {
    const session = await requireDashboardSession();
    await runWorkspaceSourcePollNow({ source_id: sourceId }, session);
    revalidateProductPaths();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Agent source run failed", error);
    redirectWithToast(
      returnTo,
      error instanceof Error && /paused/i.test(error.message)
        ? "That source is paused. Enable it before running."
        : dashboardActionErrorMessage(
            error,
            "Could not run that source yet. Refresh and try again.",
          ),
      "error",
    );
  }
  redirectWithToast(returnTo, "Source run started.");
}

export async function configureVisitorIntentSourceAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const returnTo = dashboardReturnPath(formData, "/dashboard/profile#visitor-intent");
  const websiteUrl = normalizeCompanyWebsiteUrl(value(formData, "visitor_website_url"));
  const companyDomain =
    normalizePublicHostname(value(formData, "visitor_company_domain")) ??
    normalizePublicHostname(websiteUrl);
  const companyName = value(formData, "visitor_company_name");
  if (!websiteUrl && !companyDomain) {
    redirectWithToast(
      returnTo,
      "Add a public website or company domain before creating the visitor source.",
      "error",
    );
  }
  try {
    await configureWorkspaceSignalSource(
      {
        adapter: "webhook",
        name: "Bombsell visitor intent",
        provider: "bombsell_script",
        website_url: websiteUrl ?? undefined,
        company_domain: companyDomain ?? undefined,
        company_name: companyName || undefined,
        signal_kind: "other",
        poll_interval_minutes: 60,
        enabled: true,
      },
      session,
    );
  } catch (error) {
    console.error("Visitor intent source setup failed", error);
    redirectWithToast(
      returnTo,
      "Could not create the visitor source yet. Refresh and try again.",
      "error",
    );
  }
  revalidateProductPaths();
  redirectWithToast(returnTo, "Visitor intent source created.");
}

export async function revokeMcpTokenAction(formData: FormData) {
  const session = await requireDashboardSession();
  const returnTo = dashboardReturnPath(formData, "/dashboard/profile#tools");
  const tokenHash = value(formData, "token_hash");
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) {
    redirectWithToast(returnTo, "Choose a Claude Code session before revoking.", "error");
  }

  let rowCount: number | null = 0;
  try {
    ({ rowCount } = await getPool().query(
      `update mcp_oauth_tokens
          set revoked_at = now(),
              revoked_by_user_id = $2
        where token_hash = $1
          and user_id = $2
          and revoked_at is null`,
      [tokenHash, session.user_id],
    ));
  } catch (error) {
    if (isMissingMcpOauthSchema(error)) {
      redirectWithToast(returnTo, "Claude Code access is not initialized yet.", "error");
    }
    throw error;
  }
  revalidatePath("/dashboard/profile");
  redirectWithToast(
    returnTo,
    rowCount ? "Claude Code access revoked." : "That Claude Code session was already revoked.",
    rowCount ? "success" : "info",
  );
}

export async function configureCrmDestinationAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const returnTo = dashboardReturnPath(formData, "/dashboard/profile#crm-sync");
  const provider = value(formData, "crm_provider") || "hubspot";
  const syncModeValue = value(formData, "crm_sync_mode");
  const sync_mode =
    syncModeValue === "full_loop"
      ? "full_loop"
      : syncModeValue === "qualified_and_sent"
        ? "qualified_and_sent"
        : "qualified_contacts";
  try {
    await configureWorkspaceCrmDestination(
      {
        provider,
        display_name: value(formData, "crm_display_name") || undefined,
        webhook_url: value(formData, "crm_webhook_url") || null,
        sync_mode,
        include_sent_outreach: checked(formData, "crm_include_sent_outreach"),
        include_replies_meetings: checked(formData, "crm_include_replies_meetings"),
      },
      session,
    );
  } catch (error) {
    if (error instanceof Error && /valid CRM webhook URL/i.test(error.message)) {
      redirectWithToast(returnTo, "Enter a valid CRM webhook URL.", "error");
    }
    throw error;
  }
  revalidateProductPaths();
  redirectWithToast(returnTo, "CRM handoff saved.");
}

function isMissingMcpOauthSchema(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "42P01" ||
      (error as { code?: unknown }).code === "42703")
  );
}

export async function generateMeetingPrepAction(formData: FormData) {
  const conversationId = value(formData, "conversation_id");
  const returnTo = dashboardReturnPath(
    formData,
    conversationId
      ? `/dashboard/agent/outreach/${conversationId}`
      : "/dashboard/agent#outreach",
  );
  if (!conversationId) {
    redirectWithToast(
      returnTo,
      "Choose a conversation before preparing.",
      "error",
    );
  }
  try {
    const session = await requireDashboardSession();
    await generateProductMeetingPrep(
      { conversation_id: conversationId },
      session,
    );
    revalidateProductPaths();
    revalidatePath(`/dashboard/agent/outreach/${conversationId}`);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Meeting prep generation failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        "Could not prepare that meeting yet. Refresh and try again.",
      ),
      "error",
    );
  }
  redirectWithToast(returnTo, "Meeting prep updated.");
}

export async function dismissQualifiedSignalAction(formData: FormData) {
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent");
  const signalId = value(formData, "signal_id");
  if (!signalId) {
    redirectWithToast(
      returnTo,
      "Choose a qualified signal before skipping.",
      "error",
    );
  }
  try {
    const session = await requireDashboardSession();
    await dismissProductSignal(
      {
        signal_id: signalId,
        reason:
          value(formData, "reason") ||
          "Skipped from Agent because the signal is not a fit for outreach.",
      },
      session,
    );
    revalidateProductPaths();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Signal dismissal failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        "Could not skip that opportunity yet. Refresh and try again.",
      ),
      "error",
    );
  }
  redirectWithToast(returnTo, "Opportunity skipped.");
}

export async function recordPersonFitFeedbackAction(formData: FormData) {
  const personId = value(formData, "person_id");
  const returnTo = dashboardReturnPath(
    formData,
    personId
      ? `/dashboard/agent/contacts/${personId}`
      : "/dashboard/agent#verified-contacts",
  );
  if (!personId) {
    redirectWithToast(returnTo, "Choose a contact before recording fit.", "error");
  }
  const decisionValue = value(formData, "decision");
  const decision =
    decisionValue === "fit" || decisionValue === "not_fit"
      ? decisionValue
      : "unsure";
  try {
    const session = await requireDashboardSession(formData);
    await recordProductPersonFitFeedback(
      {
        person_id: personId,
        decision,
        note: value(formData, "note") || null,
      },
      session,
    );
    revalidateProductPaths();
    revalidatePath(`/dashboard/agent/contacts/${personId}`);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Contact fit feedback failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        "Could not save contact fit yet. Refresh and try again.",
      ),
      "error",
    );
  }
  redirectWithToast(returnTo, "Contact fit saved.");
}

export async function editCompanyProfileAction(formData: FormData) {
  const session = await requireDashboardSession();
  const returnTo = dashboardReturnPath(formData, "/dashboard/profile#profile");
  const company_name = value(formData, "company_name");
  const website_url = value(formData, "website_url");
  if (!company_name || !website_url) {
    redirectWithToast(
      returnTo,
      "Enter the company name and website before saving.",
      "error",
    );
  }
  try {
    const pool = getPool();
    const existingProfile = await getProductCompanyProfile(pool, session);
    const normalizedWebsite = normalizeCompanyWebsiteUrl(website_url);
    if (!normalizedWebsite) {
      redirectWithToast(returnTo, "Enter a valid company website.", "error");
    }
    const currentWebsite = normalizeCompanyWebsiteUrl(existingProfile?.website_url);
    const submittedDescription = value(formData, "description");
    const shouldRefreshFromWebsite =
      normalizedWebsite !== currentWebsite ||
      !(existingProfile?.description ?? "").trim();
    const extractedProfile = shouldRefreshFromWebsite
      ? await analyzeCompanyWebsite({
          websiteUrl: normalizedWebsite,
          companyHint: company_name,
        })
      : null;
    const finalDescription =
      submittedDescription || extractedProfile?.description || null;

    await configureWorkspaceCompanyProfile(
      {
        company_name,
        website_url: normalizedWebsite,
        industry: value(formData, "industry") || extractedProfile?.industry || null,
        size_bucket: value(formData, "company_size") || null,
        description: finalDescription,
        value_proposition: value(formData, "value_proposition") || null,
        customer_pain_points: value(formData, "customer_pain_points") || null,
        target_titles: value(formData, "target_titles") || null,
        target_markets: value(formData, "target_markets") || null,
        key_features: value(formData, "key_features") || null,
        social_proof: value(formData, "social_proof") || null,
        signal_keywords: value(formData, "signal_keywords") || null,
        competitor_watchlist: value(formData, "competitor_watchlist") || null,
        linkedin_signal_behaviors:
          value(formData, "linkedin_signal_behaviors") || null,
        exclusion_rules: value(formData, "exclusion_rules") || null,
        preferred_language: value(formData, "preferred_language") || null,
        outreach_goal: value(formData, "outreach_goal") || null,
        message_tone: value(formData, "message_tone") || null,
        linkedin_company_url: value(formData, "linkedin_company_url") || null,
        auto_enrich_email_addresses: checked(
          formData,
          "auto_enrich_email_addresses",
        ),
        prevent_team_contact_duplication: checked(
          formData,
          "prevent_team_contact_duplication",
        ),
        profile_source: submittedDescription
          ? "manual"
          : extractedProfile?.source ?? "manual",
      },
      session,
    );
    const sourceCheckStarted = finalDescription
      ? await startAgentSourceCheck(session)
      : false;
    revalidateProductPaths();
    redirectWithToast(
      returnTo,
      finalDescription
        ? sourceCheckStarted
          ? "Company profile saved. Agent is checking sources."
          : "Company profile saved. Source check did not start yet."
        : "Company profile saved. Add a company description to activate outreach.",
      finalDescription && !sourceCheckStarted ? "error" : "success",
    );
  } catch (error) {
    if (error instanceof Error && /valid website_url/i.test(error.message)) {
      redirectWithToast(returnTo, "Enter a valid company website.", "error");
    }
    throw error;
  }
}

async function startAgentSourceCheck(
  session: ProductWorkspaceSession,
  limit = 25,
): Promise<boolean> {
  try {
    await runWorkspaceSignalIngestion({ limit }, session, { wait: false });
    return true;
  } catch (error) {
    console.error("Agent source check failed", error);
    return false;
  }
}

export async function retryActivationSetupAction(formData: FormData) {
  const returnTo = dashboardReturnPath(formData, "/dashboard/profile#profile");
  const runId = value(formData, "workflow_run_id");
  if (!runId) {
    redirectWithToast(returnTo, "That Agent launch is no longer available.", "error");
  }
  let retried = false;
  try {
    const session = await requireDashboardSession();
    retried = await retryFailedWorkflowRun(runId, session);
    revalidateProductPaths();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Activation setup retry failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        "Could not retry Agent launch yet. Refresh and try again.",
      ),
      "error",
    );
  }
  redirectWithToast(
    returnTo,
    retried ? "Agent launch restarted." : "Agent launch is already running or complete.",
    retried ? "success" : "info",
  );
}

export async function decideApprovalWithDraftAction(formData: FormData) {
  const returnTo = dashboardReturnPath(formData, "/dashboard/agent#qualified-signals");
  const approvalId = value(formData, "approval_id");
  if (!approvalId) {
    redirectWithToast(
      returnTo,
      "Choose an outreach item before deciding.",
      "error",
    );
  }
  const decision =
    value(formData, "decision") === "rejected" ? "rejected" : "approved";
  const subject = value(formData, "subject");
  const body = value(formData, "body");
  const note =
    decision === "approved" && (subject || body)
      ? JSON.stringify({
          type: "draft_override",
          subject,
          body,
        })
      : value(formData, "decision_note") || undefined;
  let decided = false;
  try {
    const session = await requireDashboardSession();
    decided = await approveWorkflowApproval(
      approvalId,
      decision,
      session,
      note,
    );
    revalidateProductPaths();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Approval decision failed", error);
    redirectWithToast(
      returnTo,
      dashboardActionErrorMessage(
        error,
        decision === "rejected"
          ? "Could not reject this draft yet. Refresh and try again."
          : "Could not approve this draft yet. Refresh and try again.",
      ),
      "error",
    );
  }
  if (!decided) {
    redirectWithToast(
      returnTo,
      "That draft decision could not be confirmed. Refresh and try again.",
      "error",
    );
  }
  redirectWithToast(
    returnTo,
    decision === "rejected" ? "Draft rejected." : "Draft approved.",
  );
}

function revalidateProductPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agent");
  revalidatePath("/dashboard/health");
  revalidatePath("/dashboard/profile");
}
