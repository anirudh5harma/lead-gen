"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Forces a fresh server render of the current route on mount.
 *
 * The App Router keeps a client-side Router Cache: navigating away from a
 * dynamic page (e.g. Brief → Agent → Profile) and back can replay a stale or
 * empty cached RSC payload instead of refetching, even though the server data
 * is current (a hard reload always shows it). For data-driven landing surfaces
 * like the Brief we want live numbers every time the route becomes active, so
 * we invalidate and refetch on mount. `router.refresh()` re-renders server
 * components in place without dropping client state, and runs once per mount,
 * so there is no refresh loop.
 */
export default function RouteRefresh() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
