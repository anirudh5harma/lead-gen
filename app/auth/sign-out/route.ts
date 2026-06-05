import { NextResponse } from "next/server";
import {
  applySupabaseCookieCapture,
  createServerSupabaseClient,
  createSupabaseCookieCapture,
} from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabaseCookies = createSupabaseCookieCapture();
  const supabase = await createServerSupabaseClient(supabaseCookies);
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  applySupabaseCookieCapture(response, supabaseCookies);
  return response;
}
