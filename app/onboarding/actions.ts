"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import {
  getOrCreateProductWorkspaceForUser,
  runWorkspaceActivationSetup,
  verifiedProductWorkspaceSession,
  type ProductWorkspaceSession,
} from "@/core/product/app";
import { withTransientConnectionRetry } from "@/core/substrate/storage/index.ts";
import {
  normalizeCompanyWebsiteUrl,
} from "@/core/product/company-profile";
import { getRequestAuthIdentity } from "@/lib/auth";
import { findCompletedOnboardingForAuthIdentity } from "@/lib/auth/onboarding";
import { googleAuthPath, PRODUCT_HOME_PATH } from "@/lib/auth/next";
import {
  getActiveWorkspaceSession,
  setActiveWorkspaceCookie,
} from "@/lib/workspace";
import { onboardingActionErrorMessage } from "./errors";

export interface OnboardingActionState {
  error: string | null;
}

const POST_ONBOARDING_PATH = "/dashboard/profile#channels";
const POST_ONBOARDING_WEBSITE_PENDING_PATH = "/dashboard/profile#profile";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

async function requireOnboardingSession(
  workspaceName: string,
): Promise<ProductWorkspaceSession> {
  const existing = await getActiveWorkspaceSession();
  if (existing) {
    return verifiedProductWorkspaceSession({
      workspace_id: existing.workspace.id,
      user_id: existing.user_id,
    });
  }
  const identity = await getRequestAuthIdentity();
  if (!identity) redirect(googleAuthPath("/onboarding"));
  const completed = await findCompletedOnboardingForAuthIdentity(identity);
  if (completed) {
    await setActiveWorkspaceCookie(completed.workspace_id);
    redirect(PRODUCT_HOME_PATH);
  }
  const workspace = await getOrCreateProductWorkspaceForUser(
    {
      name: workspaceName,
      slug: workspaceName,
    },
    identity.id,
  );
  await setActiveWorkspaceCookie(workspace.id);
  return verifiedProductWorkspaceSession({
    workspace_id: workspace.id,
    user_id: identity.id,
  });
}

export async function createActivationSetupAction(formData: FormData) {
  const path = await withTransientConnectionRetry(() =>
    createActivationSetup(formData)
  );
  redirectAfterActivationSetup(path);
}

export async function createActivationSetupFormAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  let path: string;
  try {
    path = await withTransientConnectionRetry(() =>
      createActivationSetup(formData)
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("[onboarding] Agent launch failed", error);
    return { error: onboardingActionErrorMessage(error) };
  }
  redirectAfterActivationSetup(path);
}

export async function createProfileAndAggregatorAction(formData: FormData) {
  return createActivationSetupAction(formData);
}

export async function createProfileAndAggregatorFormAction(
  prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  return createActivationSetupFormAction(prevState, formData);
}

function redirectAfterActivationSetup(path: string): never {
  if (path === POST_ONBOARDING_PATH) {
    redirect(POST_ONBOARDING_PATH);
  }
  if (path === POST_ONBOARDING_WEBSITE_PENDING_PATH) {
    redirect(POST_ONBOARDING_WEBSITE_PENDING_PATH);
  }
  redirect(path);
}

async function createActivationSetup(formData: FormData): Promise<string> {
  const intent = value(formData, "onboarding_intent");
  const skipWebsite = intent === "skip_website";
  const websiteUrl = normalizeCompanyWebsiteUrl(value(formData, "website_url"));
  const companyHint = value(formData, "company_name");
  if (skipWebsite) {
    const companyName = companyHint || "Bombsell Workspace";
    await requireOnboardingSession(`${companyName} GTM`);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/profile");
    return POST_ONBOARDING_WEBSITE_PENDING_PATH;
  }

  if (!websiteUrl) throw new Error("Enter a valid company website.");

  const companyName = companyHint || companyNameFromWebsiteUrl(websiteUrl);
  const session = await requireOnboardingSession(`${companyName} GTM`);
  await runWorkspaceActivationSetup(
    {
      website_url: websiteUrl,
      company_hint: companyHint || undefined,
      industry_hint: value(formData, "industry") || undefined,
      description_hint: value(formData, "company_description") || undefined,
      customer_pain_points: value(formData, "customer_pain_points") || undefined,
      target_titles: value(formData, "target_titles") || undefined,
      target_markets: value(formData, "target_markets") || undefined,
      key_features: value(formData, "key_features") || undefined,
      social_proof: value(formData, "social_proof") || undefined,
      signal_keywords: value(formData, "signal_keywords") || undefined,
      competitor_watchlist: value(formData, "competitor_watchlist") || undefined,
      linkedin_signal_behaviors:
        value(formData, "linkedin_signal_behaviors") || undefined,
      exclusion_rules: value(formData, "exclusion_rules") || undefined,
      preferred_language: value(formData, "preferred_language") || undefined,
      outreach_goal: value(formData, "outreach_goal") || undefined,
      message_tone: value(formData, "message_tone") || undefined,
      allowed_industries: [
        "B2B SaaS",
        "AI",
        "Fintech",
        "Healthcare",
        "Developer tools",
        "Ecommerce",
        "Cybersecurity",
        "Other",
      ],
    },
    session,
    // Activation runs Firecrawl + LLM + multiple tool calls; a hard sync
    // wait risks hitting Vercel's 60s route budget. Instead we redirect
    // immediately and rely on the idempotent self-heal that runs on every
    // dashboard load — see `ensureDefaultSignalSources` in the dashboard
    // layout.
    { wait: false },
  );

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/agent");
  return POST_ONBOARDING_PATH;
}

function companyNameFromWebsiteUrl(websiteUrl: string): string {
  try {
    const domain = new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
    const stem = domain.split(".")[0]?.replace(/[-_]+/g, " ") || "Bombsell Workspace";
    return stem.replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "Bombsell Workspace";
  }
}
