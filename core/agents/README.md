# Agent Fabric — Layer 3

Reps, role-agent composition, three-tier memory, MCP tool envelope, hot-path eval.

## Hard rules

1. **Users see Reps, not agents.** A Rep is the named persona (e.g., "Outbound agent — outreach Rep for founder-led conversations"). Underneath, a Rep is composed of role agents (researcher, writer, sender, replier). Never expose raw agents to the user.
2. **Tools are MCP servers, always.** `core/agents/tools/` defines the envelope. Every integration is an MCP server. The same tools are usable by internal Reps and external agents over `core/mcp/`.
3. **Memory has three tiers, all explicit.** `core/agents/memory/`:
   - **Episodic** — every raw interaction (messages, retrievals, decisions).
   - **Semantic** — extracted, deduped facts about people, companies, signals.
   - **Procedural** — winning playbooks per (ICP × signal × stage). The moat. Grows from outcomes.
4. **Eval is in the hot path.** `core/agents/eval/` runs a Haiku-class judge on every generation before it reaches a channel. Sub-threshold drafts never send. Outcomes feed back into procedural memory.
5. **Autonomy is per-Play × channel × volume.** Not "agent autopilot on/off." Gates live in `core/plays/`.
