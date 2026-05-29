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
  type ProductWorkspaceSession,
} from "@/core/product/app";
import {
  analyzeCompanyWebsite,
  normalizeCompanyWebsiteUrl,
} from "@/core/product/company-profile";
import { getRequestUserId } from "@/lib/auth";
import {
  getActiveWorkspaceSession,
  setActiveWorkspaceCookie,
} from "@/lib/workspace";

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
  const userId = await getRequestUserId();
  if (!userId) redirect("/login?next=/onboarding");
  const workspace = await createProductWorkspaceForUser(
    {
      name: workspaceName,
      slug: workspaceName,
    },
    userId,
  );
  await setActiveWorkspaceCookie(workspace.id);
  return { workspace_id: workspace.id, user_id: userId };
}

export async function createProfileAndAggregatorAction(formData: FormData) {
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
  await configureWorkspaceCompanyProfile(
    {
      company_name: companyName,
      website_url: profile.website_url,
      industry: profile.industry,
      description: profile.description,
    },
    session,
  );

  const activation = await configureActivationSetup(
    {
      rep: {
        name: "Maya",
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
        display_name: "maya@go.bombsell.com",
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
  redirect("/dashboard/ingestion");
}
