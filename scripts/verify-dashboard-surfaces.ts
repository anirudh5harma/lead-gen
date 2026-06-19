#!/usr/bin/env node
import { chromium } from "playwright";

type SurfaceCheck = {
  path: string;
  labels: string[];
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const results = [];

  try {
    for (const check of checks) {
      const url = `${origin}${check.path}`;
      const response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      const text = await page.locator("body").innerText({ timeout: 10_000 });
      const missing = check.labels.filter((label) => !text.includes(label));
      const failed =
        !response?.ok() ||
        missing.length > 0 ||
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
      });
    }
  } finally {
    await browser.close();
  }

  const failures = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ origin, results }, null, 2));
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
