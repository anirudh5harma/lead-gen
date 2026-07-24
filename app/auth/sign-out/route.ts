import { NextResponse } from "next/server";
import {
  applySupabaseCookieCapture,
  createServerSupabaseClient,
  createSupabaseCookieCapture,
} from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/workspace";

export async function POST(request: Request) {
  const supabaseCookies = createSupabaseCookieCapture();
  const supabase = await createServerSupabaseClient(supabaseCookies);
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  applySupabaseCookieCapture(response, supabaseCookies);
  response.cookies.delete(ACTIVE_WORKSPACE_COOKIE_NAME);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
