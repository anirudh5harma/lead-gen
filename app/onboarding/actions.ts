"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createProductWorkspaceForUser,
  runWorkspaceActivationSetup,
  runWorkspaceSignalIngestion,
  verifiedProductWorkspaceSession,
  type ProductWorkspaceSession,
} from "@/core/product/app";
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

export interface OnboardingActionState {
  error: string | null;
}

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
  const workspace = await createProductWorkspaceForUser(
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
  await createActivationSetup(formData);
  redirect(PRODUCT_HOME_PATH);
}

export async function createActivationSetupFormAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  try {
    await createActivationSetup(formData);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not create the workspace. Try again.",
    };
  }
  redirect(PRODUCT_HOME_PATH);
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

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT;");
}

async function createActivationSetup(formData: FormData): Promise<void> {
  const websiteUrl = normalizeCompanyWebsiteUrl(value(formData, "website_url"));
  if (!websiteUrl) throw new Error("Enter a valid company website.");

  const companyHint = value(formData, "company_name");
  const companyName = companyHint || companyNameFromWebsiteUrl(websiteUrl);
  const session = await requireOnboardingSession(`${companyName} GTM`);
  await runWorkspaceActivationSetup(
    {
      website_url: websiteUrl,
      company_hint: companyHint || undefined,
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
  );
  await runWorkspaceSignalIngestion({ limit: 4 }, session, { wait: false });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospecting");
  revalidatePath("/dashboard/signals");
  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/campaigns");
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
