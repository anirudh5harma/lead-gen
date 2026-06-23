export const BOMBSELL_MCP_INSTRUCTIONS = [
  "Bombsell runs GTM from three user-facing surfaces: Brief, Agent, and Profile.",
  "For Claude Code-style workflows, use the bombsell_* task tools exposed by this MCP surface rather than raw product.* internals.",
  "Start with bombsell_brief_get for the current operating brief: last-day and last-week qualified signals, signal types, email and LinkedIn outreach sent, replies, meetings, blockers, and next action.",
  "Use bombsell_signals_list_qualified, bombsell_contact_lanes_get, and bombsell_outreach_list_sent when you need deeper Agent evidence about verified contacts, drafts, sent messages, and the next handoff.",
  "Use bombsell_launch_check before preparing outreach; it explains Profile, Outlook, LinkedIn, source, approval, and channel blockers.",
  "Profile-focused tools propose company context and output-destination changes; Agent-focused tools prepare judged drafts, approvals, CRM handoff, and learning review without bypassing Bombsell's workflow gates.",
  "Never send or imply sending outreach unless the relevant Bombsell tool, approval policy, channel readiness, and hot-path eval gate permit it. Prefer concise summaries with workspace URLs and primitive IDs when available.",
].join(" ");
