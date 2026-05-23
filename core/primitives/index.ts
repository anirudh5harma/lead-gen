/**
 * The five primitives of pivot-v2. The only user-facing nouns in the system.
 * Everything else in the database and the UI is a derived view over these.
 *
 *   Rep           — persona-bound agent (voice, role, KPIs, channels, autonomy)
 *   Signal        — typed event that may justify action
 *   Play          — reusable, parameterized workflow
 *   Conversation  — durable thread across channels with one counterparty
 *   Outcome       — scored, attributable result
 *
 * See /ARCHITECTURE.md "Five Primitives" and /db/migrations/.
 */

export * from "./rep";
export * from "./signal";
export * from "./play";
export * from "./conversation";
export * from "./outcome";
