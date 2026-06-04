"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveWorkflowApproval,
  configureActivationSetup,
  configureRep,
  configureWorkspaceCompanyProfile,
  createProductWorkspaceForUser,
  recordProductRecommendationOutcome,
  reviewProductRecommendation,
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
