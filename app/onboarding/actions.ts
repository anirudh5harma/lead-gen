"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  configureActivationSetup,
  configureDefaultSignalAggregator,
  configureIcpSegment,
  configureSignalEmailPlay,
  configureWorkspaceCompanyProfile,
  createProductWorkspaceForUser,
  runWorkspaceSignalAggregatorOnce,
  startWorkspaceProfileEnrichmentWithExa,
  type ProductWorkspaceSession,
} from "@/core/product/app";
import {
  analyzeCompanyWebsite,
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
    return { workspace_id: existing.workspace.id, user_id: existing.user_id };
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
  return { workspace_id: workspace.id, user_id: identity.id };
}

export async function createProfileAndAggregatorAction(formData: FormData) {
  await createProfileAndAggregator(formData);
  redirect("/dashboard/ingestion");
}

export async function createProfileAndAggregatorFormAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  try {
    await createProfileAndAggregator(formData);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not create the workspace. Try again.",
    };
  }
  redirect("/dashboard/ingestion");
}

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT;");
}

async function createProfileAndAggregator(formData: FormData): Promise<void> {
  const websiteUrl = normalizeCompanyWebsiteUrl(value(formData, "website_url"));
  if (!websiteUrl) throw new Error("Enter a valid company website.");

  const profile = await analyzeCompanyWebsite({
    websiteUrl,
    companyHint: value(formData, "company_name"),
    allowedIndustries: [
      "B2B SaaS",
      "AI",
      "Fintech",
      "Healthcare",
      "Developer tools",
      "Ecommerce",
      "Cybersecurity",
      "Other",
    ],
  });
  if (!profile) {
    throw new Error("Could not read the company website with Firecrawl.");
  }

  const companyName =
    profile.company_name ?? (value(formData, "company_name") || "Bombsell Workspace");
  const session = await requireOnboardingSession(`${companyName} GTM`);
  const configuredProfile = await configureWorkspaceCompanyProfile(
    {
      company_name: companyName,
      website_url: profile.website_url,
      industry: profile.industry,
      description: profile.description,
    },
    session,
  );
  if (process.env.EXA_API_KEY?.trim()) {
    try {
      await startWorkspaceProfileEnrichmentWithExa(
        {
          company_id: configuredProfile.company_id,
          company_name: companyName,
          website_url: profile.website_url,
          industry: profile.industry,
          description: profile.description,
          max_results: 10,
        },
        session,
      );
    } catch (error) {
      console.error("[onboarding:exa-profile-workflow]", error);
    }
  }

  const activation = await configureActivationSetup(
    {
      rep: {
        name: "Sampark",
        role: "sdr",
        voice:
          "Clear, specific, low-hype, and useful. Never pretend to know more than the signal proves.",
        story: `Turns market movement around ${companyName} into careful founder-led conversations.`,
        daily_cap: 15,
        approval: "approve_first",
      },
      icp: {
        name: `${companyName} press and market signals`,
        description: `${profile.description} Match companies and people showing public momentum, hiring, launch, funding, or competitive signals relevant to this market.`,
        signal_kind: "press_mention",
        match_threshold: 0.6,
        nice_to_haves: [
          `Relevant to ${companyName}`,
          profile.industry ? `Mentions ${profile.industry}` : "Clear market timing",
          "Fresh enough to justify outreach",
        ],
      },
      play: {
        signal_kind: "press_mention",
        daily_cap: 15,
        approval: "approve_first",
      },
      email: {
        display_name: "sampark@go.bombsell.com",
        daily_cap: 15,
      },
    },
    session,
  );

  const hiringIcp = await configureIcpSegment(
    {
      name: `${companyName} hiring signals`,
      description: `Hiring changes that imply teams in ${profile.industry ?? "this market"} are rebuilding GTM, product, or operations motions relevant to ${companyName}.`,
      signal_kind: "hiring",
      match_threshold: 0.6,
    },
    session,
  );
  await configureSignalEmailPlay(
    {
      rep_id: activation.rep_id,
      name: `${companyName} Hiring Signal Email`,
      signal_kind: "hiring",
      icp_name: hiringIcp.icp_id,
      daily_cap: 10,
      approval: "approve_first",
    },
    session,
  );

  const launchIcp = await configureIcpSegment(
    {
      name: `${companyName} launch signals`,
      description: `Product launches, Show HN posts, and Product Hunt launches that indicate companies entering or reshaping ${profile.industry ?? "this market"}.`,
      signal_kind: "product_launch",
      match_threshold: 0.6,
    },
    session,
  );
  await configureSignalEmailPlay(
    {
      rep_id: activation.rep_id,
      name: `${companyName} Launch Signal Email`,
      signal_kind: "product_launch",
      icp_name: launchIcp.icp_id,
      daily_cap: 10,
      approval: "approve_first",
    },
    session,
  );

  await configureDefaultSignalAggregator(
    {
      company_name: companyName,
      website_url: profile.website_url,
      industry: profile.industry,
      description: profile.description,
    },
    session,
  );
  await runWorkspaceSignalAggregatorOnce({ limit: 4 }, session);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/ingestion");
}
