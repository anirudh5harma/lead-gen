import type { Pool } from "pg";
import { repairUserConnectedChannelAccountOwners } from "../account-ownership.ts";
import type { OutlookAccessTokenProvider } from "./adapters/outlook.ts";

const GET_SCHEDULE_ENDPOINT =
  "https://graph.microsoft.com/v1.0/me/calendar/getSchedule";

export type OutlookCalendarAvailabilityReason =
  | "calendar_included"
  | "calendar_not_configured"
  | "no_connected_calendar"
  | "calendar_permission_missing"
  | "calendar_needs_reauth"
  | "calendar_provider_error"
  | "no_free_slots";

export interface OutlookCalendarAvailability {
  consented: boolean;
  provider: "outlook";
  channel_account_id: string | null;
  account_display_name: string | null;
  suggested_times: string[];
  reason: OutlookCalendarAvailabilityReason;
}

export interface OutlookCalendarAvailabilityOptions {
  pool: Pool;
  accessTokens: OutlookAccessTokenProvider | null | undefined;
  workspace_id: string;
  user_id: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  maxSuggestions?: number;
}

interface OutlookCalendarAccountRow {
  id: string;
  display_name: string;
}

interface GraphScheduleResponse {
  value?: GraphScheduleInformation[];
}

interface GraphScheduleInformation {
  scheduleId?: string;
  availabilityView?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

export async function getOutlookCalendarAvailability(
  opts: OutlookCalendarAvailabilityOptions,
): Promise<OutlookCalendarAvailability> {
  if (!opts.accessTokens) {
    return unavailable("calendar_not_configured");
  }
  await repairUserConnectedChannelAccountOwners(opts.pool, opts.workspace_id);
  const account = await loadOutlookCalendarAccount(
    opts.pool,
    opts.workspace_id,
    opts.user_id,
  );
  if (!account) return unavailable("no_connected_calendar");

  let accessToken: string;
  try {
    accessToken = await opts.accessTokens.getAccessToken(account.id);
  } catch (error) {
    return {
      consented: false,
      provider: "outlook",
      channel_account_id: account.id,
      account_display_name: account.display_name,
      suggested_times: [],
      reason: /reauthorization|invalid_grant|requires Outlook reauthorization/i.test(
        error instanceof Error ? error.message : String(error),
      )
        ? "calendar_needs_reauth"
        : "calendar_provider_error",
    };
  }

  const window = calendarWindow(opts.now ?? new Date());
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(GET_SCHEDULE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schedules: [account.display_name],
        startTime: {
          dateTime: window.start.toISOString(),
          timeZone: "UTC",
        },
        endTime: {
          dateTime: window.end.toISOString(),
          timeZone: "UTC",
        },
        availabilityViewInterval: 30,
      }),
    });
  } catch {
    return availability(account, [], "calendar_provider_error", false);
  }

  if (response.status === 401 || response.status === 403) {
    return availability(account, [], "calendar_permission_missing", false);
  }
  if (!response.ok) {
    return availability(account, [], "calendar_provider_error", false);
  }

  const body = (await response.json().catch(() => null)) as GraphScheduleResponse | null;
  const schedule = body?.value?.[0];
  if (schedule?.error) {
    return availability(account, [], "calendar_provider_error", false);
  }
  const suggested_times = suggestOutlookMeetingTimes({
    availabilityView: schedule?.availabilityView ?? "",
    start: window.start,
    intervalMinutes: 30,
    maxSuggestions: opts.maxSuggestions ?? 3,
  });
  return availability(
    account,
    suggested_times,
    suggested_times.length > 0 ? "calendar_included" : "no_free_slots",
    true,
  );
}

export function suggestOutlookMeetingTimes(input: {
  availabilityView: string;
  start: string | Date;
  intervalMinutes?: number;
  maxSuggestions?: number;
}): string[] {
  const intervalMinutes = Math.max(15, input.intervalMinutes ?? 30);
  const maxSuggestions = Math.max(1, input.maxSuggestions ?? 3);
  const startMs = new Date(input.start).getTime();
  if (!Number.isFinite(startMs)) return [];

  const suggestions: string[] = [];
  for (let index = 0; index < input.availabilityView.length; index++) {
    if (input.availabilityView[index] !== "0") continue;
    const slot = new Date(startMs + index * intervalMinutes * 60_000);
    if (!isBusinessSlot(slot)) continue;
    suggestions.push(slot.toISOString());
    if (suggestions.length >= maxSuggestions) break;
  }
  return suggestions;
}

async function loadOutlookCalendarAccount(
  pool: Pool,
  workspace_id: string,
  user_id: string,
): Promise<OutlookCalendarAccountRow | null> {
  const { rows } = await pool.query<OutlookCalendarAccountRow>(
    `select id, display_name
       from channel_accounts
      where workspace_id = $1
        and user_id = $2
        and kind = 'oauth_outlook'
        and status = 'connected'
      order by last_used_at nulls first, created_at asc
      limit 1`,
    [workspace_id, user_id],
  );
  return rows[0] ?? null;
}

function calendarWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    9,
    0,
    0,
    0,
  ));
  while (!isWeekday(start)) start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  end.setUTCHours(18, 0, 0, 0);
  return { start, end };
}

function isBusinessSlot(slot: Date): boolean {
  return isWeekday(slot) && slot.getUTCHours() >= 9 && slot.getUTCHours() < 17;
}

function isWeekday(value: Date): boolean {
  const day = value.getUTCDay();
  return day >= 1 && day <= 5;
}

function unavailable(reason: OutlookCalendarAvailabilityReason): OutlookCalendarAvailability {
  return {
    consented: false,
    provider: "outlook",
    channel_account_id: null,
    account_display_name: null,
    suggested_times: [],
    reason,
  };
}

function availability(
  account: OutlookCalendarAccountRow,
  suggested_times: string[],
  reason: OutlookCalendarAvailabilityReason,
  consented: boolean,
): OutlookCalendarAvailability {
  return {
    consented,
    provider: "outlook",
    channel_account_id: account.id,
    account_display_name: account.display_name,
    suggested_times,
    reason,
  };
}
