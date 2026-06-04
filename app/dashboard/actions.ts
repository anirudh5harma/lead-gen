"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveWorkflowApproval,
  configureActivationSetup,
  configureIcpSegment,
  configureRep,
  configureRssSource,
  configureWorkspaceCompanyProfile,
  configureWorkspaceSignalSource,
  configureWorkspaceEmailAccount,
  createProductWorkspaceForUser,
  dispatchSignalPlaysOnce,
  runWorkspaceSignalAggregatorOnce,
  recordProductRecommendationOutcome,
  reviewProductRecommendation,
  startWorkspaceProfileEnrichmentWithExa,
  submitManualSignal,
  trackCompanyForWorkspace,
  type ProductWorkspaceSession,
} from "@/core/product/app";
import { getRequestUserId } from "@/lib/auth";
import {
  getActiveWorkspaceSession,
  setActiveWorkspaceCookie,
} from "@/lib/workspace";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(formData: FormData, key: string, fallback: number): number {
  const parsed = Number(value(formData, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function repRoleValue(formData: FormData, key: string) {
  const role = value(formData, key);
  return (
    ["sdr", "content", "replier", "researcher", "campaign", "custom"].includes(role)
      ? role
      : "sdr"
  ) as "sdr" | "content" | "replier" | "researcher" | "campaign" | "custom";
}

async function requireDashboardSession(
  formData?: FormData,
): Promise<ProductWorkspaceSession> {
  const existing = await getActiveWorkspaceSession();
  if (existing) {
    return { workspace_id: existing.workspace.id, user_id: existing.user_id };
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
  return { workspace_id: workspace.id, user_id: userId };
}

export async function createWorkspaceAction(formData: FormData) {
  await requireDashboardSession(formData);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/setup");
  redirect("/dashboard/setup");
}

export async function switchWorkspaceAction(formData: FormData) {
  const workspaceId = value(formData, "workspace_id");
  if (!workspaceId) return;
  await setActiveWorkspaceCookie(workspaceId);
  revalidateProductPaths();
  redirect("/dashboard");
}

export async function configureActivationAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const signalKind = value(formData, "signal_kind") || "hiring";
  const approval =
    value(formData, "approval") === "none" ? "none" : "approve_first";
  await configureActivationSetup(
    {
      rep: {
        name: value(formData, "rep_name") || "Sampark",
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
      email: {
        display_name:
          value(formData, "sender") || "sampark@go.bombsell.example",
        daily_cap: numberValue(formData, "daily_cap", 25),
      },
      company: value(formData, "company_name")
        ? {
            name: value(formData, "company_name"),
            domain: value(formData, "company_domain"),
            industry: value(formData, "company_industry"),
            size_bucket: value(formData, "company_size"),
            greenhouse_id: value(formData, "greenhouse_id"),
            lever_id: value(formData, "lever_id"),
            ashby_id: value(formData, "ashby_id"),
            workable_id: value(formData, "workable_id"),
            career_rss_url: value(formData, "career_rss_url"),
            reason: "activation",
          }
        : undefined,
      source: value(formData, "source_url")
        ? {
            name: value(formData, "source_name") || "Hiring signal feed",
            url: value(formData, "source_url"),
            signal_kind: signalKind,
            poll_interval_minutes: numberValue(formData, "poll_interval_minutes", 60),
          }
        : undefined,
    },
    session,
  );
  revalidateProductPaths();
  redirect("/dashboard/setup");
}

export async function configureIcpAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  await configureIcpSegment(
    {
      name: value(formData, "icp_name") || "Hiring signal ICP",
      description:
        value(formData, "icp_description") ||
        "Companies showing fresh hiring intent.",
      signal_kind: value(formData, "signal_kind") || "hiring",
      match_threshold: numberValue(formData, "match_threshold", 0.6),
    },
    session,
  );
  revalidateProductPaths();
}

export async function configureRepAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const repId = value(formData, "rep_id");
  const name = value(formData, "rep_name") || "Sampark";
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
      approval:
        value(formData, "approval") === "none"
          ? "none"
          : value(formData, "approval") === "always"
            ? "always"
            : "approve_first",
    },
    session,
  );
  revalidateProductPaths();
  if (repId) revalidatePath(`/dashboard/reps/${repId}`);
}

export async function trackCompanyAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const name = value(formData, "company_name");
  if (!name) return;
  await trackCompanyForWorkspace(
    {
      name,
      domain: value(formData, "company_domain"),
      industry: value(formData, "company_industry"),
      size_bucket: value(formData, "company_size"),
      greenhouse_id: value(formData, "greenhouse_id"),
      lever_id: value(formData, "lever_id"),
      ashby_id: value(formData, "ashby_id"),
      workable_id: value(formData, "workable_id"),
      career_rss_url: value(formData, "career_rss_url"),
      reason: "control-room",
    },
    session,
  );
  revalidateProductPaths();
}

export async function configureSourceAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  const adapter = value(formData, "source_adapter") || "rss";
  const provider = value(formData, "source_provider");
  const url = value(formData, "source_url");
  const query = value(formData, "source_query");
  const subreddit = value(formData, "subreddit");
  if (adapter === "rss" && !url) return;
  if (adapter === "rss") {
    await configureRssSource(
      {
        name: value(formData, "source_name") || "Signal feed",
        url,
        signal_kind: value(formData, "signal_kind") || "hiring",
        poll_interval_minutes: numberValue(formData, "poll_interval_minutes", 60),
      },
      session,
    );
  } else {
    await configureWorkspaceSignalSource(
      {
        adapter: adapter as never,
        name: value(formData, "source_name") || "Signal source",
        provider,
        query,
        subreddit,
        signal_kind: value(formData, "signal_kind") || "press_mention",
        poll_interval_minutes: numberValue(formData, "poll_interval_minutes", 60),
      },
      session,
    );
  }
  revalidateProductPaths();
}

export async function runSignalAggregatorAction() {
  const session = await requireDashboardSession();
  await runWorkspaceSignalAggregatorOnce({ limit: 8 }, session);
  revalidateProductPaths();
}

export async function reviewRecommendationAction(formData: FormData) {
  const session = await requireDashboardSession();
  const reviewId = value(formData, "review_id");
  if (!reviewId) return;
  const decision = value(formData, "decision") === "ignored" ? "ignored" : "accepted";
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

export async function editCompanyProfileAction(formData: FormData) {
  const session = await requireDashboardSession();
  const company_name = value(formData, "company_name");
  const website_url = value(formData, "website_url");
  if (!company_name || !website_url) return;
  await configureWorkspaceCompanyProfile(
    {
      company_name,
      website_url,
      industry: value(formData, "industry") || null,
      description: value(formData, "description") || null,
    },
    session,
  );
  if (value(formData, "refresh") === "1") {
    await startWorkspaceProfileEnrichmentWithExa(
      {
        company_name,
        website_url,
        industry: value(formData, "industry") || null,
        description: value(formData, "description") || null,
      },
      session,
    );
  }
  revalidateProductPaths();
  redirect("/dashboard/setup");
}

export async function configureEmailChannelAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  await configureWorkspaceEmailAccount(
    {
      display_name: value(formData, "sender") || "sampark@go.bombsell.example",
      daily_cap: numberValue(formData, "daily_cap", 25),
    },
    session,
  );
  revalidateProductPaths();
}

export async function submitLaunchSignalAction(formData: FormData) {
  const session = await requireDashboardSession(formData);
  await submitManualSignal(
    {
      company_name: value(formData, "signal_company") || value(formData, "company_name") || "Acme Payroll",
      company_domain: value(formData, "signal_domain") || value(formData, "company_domain"),
      person_name: value(formData, "person_name") || "Nisha Rao",
      person_email: value(formData, "person_email") || "nisha@example.com",
      signal_title:
        value(formData, "signal_title") ||
        "Acme Payroll is hiring a revenue operations lead",
      signal_content:
        value(formData, "signal_content") ||
        "Acme Payroll opened a revenue operations role, suggesting the GTM motion is being rebuilt.",
      signal_url: value(formData, "signal_url"),
      signal_kind: value(formData, "signal_kind") || "hiring",
      icp_segment: value(formData, "icp_segment"),
      approval: value(formData, "approval") === "none" ? "none" : "always",
      match_score: numberValue(formData, "match_score", 0.84),
      simulate_outcome_kind:
        value(formData, "approval") === "none" ? "positive_reply" : null,
    },
    session,
  );
  await dispatchSignalPlaysOnce({ limit: 5 }, session);
  revalidateProductPaths();
  redirect("/dashboard/approvals");
}

export async function decideApprovalWithDraftAction(formData: FormData) {
  const session = await requireDashboardSession();
  const approvalId = value(formData, "approval_id");
  if (!approvalId) return;
  const decision = value(formData, "decision") === "rejected" ? "rejected" : "approved";
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
  await approveWorkflowApproval(approvalId, decision, session, note);
  revalidateProductPaths();
}

function revalidateProductPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/reps");
  revalidatePath("/dashboard/content");
  revalidatePath("/dashboard/plays");
  revalidatePath("/dashboard/aeo");
  revalidatePath("/dashboard/ingestion");
  revalidatePath("/dashboard/approvals");
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard/deliverability");
  revalidatePath("/dashboard/ops");
}
