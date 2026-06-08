"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveWorkflowApproval,
  configureActivationSetup,
  configureRep,
  configureWorkspaceCompanyProfile,
  createProductWorkspaceForUser,
  deleteProductRecommendation,
  draftProductRecommendation,
  recordProductCampaignOutcome,
  recordProductRecommendationOutcome,
  reviewProductRecommendation,
  researchWorkspaceWithExa,
  runWorkspaceSignalAggregatorOnce,
  updateProductRecommendation,
  verifiedProductWorkspaceSession,
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

type DashboardApprovalPolicy =
  | "none"
  | "approve_first"
  | "always"
  | "research_only";

function approvalValue(
  formData: FormData,
  key: string,
  fallback: DashboardApprovalPolicy = "approve_first",
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
  const approval = approvalValue(formData, "approval");
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
    },
    session,
  );
  revalidateProductPaths();
  redirect("/dashboard/setup");
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
      approval: approvalValue(formData, "approval"),
    },
    session,
  );
  revalidateProductPaths();
  if (repId) revalidatePath(`/dashboard/reps/${repId}`);
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
  const playRunId = value(formData, "play_run_id");
  if (!playRunId) return;
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
}

export async function discoverContentOpportunitiesAction(formData: FormData) {
  const session = await requireDashboardSession();
  const query = value(formData, "query");
  if (!query) throw new Error("Enter a content research query.");
  await researchWorkspaceWithExa(
    {
      query,
      intent: "content_research",
      include_text: true,
      num_results: numberValue(formData, "num_results", 8),
    },
    session,
  );
  revalidateProductPaths();
}

export async function auditAeoAction(formData: FormData) {
  const session = await requireDashboardSession();
  const query = value(formData, "query");
  if (!query) throw new Error("Enter an AEO audit query.");
  await researchWorkspaceWithExa(
    {
      query,
      intent: "aeo_audit",
      include_text: true,
      num_results: numberValue(formData, "num_results", 8),
    },
    session,
  );
  revalidateProductPaths();
}

export async function runSignalAggregatorAction(formData: FormData) {
  const session = await requireDashboardSession();
  await runWorkspaceSignalAggregatorOnce(
    { limit: numberValue(formData, "limit", 8) },
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
  revalidateProductPaths();
  redirect("/dashboard/setup");
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
  revalidatePath("/dashboard/campaigns");
  revalidatePath("/dashboard/review");
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard/deliverability");
  revalidatePath("/dashboard/health");
}
