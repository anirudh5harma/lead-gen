import { createHmac, timingSafeEqual } from "node:crypto";
import { assistantConfirmationSecret } from "./config.ts";
import type { AssistantConfirmationRequest } from "./types.ts";

interface ConfirmationPayload {
  exp: number;
  input: Record<string, unknown>;
  tool_name: string;
  user_id: string;
  workspace_id: string;
}

export function toolRequiresConfirmation(toolName: string): boolean {
  return (
    toolName === "update_icp" ||
    toolName === "decide_approval" ||
    toolName === "dispatch_outreach" ||
    toolName === "retry_failed_workflow"
  );
}

export function describeConfirmation(
  toolName: string,
  input: Record<string, unknown>,
): Omit<AssistantConfirmationRequest, "token"> {
  if (toolName === "update_icp") {
    return {
      title: "Update ICP profile?",
      body: "This will update the selected ICP name or description while preserving its matching rules and threshold.",
      confirm_label: "Update ICP",
      cancel_label: "Cancel",
    };
  }

  if (toolName === "decide_approval") {
    const decision =
      typeof input.decision === "string" ? input.decision : "approved";
    return {
      title: decision === "rejected" ? "Reject pending draft?" : "Approve pending draft?",
      body:
        decision === "rejected"
          ? "This will reject the pending approval gate from the drawer."
          : "This will approve the pending approval gate. Bombsell will still enforce existing channel and workflow gates after approval.",
      confirm_label: decision === "rejected" ? "Reject draft" : "Approve draft",
      cancel_label: "Keep pending",
    };
  }

  if (toolName === "dispatch_outreach") {
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? String(input.limit)
        : "the default number of";
    return {
      title: "Dispatch outreach workflows?",
      body: `This will dispatch durable outreach workflows for ${limit} matched signal${limit === "1" ? "" : "s"} that are ready to run.`,
      confirm_label: "Dispatch outreach",
      cancel_label: "Cancel",
    };
  }

  return {
    title: "Retry failed workflow?",
    body: "This will retry the selected failed workflow run without mutating domain state directly.",
    confirm_label: "Retry workflow",
    cancel_label: "Cancel",
  };
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createConfirmationToken(input: {
  toolName: string;
  input: Record<string, unknown>;
  userId: string;
  workspaceId: string;
  ttlMs?: number;
}): string {
  const payload: ConfirmationPayload = {
    exp: Date.now() + (input.ttlMs ?? 10 * 60 * 1000),
    input: input.input,
    tool_name: input.toolName,
    user_id: input.userId,
    workspace_id: input.workspaceId,
  };
  const raw = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const secret = assistantConfirmationSecret();
  return `${raw}.${sign(raw, secret)}`;
}

export function verifyConfirmationToken(
  token: string,
  expected: { userId: string; workspaceId: string },
): ConfirmationPayload {
  const [raw, signature] = token.split(".", 2);
  if (!raw || !signature) throw new Error("Invalid confirmation token.");
  const secret = assistantConfirmationSecret();
  const actual = sign(raw, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(actual);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Invalid confirmation token.");
  }

  const payload = JSON.parse(
    Buffer.from(raw, "base64url").toString("utf8"),
  ) as ConfirmationPayload;
  if (
    !payload ||
    payload.user_id !== expected.userId ||
    payload.workspace_id !== expected.workspaceId
  ) {
    throw new Error("Confirmation token does not match the active workspace.");
  }
  if (payload.exp < Date.now()) {
    throw new Error("Confirmation expired. Ask again to create a fresh action.");
  }
  return payload;
}
