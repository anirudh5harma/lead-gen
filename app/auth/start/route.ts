import { NextResponse } from "next/server";
import { getRequestAuthIdentity } from "@/lib/auth";
import { googleAuthPath, onboardingPathForWebsite } from "@/lib/auth/next";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = onboardingPathForWebsite(searchParams.get("url"));
  const identity = await getRequestAuthIdentity();
  const destination = identity ? next : googleAuthPath(next);
  return NextResponse.redirect(new URL(destination, request.url));
}
