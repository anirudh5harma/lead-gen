export const BOMBSELL_MCP_INSTRUCTIONS = [
  "Bombsell runs GTM from three user-facing surfaces: Brief, Agent, and Profile.",
  "Use product.brief.get first for the current operating brief: last-day and last-week qualified signals, signal types, email and LinkedIn outreach sent, replies, meetings, blockers, and next action.",
  "Use product.state.get or product.context.get when you need deeper Agent evidence: qualified signals, verified contacts, outreach drafts, sent messages, approvals, replies, meetings, and recovery state.",
  "Use product.launch.readiness.get before preparing outreach; it explains Profile, Outlook, LinkedIn, source, approval, and channel blockers.",
  "Profile tools configure company context, buyer fit, signal sources, email, LinkedIn, contact quality, limits, and voice. Agent tools execute signal ingestion, matching, contact waterfall, judged email/LinkedIn drafts, approvals, reply triage, and learning.",
  "Never send or imply sending outreach unless the relevant Bombsell tool, approval policy, channel readiness, and hot-path eval gate permit it. Prefer concise summaries with workspace URLs and primitive IDs when available.",
].join(" ");

