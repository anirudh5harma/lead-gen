import type { ChannelAutonomy } from "../primitives/index.ts";

export type ApprovalPolicy = ChannelAutonomy["approval"];

export interface PlayChannelPolicy {
  channel: string;
  daily_cap: number;
  approval: ApprovalPolicy;
}

export function resolvePlayChannelPolicy(
  playAutonomy: Record<string, unknown>,
  channel: string,
  override?: {
    approval?: ApprovalPolicy | null;
  },
): PlayChannelPolicy {
  const channelPolicy = readChannelPolicy(playAutonomy, channel);
  const approval = override?.approval ?? channelPolicy.approval;
  return {
    channel,
    daily_cap: channelPolicy.daily_cap,
    approval,
  };
}

export function parseApprovalPolicy(value: unknown): ApprovalPolicy | null {
  return value === "none" ||
    value === "approve_first" ||
    value === "always" ||
    value === "research_only"
    ? value
    : null;
}

export function shouldRequestApproval(
  policy: PlayChannelPolicy,
  priorSendCount: number,
): boolean {
  if (policy.approval === "always") return true;
  if (policy.approval === "approve_first") return priorSendCount === 0;
  return false;
}

export function isDailyCapExceeded(
  policy: PlayChannelPolicy,
  sentTodayCount: number,
): boolean {
  return policy.daily_cap <= 0 || sentTodayCount >= policy.daily_cap;
}

export function nextDailyWindow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function readChannelPolicy(
  playAutonomy: Record<string, unknown>,
  channel: string,
): Omit<PlayChannelPolicy, "channel"> {
  const channels = playAutonomy.channels;
  const policy =
    channels && typeof channels === "object" && !Array.isArray(channels)
      ? (channels as Record<string, unknown>)[channel]
      : null;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { daily_cap: 0, approval: "none" };
  }
  const raw = policy as Record<string, unknown>;
  return {
    daily_cap: nonnegativeInteger(raw.daily_cap),
    approval: parseApprovalPolicy(raw.approval) ?? "none",
  };
}

function nonnegativeInteger(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : 0;
}
