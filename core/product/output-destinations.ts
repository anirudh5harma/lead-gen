import { z } from "zod";

export const OutputDestinationSchema = z.object({
  key: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.enum(["connected", "available", "planned", "blocked"]),
  detail: z.string(),
  handoff_stage: z.enum([
    "channel_send",
    "agent_api",
    "signal_intake",
    "qualified_contact_sync",
    "sent_proof_sync",
    "reply_meeting_alert",
  ]),
  href: z.string().nullable(),
  tools: z.array(z.string()),
});

export type OutputDestination = z.infer<typeof OutputDestinationSchema>;

export interface OutputDestinationInput {
  email_connected: boolean;
  linkedin_connected: boolean;
  launch_ready: boolean;
}

export function buildOutputDestinations(
  input: OutputDestinationInput,
): OutputDestination[] {
  const destinations: OutputDestination[] = [
    {
      key: "outlook",
      title: "Outlook",
      category: "Email outreach",
      status: input.email_connected ? "connected" : "blocked",
      detail: input.email_connected
        ? "Verified email outreach can send from the connected Microsoft 365 mailbox and sync replies."
        : "Connect Outlook in Profile before verified email contacts can leave Bombsell.",
      handoff_stage: "channel_send",
      href: "/dashboard/profile#email",
      tools: ["product.outlook_account.connect_url.get"],
    },
    {
      key: "linkedin",
      title: "LinkedIn",
      category: "Social outreach",
      status: input.linkedin_connected ? "connected" : "blocked",
      detail: input.linkedin_connected
        ? "LinkedIn-ready profiles can become connection requests, accepted-connection follow-ups, DMs, and reply traces."
        : "Connect LinkedIn in Profile before profile-backed outreach can run.",
      handoff_stage: "channel_send",
      href: "/dashboard/profile#linkedin",
      tools: ["product.linkedin_account.connect_url.get"],
    },
    {
      key: "claude-code",
      title: "Claude Code + MCP",
      category: "Agent API",
      status: "available",
      detail:
        "External agents can read Brief, Profile proposals, qualified signals, sent outreach, drafts, approvals, and reply learning through Bombsell MCP tools.",
      handoff_stage: "agent_api",
      href: "/dashboard/profile#claude-code",
      tools: [
        "bombsell.brief.get",
        "bombsell.signals.list_qualified",
        "bombsell.outreach.list_sent",
      ],
    },
    {
      key: "signal-webhook",
      title: "Signal webhook",
      category: "Automation intake",
      status: "available",
      detail:
        "Trusted external buying-signal events can enter Bombsell's qualification, contact-resolution, draft, and approval path.",
      handoff_stage: "signal_intake",
      href: "/api/webhooks/signals",
      tools: ["product.signal.submit"],
    },
    {
      key: "visitor-deanonymization",
      title: "Visitor de-anonymization",
      category: "Intent signal intake",
      status: "available",
      detail:
        "RB2B, Clearbit, Factors, Warmly, or custom visitor-ID events can enter Bombsell as website-intent Signals with company, person, page, and intent-score proof.",
      handoff_stage: "signal_intake",
      href: "/api/webhooks/visitors",
      tools: ["product.signal.submit"],
    },
    {
      key: "crm-sync",
      title: "CRM sync",
      category: "Qualified contact sync",
      status: "available",
      detail:
        "HubSpot, Pipedrive, Salesforce, Attio, Folk, and Clay can receive qualified contacts through Bombsell MCP/API handoff after signal and contact proof exists; native OAuth sync is next.",
      handoff_stage: "qualified_contact_sync",
      href: "/dashboard/profile#claude-code",
      tools: [
        "bombsell.signals.list_qualified",
        "bombsell.contacts.list_lanes",
      ],
    },
    {
      key: "outreach-tool-sync",
      title: "Outreach tool sync",
      category: "Sent proof sync",
      status: "planned",
      detail:
        "Instantly, Smartlead, HeyReach, and SmartReach should stay optional volume destinations after native channel readiness and sent proof are healthy.",
      handoff_stage: "sent_proof_sync",
      href: null,
      tools: [],
    },
    {
      key: "team-alerts",
      title: "Team alerts",
      category: "Reply and meeting alerts",
      status: "planned",
      detail:
        "Slack, Zapier, and outbound webhooks should announce hot contacts, replies, meetings, and blocked send reasons from typed events.",
      handoff_stage: "reply_meeting_alert",
      href: null,
      tools: [],
    },
  ];

  return destinations.map((destination) => ({
    ...destination,
    status:
      input.launch_ready || destination.status !== "blocked"
        ? destination.status
        : "blocked",
  }));
}
