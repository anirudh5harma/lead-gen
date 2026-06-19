#!/usr/bin/env node
import { chromium } from "playwright";

type SurfaceCheck = {
  path: string;
  labels: string[];
};

type RedirectCheck = {
  path: string;
  destination: string;
};

type AuthRedirectCheck = {
  path: string;
  locationIncludes: string;
};

const origin = (
  process.env.DASHBOARD_VERIFY_ORIGIN ??
  process.env.APP_ORIGIN ??
  "http://127.0.0.1:3023"
).replace(/\/$/, "");

const checks: SurfaceCheck[] = [
  {
    path: "/dashboard/brief",
    labels: [
      "Welcome back",
      "Qualified signals",
      "Emails sent",
      "LinkedIn DMs",
      "Signal-to-outreach flow",
      "Verified email",
      "Agent insight",
    ],
  },
  {
    path: "/dashboard/agent",
    labels: [
      "Live work",
      "Outreach",
      "Contacts",
      "Learning",
      "System",
    ],
  },
  {
    path: "/dashboard/profile",
    labels: [
      "SETUP HUB",
      "LAUNCH MODEL",
      "Profile",
      "Email integration",
      "LinkedIn integration",
      "Use Bombsell in Claude Code",
    ],
  },
];

const canonicalNav = ["Brief", "Agent", "Profile"];

const forbiddenNav = ["Outreach", "Signals", "Prospects", "Inbox", "Plays", "Outcomes", "Reps"];

const redirectChecks: RedirectCheck[] = [
  { path: "/dashboard/reps", destination: "/dashboard/agent" },
  { path: "/dashboard/campaigns", destination: "/dashboard/agent#learning" },
  { path: "/dashboard/content", destination: "/dashboard/agent" },
  { path: "/dashboard/aeo", destination: "/dashboard/agent" },
  { path: "/dashboard/plays", destination: "/dashboard/agent#learning" },
  { path: "/dashboard/signals", destination: "/dashboard/agent#opportunities" },
  { path: "/dashboard/ingestion", destination: "/dashboard/agent#opportunities" },
  { path: "/dashboard/prospects", destination: "/dashboard/agent#verified-contacts" },
  { path: "/dashboard/conversations", destination: "/dashboard/agent#outreach" },
  { path: "/dashboard/review", destination: "/dashboard/agent#review-queue" },
  { path: "/dashboard/approvals", destination: "/dashboard/agent#review-queue" },
  { path: "/dashboard/settings", destination: "/dashboard/profile#tools" },
  { path: "/dashboard/integrations", destination: "/dashboard/profile#tools" },
  { path: "/dashboard/deliverability", destination: "/dashboard/profile#channels" },
  { path: "/dashboard/prospecting", destination: "/dashboard/profile#profile" },
  { path: "/dashboard/setup", destination: "/dashboard/profile#profile" },
  { path: "/dashboard/outcomes", destination: "/dashboard/brief" },
];

const authRedirectChecks: AuthRedirectCheck[] = [
  { path: "/login?next=%2Fdashboard", locationIncludes: "/auth/google?next=%2Fdashboard" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const results = [];
  const redirects = [];
  const auth = [];

  try {
    for (const check of checks) {
      const url = `${origin}${check.path}`;
      const response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      const text = await page.locator("body").innerText({ timeout: 10_000 });
      const missing = check.labels.filter((label) => !text.includes(label));
      const navLabels = await page
        .locator("header nav a span")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.textContent?.trim() ?? "").filter(Boolean)
        )
        .catch(() => []);
      const navMatches =
        check.path === "/dashboard/brief"
          ? arraysEqual(navLabels, canonicalNav)
          : true;
      const forbiddenNavLabels = navLabels.filter((label) =>
        forbiddenNav.includes(label)
      );
      const failed =
        !response?.ok() ||
        missing.length > 0 ||
        !navMatches ||
        forbiddenNavLabels.length > 0 ||
        text.includes("This tab could not finish") ||
        text.includes("An error occurred") ||
        text.includes("Not found");

      if (process.env.DASHBOARD_VERIFY_SCREENSHOTS === "1") {
        const name = check.path.replace(/^\/+/, "").replace(/[^\w-]+/g, "-");
        await page.screenshot({
          path: `/tmp/bombsell-${name || "dashboard"}.png`,
          fullPage: false,
        });
      }

      results.push({
        path: check.path,
        status: response?.status() ?? 0,
        ok: !failed,
        missing,
        nav: check.path === "/dashboard/brief" ? navLabels : undefined,
        forbiddenNav:
          check.path === "/dashboard/brief" ? forbiddenNavLabels : undefined,
      });
    }

    for (const check of redirectChecks) {
      const response = await page.goto(`${origin}${check.path}`, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      const actual = normalizedPath(page.url());
      const ok = response?.ok() && actual === check.destination;
      redirects.push({
        path: check.path,
        destination: check.destination,
        actual,
        ok: Boolean(ok),
      });
    }

    for (const check of authRedirectChecks) {
      const response = await page.request.get(`${origin}${check.path}`, {
        maxRedirects: 0,
        timeout: 20_000,
      });
      const location = response.headers().location ?? "";
      auth.push({
        path: check.path,
        status: response.status(),
        location,
        ok:
          response.status() >= 300 &&
          response.status() < 400 &&
          location.includes(check.locationIncludes),
      });
    }
  } finally {
    await browser.close();
  }

  const failures = results.filter((result) => !result.ok);
  const redirectFailures = redirects.filter((result) => !result.ok);
  const authFailures = auth.filter((result) => !result.ok);
  console.log(JSON.stringify({ origin, results, redirects, auth }, null, 2));
  if (failures.length > 0 || redirectFailures.length > 0 || authFailures.length > 0) {
    process.exit(1);
  }
}

function normalizedPath(value: string): string {
  const url = new URL(value);
  return `${url.pathname}${url.hash}`;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
