"use server";

import { revalidatePath } from "next/cache";
import {
  approveWorkflowApproval,
  configureEmailAccount,
  configureRssSource,
  dispatchRssSourceIngestionOnce,
  retryFailedWorkflowRun,
  startSendingDomainOperation,
  submitManualSignal,
} from "@/core/product/app";
import { getBriefWorkspaceSession } from "./session";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function bootstrapAction() {
  await getBriefWorkspaceSession({ create: true });
  revalidatePath("/brief");
}

export async function configureEmailAction(formData: FormData) {
  const session = await getBriefWorkspaceSession({ create: true });
  if (!session) return;
  await configureEmailAccount({
    display_name: value(formData, "display_name") || "maya@go.bombsell.example",
    daily_cap: Number(value(formData, "daily_cap") || 25),
  }, session);
  revalidatePath("/brief");
}

export async function provisionSendingDomainAction() {
  const session = await getBriefWorkspaceSession();
  if (!session) return;
  await startSendingDomainOperation("provision", session);
  revalidatePath("/brief");
}

export async function verifySendingDomainAction() {
  const session = await getBriefWorkspaceSession();
  if (!session) return;
  await startSendingDomainOperation("verify", session);
  revalidatePath("/brief");
}

export async function refreshSendingDomainAction() {
  const session = await getBriefWorkspaceSession();
  if (!session) return;
  await startSendingDomainOperation("refresh", session);
  revalidatePath("/brief");
}

export async function configureRssSourceAction(formData: FormData) {
  const session = await getBriefWorkspaceSession({ create: true });
  if (!session) return;
  const url = value(formData, "url");
  if (!url) {
    revalidatePath("/brief");
    return;
  }
  await configureRssSource({
    name: value(formData, "name") || "GTM Signals",
    url,
    signal_kind: value(formData, "signal_kind") || "press_mention",
    poll_interval_minutes: Number(value(formData, "poll_interval_minutes") || 15),
  }, session);
  revalidatePath("/brief");
}

export async function pollSourcesAction() {
  const session = await getBriefWorkspaceSession();
  if (!session) return;
  await dispatchRssSourceIngestionOnce({}, session);
  revalidatePath("/brief");
}

export async function retryWorkflowAction(formData: FormData) {
  const session = await getBriefWorkspaceSession();
  if (!session) return;
  const runId = value(formData, "run_id");
  if (runId) {
    await retryFailedWorkflowRun(runId, session);
  }
  revalidatePath("/brief");
}

export async function submitSignalAction(formData: FormData) {
  const session = await getBriefWorkspaceSession({ create: true });
  if (!session) return;
  await submitManualSignal({
    company_name: value(formData, "company_name") || "Acme Payroll",
    company_domain: value(formData, "company_domain"),
    person_name: value(formData, "person_name") || "Nisha Rao",
    person_email: value(formData, "person_email") || "nisha@acmepayroll.example",
    signal_title:
      value(formData, "signal_title") || "Acme Payroll announced a Series A",
    signal_content:
      value(formData, "signal_content") ||
      "Acme Payroll raised a Series A to expand finance workflows for distributed teams.",
    signal_url: value(formData, "signal_url"),
    approval: value(formData, "approval") === "none" ? "none" : "always",
  }, session);
  revalidatePath("/brief");
}

export async function decideApprovalAction(formData: FormData) {
  const session = await getBriefWorkspaceSession();
  if (!session) return;
  const approvalId = value(formData, "approval_id");
  const decision = value(formData, "decision") === "rejected" ? "rejected" : "approved";
  if (approvalId) {
    await approveWorkflowApproval(approvalId, decision, session);
  }
  revalidatePath("/brief");
}
